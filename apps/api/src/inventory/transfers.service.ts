import { Inject, Injectable } from "@nestjs/common";
import type { TransferInput, TransferReceiveRequest, TransferStatus, TransferSummary } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { InventoryService } from "./inventory.service";
import { StockEngine } from "./stock-engine";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const include = {
  from: { select: { id: true, code: true, name: true } },
  to: { select: { id: true, code: true, name: true } },
  lines: {
    include: {
      product: { select: { code: true, name: true, baseUnit: { select: { code: true, decimals: true } } } },
      allocations: { include: { lot: { select: { code: true } } }, orderBy: { id: "asc" as const } },
    },
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.StockTransferInclude;
type Row = Prisma.StockTransferGetPayload<{ include: typeof include }>;

/**
 * Transferencias entre almacenes (plan §10.3, ADR-004). El lote VIAJA: al despachar sale del origen y entra al almacén
 * lógico de tránsito con el mismo lote y costo; al recibir sale del tránsito y entra al destino. Nada se pierde entre
 * una y otra recepción, y si se cancela en camino la mercadería vuelve al origen.
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(StockEngine) private readonly engine: StockEngine,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  list(ctx: RequestContext, status?: TransferStatus): Promise<TransferSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.stockTransfer.findMany({
        where: { OR: [{ fromBranchId: { in: ids } }, { toBranchId: { in: ids } }], ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" }, take: 100, include,
      });
      return rows.map(toSummary);
    });
  }

  get(ctx: RequestContext, id: string): Promise<TransferSummary> {
    return ctx.run(async (tx) => {
      const t = await tx.stockTransfer.findUnique({ where: { id }, include });
      const ids = await this.branches(ctx, tx, "VIEW");
      if (!t || !(ids.includes(t.fromBranchId) || ids.includes(t.toBranchId))) throw notFound("Transferencia");
      return toSummary(t);
    });
  }

  create(ctx: RequestContext, input: TransferInput): Promise<TransferSummary> {
    return ctx.run(async (tx) => {
      const [from, to] = await Promise.all([this.storage(tx, input.fromWarehouseId), this.storage(tx, input.toWarehouseId)]);
      if (!(await this.branches(ctx, tx, "OPERATE")).includes(from.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de origen.");
      const ids = input.lines.map((l) => l.productId);
      if (new Set(ids).size !== ids.length) throw badRequest("DUPLICATE_PRODUCT", "Un producto no puede repetirse: suma las cantidades en una sola línea.");
      const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, kind: true, status: true, baseUnit: { select: { decimals: true } } } });
      if (products.length !== ids.length) throw notFound("Producto");
      for (const p of products) {
        if (p.kind !== "GOODS") throw badRequest("NOT_STOCKABLE", `${p.code} es un servicio: no se transfiere.`);
        if (p.status !== "ACTIVE") throw conflict("PRODUCT_INACTIVE", `${p.code} está inactivo.`);
        const q = D(input.lines.find((l) => l.productId === p.id)!.quantity);
        if (!q.toDecimalPlaces(p.baseUnit.decimals).eq(q)) throw badRequest("INVALID_QUANTITY", `${p.code} admite hasta ${p.baseUnit.decimals} decimales en su unidad base.`);
      }
      const id = uuidv7();
      const code = await this.nextCode(tx, ctx.auth.tenantId);
      await tx.stockTransfer.create({
        data: { id, tenantId: ctx.auth.tenantId, code, fromWarehouseId: from.id, toWarehouseId: to.id, fromBranchId: from.branchId, toBranchId: to.branchId, note: input.note?.trim() || null, createdById: ctx.auth.userId },
      });
      for (const l of input.lines) await tx.stockTransferLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, transferId: id, productId: l.productId, quantity: l.quantity } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "transfer.created", entityType: "stock_transfer", entityId: id, branchId: from.branchId, actorUserId: ctx.auth.userId, after: { code, from: from.id, to: to.id, lines: input.lines.length } });
      return toSummary(await tx.stockTransfer.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  /** DRAFT → IN_TRANSIT: saca del origen (lotes según el método de valoración) y deja la mercadería en tránsito. */
  async dispatch(ctx: RequestContext, id: string): Promise<TransferSummary> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const actor = await this.inventory.actor(ctx);
      const t = await this.lock(ctx, tx, id, "from");
      if (t.status !== "DRAFT") throw conflict("INVALID_STATE", "Solo se despacha una transferencia en borrador.");
      const transit = await this.engine.ensureTransit(tx, ctx.auth.tenantId);
      const lines = await tx.stockTransferLine.findMany({ where: { transferId: id }, orderBy: { productId: "asc" } });
      await this.engine.lockValuations(tx, ctx.auth.tenantId, [t.fromWarehouseId, transit], lines.map((l) => l.productId));
      const source = { type: "TRANSFER", id, reasonCode: "TRANSFER", note: t.code };

      for (const line of lines) {
        const parts = await this.engine.issue(tx, actor, { warehouseId: t.fromWarehouseId, productId: line.productId, quantity: line.quantity, type: "TRANSFER_OUT", source });
        for (const part of parts) {
          await this.engine.receive(tx, actor, { warehouseId: transit, productId: line.productId, quantity: part.quantity, unitCost: part.unitCost, type: "TRANSFER_IN", existingLotId: part.lotId, allowTransit: true, source });
          await tx.stockTransferAllocation.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, transferId: id, lineId: line.id, productId: line.productId, lotId: part.lotId, quantity: part.quantity, unitCost: part.unitCost } });
        }
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: "IN_TRANSIT", dispatchedAt: new Date() } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "transfer.dispatched", entityType: "stock_transfer", entityId: id, branchId: t.fromBranchId, actorUserId: ctx.auth.userId, after: { code: t.code } });
      return toSummary(await tx.stockTransfer.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  /**
   * IN_TRANSIT → RECEIVED: entra al destino lo que llegó. Si llegó menos de lo despachado, la diferencia se da de baja como
   * pérdida en tránsito (movimiento de ajuste, con motivo obligatorio): el tránsito siempre queda en cero.
   */
  async receive(ctx: RequestContext, id: string, input: TransferReceiveRequest): Promise<TransferSummary> {
    await ctx.tenantInfo();
    return ctx.run(async (tx) => {
      const actor = await this.inventory.actor(ctx);
      const t = await this.lock(ctx, tx, id, "to");
      if (t.status !== "IN_TRANSIT") throw conflict("INVALID_STATE", "Solo se recibe una transferencia en tránsito.");
      const dest = await tx.warehouse.findUniqueOrThrow({ where: { id: t.toWarehouseId }, select: { status: true } });
      if (dest.status !== "ACTIVE") throw conflict("WAREHOUSE_INACTIVE", "El almacén de destino está inactivo.");
      const transit = await this.engine.ensureTransit(tx, ctx.auth.tenantId);
      const lines = await tx.stockTransferLine.findMany({ where: { transferId: id }, include: { allocations: { orderBy: { id: "asc" } } }, orderBy: { productId: "asc" } });
      const requested = new Map((input.lines ?? []).map((l) => [l.lineId, l.receivedQty]));
      for (const lineId of requested.keys()) if (!lines.some((l) => l.id === lineId)) throw badRequest("LINE_NOT_FOUND", "Una línea no pertenece a la transferencia.");
      await this.engine.lockValuations(tx, ctx.auth.tenantId, [transit, t.toWarehouseId], lines.map((l) => l.productId));

      let shortfall = false;
      const source = { type: "TRANSFER", id, reasonCode: "TRANSFER", note: t.code };
      for (const line of lines) {
        let left = D(requested.has(line.id) ? requested.get(line.id)! : line.quantity);
        if (left.gt(line.quantity)) throw badRequest("OVER_RECEIPT", "No se puede recibir más de lo despachado.");
        for (const a of line.allocations) {
          const take = Prisma.Decimal.min(left, a.quantity);
          left = left.sub(take);
          if (take.gt(0)) {
            await this.engine.issue(tx, actor, { warehouseId: transit, productId: a.productId, quantity: take, type: "TRANSFER_OUT", lotId: a.lotId, allowTransit: true, allowExpired: true, allowBlocked: true, costOverride: a.unitCost, source });
            await this.engine.receive(tx, actor, { warehouseId: t.toWarehouseId, productId: a.productId, quantity: take, unitCost: a.unitCost, type: "TRANSFER_IN", existingLotId: a.lotId, source });
          }
          const lost = a.quantity.sub(take);
          if (lost.gt(0)) {
            shortfall = true;
            await this.engine.issue(tx, actor, {
              warehouseId: transit, productId: a.productId, quantity: lost, type: "ADJUSTMENT_OUT", lotId: a.lotId, allowTransit: true, allowExpired: true, allowBlocked: true, costOverride: a.unitCost,
              source: { type: "TRANSFER", id, reasonCode: "TRANSIT_LOSS", note: `Pérdida en tránsito ${t.code}: ${input.note ?? ""}`.trim() },
            });
          }
          await tx.stockTransferAllocation.update({ where: { id: a.id }, data: { receivedQty: take } });
        }
      }
      if (shortfall && !input.note?.trim()) throw badRequest("SHORTFALL_NOTE_REQUIRED", "Llegó menos de lo despachado: indica el motivo de la diferencia.");
      await tx.stockTransfer.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date() } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "transfer.received", entityType: "stock_transfer", entityId: id, branchId: t.toBranchId, actorUserId: ctx.auth.userId, after: { code: t.code, shortfall, note: input.note ?? null } });
      return toSummary(await tx.stockTransfer.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  /** Cancela un borrador, o una transferencia en tránsito (la mercadería vuelve al origen con su lote y costo). */
  async cancel(ctx: RequestContext, id: string): Promise<TransferSummary> {
    await ctx.tenantInfo();
    return ctx.run(async (tx) => {
      const actor = await this.inventory.actor(ctx);
      const t = await this.lock(ctx, tx, id, "from");
      if (t.status !== "DRAFT" && t.status !== "IN_TRANSIT") throw conflict("INVALID_STATE", "Solo se cancela una transferencia en borrador o en tránsito.");
      if (t.status === "IN_TRANSIT") {
        const transit = await this.engine.ensureTransit(tx, ctx.auth.tenantId);
        const allocs = await tx.stockTransferAllocation.findMany({ where: { transferId: id }, orderBy: { productId: "asc" } });
        await this.engine.lockValuations(tx, ctx.auth.tenantId, [transit, t.fromWarehouseId], allocs.map((a) => a.productId));
        const source = { type: "TRANSFER", id, reasonCode: "TRANSFER_CANCEL", note: `Cancelación ${t.code}` };
        for (const a of allocs) {
          await this.engine.issue(tx, actor, { warehouseId: transit, productId: a.productId, quantity: a.quantity, type: "TRANSFER_OUT", lotId: a.lotId, allowTransit: true, allowExpired: true, allowBlocked: true, costOverride: a.unitCost, source });
          await this.engine.receive(tx, actor, { warehouseId: t.fromWarehouseId, productId: a.productId, quantity: a.quantity, unitCost: a.unitCost, type: "TRANSFER_IN", existingLotId: a.lotId, allowTransit: true, source });
        }
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "transfer.cancelled", entityType: "stock_transfer", entityId: id, branchId: t.fromBranchId, actorUserId: ctx.auth.userId, before: { status: t.status } });
      return toSummary(await tx.stockTransfer.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  // ───────────── Internos ─────────────

  private async storage(tx: Tx, id: string) {
    const w = await tx.warehouse.findUnique({ where: { id }, select: { id: true, branchId: true, status: true, kind: true } });
    if (!w) throw notFound("Almacén");
    if (w.kind !== "STORAGE" || w.status !== "ACTIVE") throw conflict("WAREHOUSE_INACTIVE", "El almacén no está disponible.");
    return w;
  }

  /** Bloquea la transferencia y exige acceso OPERATE a la sucursal de origen (despachar/cancelar) o de destino (recibir). */
  private async lock(ctx: RequestContext, tx: Tx, id: string, side: "from" | "to") {
    await tx.$queryRaw`SELECT id FROM stock_transfer WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const t = await tx.stockTransfer.findUnique({ where: { id }, select: { id: true, code: true, status: true, fromWarehouseId: true, toWarehouseId: true, fromBranchId: true, toBranchId: true } });
    if (!t) throw notFound("Transferencia");
    const ids = await this.branches(ctx, tx, "OPERATE");
    if (!ids.includes(side === "from" ? t.fromBranchId : t.toBranchId)) {
      const visible = await this.branches(ctx, tx, "VIEW");
      if (!visible.includes(t.fromBranchId) && !visible.includes(t.toBranchId)) throw notFound("Transferencia");
      throw forbid("BRANCH_FORBIDDEN", side === "from" ? "No tienes acceso a la sucursal de origen." : "No tienes acceso a la sucursal de destino.");
    }
    return t;
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "TRANSFER", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "TRANSFER", prefix: "TR-", padding: 6 } });
    }
    return (await nextSequenceNumber(tx, "TRANSFER")).formatted;
  }
}

const toSummary = (t: Row): TransferSummary => ({
  id: t.id, code: t.code, status: t.status, note: t.note, from: t.from, to: t.to, createdAt: t.createdAt.toISOString(),
  dispatchedAt: t.dispatchedAt?.toISOString() ?? null, receivedAt: t.receivedAt?.toISOString() ?? null,
  lines: t.lines.map((l) => ({
    id: l.id, productId: l.productId, productCode: l.product.code, productName: l.product.name, unit: l.product.baseUnit.code, quantity: l.quantity.toString(),
    receivedQty: l.allocations.reduce((s, a) => s.add(a.receivedQty), D(0)).toString(),
    lots: l.allocations.map((a) => ({ lotCode: a.lot.code, quantity: a.quantity.toString(), receivedQty: a.receivedQty.toString(), unitCost: a.unitCost.toString() })),
  })),
});
