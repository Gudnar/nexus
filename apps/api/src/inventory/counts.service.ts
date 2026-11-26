import { Inject, Injectable } from "@nestjs/common";
import type { CountDetail, CountEntry, CountInput, CountStatus, CountSummary } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { InventoryService } from "./inventory.service";
import { StockEngine } from "./stock-engine";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  lines: {
    include: { product: { select: { code: true, name: true, baseUnit: { select: { code: true, decimals: true } } } }, lot: { select: { code: true, expiresOn: true } } },
    orderBy: [{ productId: "asc" as const }, { lotId: "asc" as const }],
  },
} satisfies Prisma.InventoryCountInclude;
type Row = Prisma.InventoryCountGetPayload<{ include: typeof include }>;

/**
 * Conteos físicos (plan §10.3). Al abrirlo se toma una FOTO del saldo por lote; se cuenta, se envía y quien aprueba aplica la
 * diferencia (contado − foto) como movimientos de ajuste. Así lo vendido o recibido mientras se contaba no se pierde ni se duplica.
 * Contar y enviar: inventory.adjust.request · aplicar o devolver el conteo: inventory.adjust.approve.
 */
@Injectable()
export class CountsService {
  constructor(
    @Inject(StockEngine) private readonly engine: StockEngine,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  list(ctx: RequestContext, status?: CountStatus): Promise<CountSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.inventoryCount.findMany({ where: { branchId: { in: ids }, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 100, include });
      return rows.map(toSummary);
    });
  }

  get(ctx: RequestContext, id: string): Promise<CountDetail> {
    return ctx.run(async (tx) => {
      const c = await tx.inventoryCount.findUnique({ where: { id }, include });
      if (!c || !(await this.branches(ctx, tx, "VIEW")).includes(c.branchId)) throw notFound("Conteo");
      return toDetail(c);
    });
  }

  create(ctx: RequestContext, input: CountInput): Promise<CountDetail> {
    return ctx.run(async (tx) => {
      const w = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, select: { id: true, branchId: true, status: true, kind: true } });
      if (!w) throw notFound("Almacén");
      if (!(await this.branches(ctx, tx, "OPERATE")).includes(w.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese almacén.");
      if (w.kind !== "STORAGE" || w.status !== "ACTIVE") throw conflict("WAREHOUSE_INACTIVE", "El almacén no está disponible.");

      const balances = await tx.stockBalance.findMany({
        where: { warehouseId: w.id, physicalQty: { gt: 0 }, ...(input.productIds?.length ? { productId: { in: input.productIds } } : {}) },
        select: { productId: true, lotId: true, physicalQty: true, lot: { select: { unitCost: true } } },
      });
      if (balances.length === 0) throw badRequest("EMPTY_COUNT", "No hay existencias para contar con ese alcance.");

      const id = uuidv7();
      const code = await this.nextCode(tx, ctx.auth.tenantId);
      await tx.inventoryCount.create({ data: { id, tenantId: ctx.auth.tenantId, branchId: w.branchId, warehouseId: w.id, code, note: input.note?.trim() || null, createdById: ctx.auth.userId } });
      for (const b of balances) {
        await tx.inventoryCountLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, countId: id, productId: b.productId, lotId: b.lotId, expectedQty: b.physicalQty, unitCost: b.lot.unitCost } });
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "count.opened", entityType: "inventory_count", entityId: id, branchId: w.branchId, actorUserId: ctx.auth.userId, after: { code, lines: balances.length } });
      return toDetail(await tx.inventoryCount.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  /** Guarda las cantidades contadas (puede hacerse en varias tandas; una línea en blanco = sin contar). */
  enter(ctx: RequestContext, id: string, input: CountEntry): Promise<CountDetail> {
    return ctx.run(async (tx) => {
      const c = await this.lock(ctx, tx, id);
      if (c.status !== "OPEN") throw conflict("INVALID_STATE", "Solo se registran cantidades en un conteo abierto.");
      const lines = await tx.inventoryCountLine.findMany({ where: { countId: id }, include: { product: { select: { code: true, baseUnit: { select: { decimals: true } } } } } });
      const byId = new Map(lines.map((l) => [l.id, l]));
      for (const e of input.lines) {
        const l = byId.get(e.lineId);
        if (!l) throw badRequest("LINE_NOT_FOUND", "Una línea no pertenece al conteo.");
        if (e.countedQty !== null && !D(e.countedQty).toDecimalPlaces(l.product.baseUnit.decimals).eq(D(e.countedQty))) {
          throw badRequest("INVALID_QUANTITY", `${l.product.code} admite hasta ${l.product.baseUnit.decimals} decimales en su unidad base.`);
        }
      }
      for (const e of input.lines) await tx.inventoryCountLine.update({ where: { id: e.lineId }, data: { countedQty: e.countedQty === null ? null : D(e.countedQty) } });
      return toDetail(await tx.inventoryCount.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  /** OPEN → SUBMITTED: pasa a revisión (todas las líneas deben estar contadas). */
  submit(ctx: RequestContext, id: string): Promise<CountDetail> {
    return this.move(ctx, id, "count.submitted", (c, lines) => {
      if (c.status !== "OPEN") throw conflict("INVALID_STATE", "Solo se envía un conteo abierto.");
      const pending = lines.filter((l) => l.countedQty === null).length;
      if (pending > 0) throw conflict("COUNT_INCOMPLETE", `Faltan ${pending} línea(s) por contar.`);
      return { status: "SUBMITTED", submittedAt: new Date() };
    });
  }

  /** SUBMITTED → OPEN: quien aprueba lo devuelve para recontar. */
  reopen(ctx: RequestContext, id: string): Promise<CountDetail> {
    return this.move(ctx, id, "count.reopened", (c) => {
      if (c.status !== "SUBMITTED") throw conflict("INVALID_STATE", "Solo se devuelve un conteo enviado.");
      return { status: "OPEN", submittedAt: null };
    });
  }

  cancel(ctx: RequestContext, id: string): Promise<CountDetail> {
    return this.move(ctx, id, "count.cancelled", (c) => {
      if (c.status !== "OPEN" && c.status !== "SUBMITTED") throw conflict("INVALID_STATE", "Solo se cancela un conteo abierto o enviado.");
      return { status: "CANCELLED" };
    });
  }

  private move(
    ctx: RequestContext, id: string, action: string,
    fn: (c: { status: CountStatus }, lines: { countedQty: Prisma.Decimal | null }[]) => Prisma.InventoryCountUpdateInput,
  ): Promise<CountDetail> {
    return ctx.run(async (tx) => {
      const c = await this.lock(ctx, tx, id);
      const data = fn(c, await tx.inventoryCountLine.findMany({ where: { countId: id }, select: { countedQty: true } }));
      await tx.inventoryCount.update({ where: { id }, data });
      await writeAudit(tx, ctx.auth.tenantId, { action, entityType: "inventory_count", entityId: id, branchId: c.branchId, actorUserId: ctx.auth.userId, before: { status: c.status }, after: { status: data.status } });
      return toDetail(await tx.inventoryCount.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  /**
   * SUBMITTED → APPLIED: aplica la diferencia de cada lote. Sobrante: entra al mismo lote al costo del lote. Faltante: sale del
   * lote (si entretanto ya no hay esa cantidad, falla sin aplicar nada).
   */
  async apply(ctx: RequestContext, id: string): Promise<CountDetail> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const actor = await this.inventory.actor(ctx);
      const c = await this.lock(ctx, tx, id);
      if (c.status !== "SUBMITTED") throw conflict("INVALID_STATE", "Solo se aplica un conteo enviado.");
      const lines = await tx.inventoryCountLine.findMany({ where: { countId: id }, orderBy: [{ productId: "asc" }, { lotId: "asc" }] });
      await this.engine.lockValuations(tx, ctx.auth.tenantId, [c.warehouseId], lines.map((l) => l.productId));
      const source = { type: "COUNT", id, reasonCode: "COUNT", note: c.code };

      let withDifference = 0;
      for (const l of lines) {
        const diff = D(l.countedQty ?? l.expectedQty).sub(l.expectedQty);
        if (diff.isZero()) continue;
        withDifference++;
        if (diff.gt(0)) {
          await this.engine.receive(tx, actor, { warehouseId: c.warehouseId, productId: l.productId, quantity: diff, unitCost: l.unitCost, type: "ADJUSTMENT_IN", existingLotId: l.lotId, source });
        } else {
          await this.engine.issue(tx, actor, { warehouseId: c.warehouseId, productId: l.productId, quantity: diff.abs(), type: "ADJUSTMENT_OUT", lotId: l.lotId, allowExpired: true, allowBlocked: true, source });
        }
      }
      await tx.inventoryCount.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date(), appliedById: ctx.auth.userId } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "count.applied", entityType: "inventory_count", entityId: id, branchId: c.branchId, actorUserId: ctx.auth.userId, after: { code: c.code, withDifference } });
      return toDetail(await tx.inventoryCount.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  private async lock(ctx: RequestContext, tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM inventory_count WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const c = await tx.inventoryCount.findUnique({ where: { id }, select: { id: true, code: true, status: true, warehouseId: true, branchId: true } });
    if (!c) throw notFound("Conteo");
    if (!(await this.branches(ctx, tx, "OPERATE")).includes(c.branchId)) {
      if (!(await this.branches(ctx, tx, "VIEW")).includes(c.branchId)) throw notFound("Conteo");
      throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese conteo.");
    }
    return c;
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "COUNT", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "COUNT", prefix: "CF-", padding: 6 } });
    }
    return (await nextSequenceNumber(tx, "COUNT")).formatted;
  }
}

const diffOf = (l: Row["lines"][number]) => (l.countedQty === null ? null : l.countedQty.sub(l.expectedQty));
const toSummary = (c: Row): CountSummary => ({
  id: c.id, code: c.code, status: c.status, note: c.note, createdAt: c.createdAt.toISOString(), appliedAt: c.appliedAt?.toISOString() ?? null, warehouse: c.warehouse,
  totals: { lines: c.lines.length, counted: c.lines.filter((l) => l.countedQty !== null).length, withDifference: c.lines.filter((l) => diffOf(l) !== null && !diffOf(l)!.isZero()).length },
});
const toDetail = (c: Row): CountDetail => ({
  ...toSummary(c),
  lines: c.lines.map((l) => ({
    id: l.id, productCode: l.product.code, productName: l.product.name, unit: l.product.baseUnit.code, lotCode: l.lot.code, expiresOn: l.lot.expiresOn ? l.lot.expiresOn.toISOString().slice(0, 10) : null,
    expectedQty: l.expectedQty.toString(), countedQty: l.countedQty?.toString() ?? null, difference: diffOf(l)?.toString() ?? null, unitCost: l.unitCost.toString(),
  })),
  differenceValue: c.lines.reduce((s, l) => s.add((diffOf(l) ?? D(0)).mul(l.unitCost)), D(0)).toDecimalPlaces(6).toString(),
});
