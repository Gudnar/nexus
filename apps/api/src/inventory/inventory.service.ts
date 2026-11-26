import { Inject, Injectable } from "@nestjs/common";
import type {
  AdjustmentRequest, AdjustmentSummary, KardexList, KardexQuery, LotBalanceRow, ReverseRequest, StockList, StockQuery,
  ValuationPolicyInput, ValuationPolicySummary, WarehouseInput, WarehousePatch, WarehouseSummary,
} from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { Clock } from "../access/clock";
import { localParts } from "../access/schedule";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { StockEngine, type StockActor } from "./stock-engine";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const dec = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const str = (v: Prisma.Decimal.Value) => dec(v).toString();

@Injectable()
export class InventoryService {
  constructor(
    @Inject(StockEngine) private readonly engine: StockEngine,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Identidad para el motor de stock: quién y con qué fecha local (zona de la empresa). */
  async actor(ctx: RequestContext): Promise<StockActor> {
    return { tenantId: ctx.auth.tenantId, userId: ctx.auth.userId, today: localParts(this.clock.now(), (await ctx.tenantInfo()).timezone).date };
  }

  /** Sucursales sobre las que el usuario puede actuar con al menos `minLevel`. */
  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  private async assertWarehouseAccess(ctx: RequestContext, tx: Tx, warehouseId: string, minLevel: BranchAccessLevel) {
    const w = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, branchId: true, status: true, kind: true, code: true } });
    if (!w) throw notFound("Almacén");
    if (!(await this.branches(ctx, tx, minLevel)).includes(w.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese almacén.");
    return w;
  }

  // ───────────── Almacenes ─────────────

  listWarehouses(ctx: RequestContext): Promise<WarehouseSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.warehouse.findMany({ where: { branchId: { in: ids }, kind: "STORAGE" }, orderBy: [{ code: "asc" }], include: { branch: { select: { id: true, code: true, name: true } } } });
      return rows.map(toWarehouse);
    });
  }

  createWarehouse(ctx: RequestContext, input: WarehouseInput): Promise<WarehouseSummary> {
    return ctx.run(async (tx) => {
      if (!(await this.branches(ctx, tx, "MANAGE")).includes(input.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso de administración a esa sucursal.");
      const id = uuidv7();
      try {
        await tx.warehouse.create({ data: { id, tenantId: ctx.auth.tenantId, branchId: input.branchId, code: input.code, name: input.name } });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe un almacén con ese código.");
        throw e;
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "warehouse.created", entityType: "warehouse", entityId: id, branchId: input.branchId, actorUserId: ctx.auth.userId, after: input });
      return toWarehouse(await tx.warehouse.findUniqueOrThrow({ where: { id }, include: { branch: { select: { id: true, code: true, name: true } } } }));
    });
  }

  updateWarehouse(ctx: RequestContext, id: string, patch: WarehousePatch): Promise<WarehouseSummary> {
    return ctx.run(async (tx) => {
      const w = await this.assertWarehouseAccess(ctx, tx, id, "MANAGE");
      if (patch.status === "INACTIVE") {
        const stock = await tx.inventoryValuation.aggregate({ where: { warehouseId: id }, _sum: { quantity: true } });
        if (stock._sum.quantity && stock._sum.quantity.gt(0)) throw conflict("WAREHOUSE_HAS_STOCK", "No se puede desactivar un almacén con existencias. Transfiérelas o ajústalas primero.");
      }
      await tx.warehouse.update({ where: { id }, data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "warehouse.updated", entityType: "warehouse", entityId: id, branchId: w.branchId, actorUserId: ctx.auth.userId, after: patch });
      return toWarehouse(await tx.warehouse.findUniqueOrThrow({ where: { id }, include: { branch: { select: { id: true, code: true, name: true } } } }));
    });
  }

  // ───────────── Existencias ─────────────

  stock(ctx: RequestContext, q: StockQuery): Promise<StockList> {
    return ctx.run(async (tx) => {
      const branchIds = await this.branches(ctx, tx, "VIEW");
      if (branchIds.length === 0) return { items: [], nextCursor: null };
      await this.engine.expireDue(tx, ctx.auth.tenantId); // lo reservado que ya venció vuelve a estar disponible
      const [cp, cw] = (q.cursor ?? "").split("|");
      const rows = await tx.$queryRaw<{
        product_id: string; code: string; name: string; unit: string; track_lots: boolean; warehouse_id: string; wcode: string; wname: string;
        qty: Prisma.Decimal; value: Prisma.Decimal; reserved: Prisma.Decimal;
      }[]>(Prisma.sql`
        SELECT v.product_id, p.code, p.name, u.code AS unit, p.track_lots, v.warehouse_id, w.code AS wcode, w.name AS wname, v.quantity AS qty, v.total_value AS value,
               COALESCE((SELECT SUM(b.reserved_qty) FROM stock_balance b WHERE b.tenant_id = v.tenant_id AND b.warehouse_id = v.warehouse_id AND b.product_id = v.product_id), 0) AS reserved
          FROM inventory_valuation v
          JOIN warehouse w ON w.tenant_id = v.tenant_id AND w.id = v.warehouse_id
          JOIN product p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
          JOIN unit_of_measure u ON u.tenant_id = p.tenant_id AND u.id = p.base_unit_id
         WHERE w.branch_id IN (${Prisma.join(branchIds.map((b) => Prisma.sql`${b}::uuid`))})
           AND v.quantity > 0
           ${q.warehouseId ? Prisma.sql`AND v.warehouse_id = ${q.warehouseId}::uuid` : Prisma.empty}
           ${q.productId ? Prisma.sql`AND v.product_id = ${q.productId}::uuid` : Prisma.empty}
           ${q.q ? Prisma.sql`AND (p.code ILIKE ${"%" + q.q + "%"} OR p.name ILIKE ${"%" + q.q + "%"})` : Prisma.empty}
           ${cp ? Prisma.sql`AND (p.code, w.code) > (${cp}, ${cw ?? ""})` : Prisma.empty}
         ORDER BY p.code, w.code
         LIMIT ${q.limit + 1}`);
      const page = rows.slice(0, q.limit);
      return {
        items: page.map((r) => ({
          productId: r.product_id, code: r.code, name: r.name, unit: r.unit, trackLots: r.track_lots,
          warehouse: { id: r.warehouse_id, code: r.wcode, name: r.wname },
          physicalQty: str(r.qty), reservedQty: str(r.reserved), availableQty: str(dec(r.qty).sub(dec(r.reserved))), value: str(r.value),
          averageCost: dec(r.qty).gt(0) ? dec(r.value).div(dec(r.qty)).toDecimalPlaces(6).toString() : "0",
        })),
        nextCursor: rows.length > q.limit ? `${page[page.length - 1]!.code}|${page[page.length - 1]!.wcode}` : null,
      };
    });
  }

  lotBalances(ctx: RequestContext, productId: string, warehouseId?: string): Promise<LotBalanceRow[]> {
    return ctx.run(async (tx) => {
      const branchIds = await this.branches(ctx, tx, "VIEW");
      if (branchIds.length === 0) return [];
      const rows = await tx.$queryRaw<{
        lot_id: string; lcode: string; received_at: Date; expires_on: Date | null; unit_cost: Prisma.Decimal; status: "ACTIVE" | "BLOCKED";
        warehouse_id: string; wcode: string; physical: Prisma.Decimal; reserved: Prisma.Decimal;
      }[]>(Prisma.sql`
        SELECT b.lot_id, l.code AS lcode, l.received_at, l.expires_on, l.unit_cost, l.status::text AS status, b.warehouse_id, w.code AS wcode, b.physical_qty AS physical, b.reserved_qty AS reserved
          FROM stock_balance b
          JOIN lot l ON l.tenant_id = b.tenant_id AND l.id = b.lot_id
          JOIN warehouse w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
         WHERE b.product_id = ${productId}::uuid AND b.physical_qty > 0
           AND w.branch_id IN (${Prisma.join(branchIds.map((b) => Prisma.sql`${b}::uuid`))})
           ${warehouseId ? Prisma.sql`AND b.warehouse_id = ${warehouseId}::uuid` : Prisma.empty}
         ORDER BY l.received_at, l.code, w.code`);
      return rows.map((r) => ({
        lotId: r.lot_id, lotCode: r.lcode, receivedAt: new Date(r.received_at).toISOString(), expiresOn: r.expires_on ? new Date(r.expires_on).toISOString().slice(0, 10) : null,
        unitCost: str(r.unit_cost), status: r.status, warehouse: { id: r.warehouse_id, code: r.wcode },
        physicalQty: str(r.physical), reservedQty: str(r.reserved), availableQty: str(dec(r.physical).sub(dec(r.reserved))),
      }));
    });
  }

  // ───────────── Kardex ─────────────

  kardex(ctx: RequestContext, q: KardexQuery): Promise<KardexList> {
    return ctx.run(async (tx) => {
      const branchIds = await this.branches(ctx, tx, "VIEW");
      if (branchIds.length === 0) return { items: [], nextCursor: null };
      const rows = await tx.$queryRaw<{
        id: string; seq: bigint; occurred_at: Date; type: string; warehouse_id: string; wcode: string; lot_id: string | null; lcode: string | null;
        quantity: Prisma.Decimal; unit_cost: Prisma.Decimal; total_cost: Prisma.Decimal; balance_after: Prisma.Decimal;
        reason_code: string | null; note: string | null; actor_id: string | null; reversal_of_id: string | null;
      }[]>(Prisma.sql`
        SELECT * FROM (
          SELECT m.id, m.seq, m.occurred_at, m.type::text AS type, m.warehouse_id, w.code AS wcode, m.lot_id, l.code AS lcode,
                 m.quantity, m.unit_cost, m.total_cost,
                 SUM(m.quantity) OVER (PARTITION BY m.warehouse_id ORDER BY m.seq) AS balance_after,
                 m.reason_code, m.note, m.actor_id, m.reversal_of_id
            FROM stock_movement m
            JOIN warehouse w ON w.tenant_id = m.tenant_id AND w.id = m.warehouse_id
            LEFT JOIN lot l ON l.tenant_id = m.tenant_id AND l.id = m.lot_id
           WHERE m.product_id = ${q.productId}::uuid
             AND w.branch_id IN (${Prisma.join(branchIds.map((b) => Prisma.sql`${b}::uuid`))})
             ${q.warehouseId ? Prisma.sql`AND m.warehouse_id = ${q.warehouseId}::uuid` : Prisma.empty}
        ) t
         WHERE TRUE
           ${q.lotId ? Prisma.sql`AND t.lot_id = ${q.lotId}::uuid` : Prisma.empty}
           ${q.from ? Prisma.sql`AND t.occurred_at >= ${q.from}::date` : Prisma.empty}
           ${q.to ? Prisma.sql`AND t.occurred_at < (${q.to}::date + 1)` : Prisma.empty}
           ${q.cursor ? Prisma.sql`AND t.seq < ${q.cursor}::bigint` : Prisma.empty}
         ORDER BY t.seq DESC
         LIMIT ${q.limit + 1}`);
      const page = rows.slice(0, q.limit);
      return {
        items: page.map((r) => ({
          id: r.id, seq: r.seq.toString(), occurredAt: new Date(r.occurred_at).toISOString(), type: r.type as KardexList["items"][number]["type"],
          warehouse: { id: r.warehouse_id, code: r.wcode }, lot: r.lot_id ? { id: r.lot_id, code: r.lcode! } : null,
          quantity: str(r.quantity), unitCost: str(r.unit_cost), totalCost: str(r.total_cost), balanceAfter: str(r.balance_after),
          reasonCode: r.reason_code, note: r.note, actorId: r.actor_id, reversalOfId: r.reversal_of_id,
        })),
        nextCursor: rows.length > q.limit ? page[page.length - 1]!.seq.toString() : null,
      };
    });
  }

  // ───────────── Ajustes ─────────────

  listAdjustments(ctx: RequestContext): Promise<AdjustmentSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.stockAdjustment.findMany({
        where: { branchId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 50,
        include: { warehouse: { select: { id: true, code: true, name: true } }, lines: { include: { product: { select: { code: true } }, lot: { select: { code: true } } } } },
      });
      return rows.map(toAdjustment);
    });
  }

  /**
   * Aplica un ajuste de inventario. Sin motor de aprobaciones todavía, quien tiene `inventory.adjust.approve`
   * lo aplica directamente; la solicitud con aprobación posterior llega con el motor de aprobaciones (Fase 7).
   */
  async createAdjustment(ctx: RequestContext, input: AdjustmentRequest): Promise<AdjustmentSummary> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const wh = await this.assertWarehouseAccess(ctx, tx, input.warehouseId, "OPERATE");
      const actor = await this.actor(ctx);
      const lines = [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId));
      const id = uuidv7();
      const created: { productId: string; lotId: string; quantity: number; unitCost: number }[] = [];
      const source = { type: "ADJUSTMENT", id, reasonCode: "ADJUSTMENT", note: input.reason };
      for (const line of lines) {
        if (line.quantity > 0) {
          if (line.unitCost === undefined) throw badRequest("COST_REQUIRED", "Al sumar stock indica el costo unitario.");
          const r = await this.engine.receive(tx, actor, { warehouseId: wh.id, productId: line.productId, quantity: line.quantity, unitCost: line.unitCost, type: "ADJUSTMENT_IN", lot: line.lot, source });
          created.push({ productId: line.productId, lotId: r.lotId, quantity: line.quantity, unitCost: line.unitCost });
        } else {
          const parts = await this.engine.issue(tx, actor, {
            warehouseId: wh.id, productId: line.productId, quantity: Math.abs(line.quantity), type: "ADJUSTMENT_OUT",
            lotId: line.lotId, allowExpired: true, allowBlocked: !!line.lotId, source,
          });
          for (const part of parts) {
            created.push({ productId: line.productId, lotId: part.lotId, quantity: part.quantity.neg().toNumber(), unitCost: part.unitCost.toNumber() });
          }
        }
      }
      // El correlativo se toma AL FINAL: el bloqueo de la secuencia dura lo mínimo (ADR-006).
      if (!(await tx.sequence.findFirst({ where: { documentType: "ADJUSTMENT", branchId: null }, select: { id: true } }))) {
        await tx.sequence.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, branchId: null, documentType: "ADJUSTMENT", prefix: "AJ-", padding: 6 } });
      }
      const code = (await nextSequenceNumber(tx, "ADJUSTMENT")).formatted;
      await tx.stockAdjustment.create({ data: { id, tenantId: ctx.auth.tenantId, branchId: wh.branchId, warehouseId: wh.id, code, reason: input.reason, note: input.note ?? null, createdById: ctx.auth.userId } });
      for (const l of created) await tx.stockAdjustmentLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, adjustmentId: id, ...l } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "inventory.adjusted", entityType: "stock_adjustment", entityId: id, branchId: wh.branchId, actorUserId: ctx.auth.userId, after: { code, reason: input.reason, lines: input.lines.length } });
      const row = await tx.stockAdjustment.findUniqueOrThrow({
        where: { id }, include: { warehouse: { select: { id: true, code: true, name: true } }, lines: { include: { product: { select: { code: true } }, lot: { select: { code: true } } } } },
      });
      return toAdjustment(row);
    });
  }

  async reverseMovement(ctx: RequestContext, movementId: string, input: ReverseRequest): Promise<{ movementId: string }> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const m = await tx.stockMovement.findUnique({ where: { id: movementId }, select: { warehouseId: true } });
      if (!m) throw notFound("Movimiento");
      await this.assertWarehouseAccess(ctx, tx, m.warehouseId, "OPERATE");
      const r = await this.engine.reverse(tx, await this.actor(ctx), movementId, input.reason);
      await writeAudit(tx, ctx.auth.tenantId, { action: "inventory.reversed", entityType: "stock_movement", entityId: movementId, actorUserId: ctx.auth.userId, after: { reversal: r.movementId, reason: input.reason } });
      return r;
    });
  }

  // ───────────── Valoración ─────────────

  async listPolicies(ctx: RequestContext): Promise<{ current: "FIFO" | "LIFO" | "AVERAGE"; policies: ValuationPolicySummary[] }> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const actor = await this.actor(ctx);
      const rows = await tx.valuationPolicy.findMany({ orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], take: 100, include: { product: { select: { code: true } } } });
      return {
        current: await this.engine.methodFor(tx, null, actor.today),
        policies: rows.map((r) => ({ id: r.id, productId: r.productId, productCode: r.product?.code ?? null, method: r.method, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10) })),
      };
    });
  }

  async setPolicy(ctx: RequestContext, input: ValuationPolicyInput): Promise<{ revaluations: number }> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const actor = await this.actor(ctx);
      const r = await this.engine.setPolicy(tx, actor, { productId: input.productId ?? null, method: input.method });
      await writeAudit(tx, ctx.auth.tenantId, { action: "inventory.policy_changed", entityType: "valuation_policy", actorUserId: ctx.auth.userId, after: { ...input, revaluations: r.revaluations } });
      return r;
    });
  }

  reconcile(ctx: RequestContext) {
    return ctx.run((tx) => this.engine.reconcile(tx));
  }
}

type WarehouseRow = Prisma.WarehouseGetPayload<{ include: { branch: { select: { id: true; code: true; name: true } } } }>;
const toWarehouse = (w: WarehouseRow): WarehouseSummary => ({ id: w.id, code: w.code, name: w.name, kind: w.kind, status: w.status, branch: w.branch });

type AdjustmentRow = Prisma.StockAdjustmentGetPayload<{ include: { warehouse: { select: { id: true; code: true; name: true } }; lines: { include: { product: { select: { code: true } }; lot: { select: { code: true } } } } } }>;
const toAdjustment = (a: AdjustmentRow): AdjustmentSummary => ({
  id: a.id, code: a.code, reason: a.reason, note: a.note, createdAt: a.createdAt.toISOString(), warehouse: a.warehouse,
  lines: a.lines.map((l) => ({ productId: l.productId, productCode: l.product.code, lotCode: l.lot?.code ?? null, quantity: l.quantity.toString(), unitCost: l.unitCost.toString() })),
});
