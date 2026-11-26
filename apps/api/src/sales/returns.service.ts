import { Inject, Injectable } from "@nestjs/common";
import type { SaleReturnInput, SaleReturnView } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { CashService } from "../cash/cash.service";
import { InventoryService } from "../inventory/inventory.service";
import { StockEngine } from "../inventory/stock-engine";
import { payStatus } from "./sales.service";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

const include = {
  sale: { select: { code: true } },
  lines: { include: { product: { select: { code: true, name: true } } }, orderBy: { id: "asc" as const } },
} satisfies Prisma.SaleReturnInclude;
type Row = Prisma.SaleReturnGetPayload<{ include: typeof include }>;

/**
 * Devoluciones de venta (plan §11.3): documento inmutable (nota de crédito interna) que reingresa al inventario lo devuelto, en su
 * lote y a su costo original, reduce lo que el cliente debe y, si ya había pagado de más, registra el reembolso. La venta original
 * no cambia: sigue siendo la foto de lo vendido.
 */
@Injectable()
export class ReturnsService {
  constructor(
    @Inject(StockEngine) private readonly engine: StockEngine,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(CashService) private readonly cash: CashService,
  ) {}

  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  list(ctx: RequestContext, saleId?: string): Promise<SaleReturnView[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.saleReturn.findMany({ where: { branchId: { in: ids }, ...(saleId ? { saleId } : {}) }, orderBy: { createdAt: "desc" }, take: 100, include });
      return rows.map(toView);
    });
  }

  get(ctx: RequestContext, id: string): Promise<SaleReturnView> {
    return ctx.run(async (tx) => {
      const r = await tx.saleReturn.findUnique({ where: { id }, include });
      if (!r || !(await this.branches(ctx, tx, "VIEW")).includes(r.branchId)) throw notFound("Devolución");
      return toView(r);
    });
  }

  async create(ctx: RequestContext, saleId: string, input: SaleReturnInput): Promise<SaleReturnView> {
    await ctx.tenantInfo(); // fuera de la transacción: no pedir una 2.ª conexión del pool
    return ctx.run(async (tx) => {
      const actor = await this.inventory.actor(ctx);
      await tx.$queryRaw`SELECT id FROM sale WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${saleId}::uuid FOR UPDATE`;
      const sale = await tx.sale.findUnique({ where: { id: saleId }, select: { id: true, code: true, status: true, branchId: true, warehouseId: true, total: true, paidTotal: true, returnedTotal: true, refundedTotal: true } });
      if (!sale) throw notFound("Venta");
      if (!(await this.branches(ctx, tx, "OPERATE")).includes(sale.branchId)) {
        if (!(await this.branches(ctx, tx, "VIEW")).includes(sale.branchId)) throw notFound("Venta");
        throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de esa venta.");
      }
      if (sale.status !== "CONFIRMED") throw conflict("INVALID_STATE", "Solo se devuelve una venta confirmada.");

      const ids = input.lines.map((l) => l.saleLineId);
      if (new Set(ids).size !== ids.length) throw badRequest("DUPLICATE_LINE", "No repitas la misma línea: suma las cantidades.");
      const lines = await tx.saleLine.findMany({
        where: { saleId }, include: { product: { select: { code: true, kind: true, baseUnit: { select: { decimals: true } } } }, priceList: { select: { roundingDecimals: true } }, allocations: { orderBy: { id: "asc" } } },
      });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const prev = await tx.saleReturnLine.groupBy({ by: ["saleLineId"], where: { ret: { saleId } }, _sum: { quantity: true, netAmount: true, taxAmount: true, totalAmount: true } });
      const prevOf = new Map(prev.map((p) => [p.saleLineId, p._sum]));

      // 1) Validación y cálculo proporcional (el último tramo de una línea absorbe el redondeo).
      const computed: { line: (typeof lines)[number]; qty: Prisma.Decimal; net: Prisma.Decimal; tax: Prisma.Decimal; total: Prisma.Decimal; before: Prisma.Decimal }[] = [];
      for (const r of input.lines) {
        const l = byId.get(r.saleLineId);
        if (!l) throw badRequest("LINE_NOT_FOUND", "Una línea no pertenece a la venta.");
        const qty = D(r.quantity);
        if (!qty.toDecimalPlaces(l.product.baseUnit.decimals).eq(qty)) throw badRequest("INVALID_QUANTITY", `${l.product.code} admite hasta ${l.product.baseUnit.decimals} decimales.`);
        const p = prevOf.get(l.id);
        const before = p?.quantity ?? D(0);
        const remaining = l.quantity.sub(before);
        if (qty.gt(remaining)) throw conflict("OVER_RETURN", `${l.product.code}: se vendieron ${l.quantity.toString()}, ya se devolvieron ${before.toString()}; solo quedan ${remaining.toString()} por devolver.`);
        const dp = l.priceList.roundingDecimals;
        let total: Prisma.Decimal; let net: Prisma.Decimal;
        if (qty.eq(remaining)) {
          total = l.totalAmount.sub(p?.totalAmount ?? 0); net = l.netAmount.sub(p?.netAmount ?? 0);
        } else {
          total = l.totalAmount.mul(qty).div(l.quantity).toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);
          net = l.netAmount.mul(qty).div(l.quantity).toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);
        }
        computed.push({ line: l, qty, net, tax: total.sub(net), total, before });
      }

      // 2) Stock: lo devuelto vuelve a los lotes de los que salió, en el mismo orden en que salieron, al costo original.
      const returnId = uuidv7();
      const goods = computed.filter((c) => c.line.product.kind === "GOODS");
      await this.engine.lockValuations(tx, ctx.auth.tenantId, [sale.warehouseId], goods.map((c) => c.line.productId));
      const source = { type: "SALE_RETURN", id: returnId, reasonCode: "SALE_RETURN", note: `Devolución de ${sale.code}: ${input.reason}` };
      const costs = new Map<string, Prisma.Decimal>();
      for (const c of goods) {
        let skip = c.before; // lo ya devuelto antes consume las primeras asignaciones
        let left = c.qty; let cost = D(0);
        for (const a of c.line.allocations) {
          if (left.lte(0)) break;
          const usable = Prisma.Decimal.max(D(0), a.quantity.sub(skip));
          skip = Prisma.Decimal.max(D(0), skip.sub(a.quantity));
          const take = Prisma.Decimal.min(left, usable);
          if (take.lte(0)) continue;
          await this.engine.receive(tx, actor, { warehouseId: sale.warehouseId, productId: c.line.productId, quantity: take, unitCost: a.unitCost, type: "ADJUSTMENT_IN", existingLotId: a.lotId, source });
          cost = cost.add(take.mul(a.unitCost)); left = left.sub(take);
        }
        costs.set(c.line.id, cost.toDecimalPlaces(6));
      }

      // 3) Dinero: lo devuelto reduce lo que el cliente debe; si ya había pagado de más, se reintegra.
      const sum = (f: (c: (typeof computed)[number]) => Prisma.Decimal) => computed.reduce((s, c) => s.add(f(c)), D(0));
      const net = sum((c) => c.net); const tax = sum((c) => c.tax); const total = sum((c) => c.total);
      const newReturned = sale.returnedTotal.add(total);
      const netOwed = sale.total.sub(newReturned);
      const cashNet = sale.paidTotal.sub(sale.refundedTotal);
      const refundDue = Prisma.Decimal.max(D(0), cashNet.sub(netOwed));
      if (refundDue.gt(0) && !input.refund) throw conflict("REFUND_METHOD_REQUIRED", `Hay que reintegrar ${refundDue.toString()} al cliente: indica cómo se le devuelve el dinero.`);

      const code = await this.nextCode(tx, ctx.auth.tenantId);
      await tx.saleReturn.create({ data: { id: returnId, tenantId: ctx.auth.tenantId, branchId: sale.branchId, saleId, code, reason: input.reason, netTotal: net, taxTotal: tax, total, refundTotal: refundDue, createdById: ctx.auth.userId } });
      for (const c of computed) {
        await tx.saleReturnLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, returnId, saleLineId: c.line.id, productId: c.line.productId, quantity: c.qty, netAmount: c.net, taxAmount: c.tax, totalAmount: c.total, costTotal: costs.get(c.line.id) ?? D(0) } });
      }
      if (refundDue.gt(0)) {
        const refundId = uuidv7();
        const cashSessionId = await this.cash.attach(tx, ctx, { branchId: sale.branchId, method: input.refund!.method, amount: refundDue, direction: "OUT", sourceType: "REFUND", sourceId: refundId, note: `Reintegro de ${code}`, requestedSessionId: input.refund!.cashSessionId });
        await tx.refund.create({ data: { id: refundId, tenantId: ctx.auth.tenantId, branchId: sale.branchId, saleId, returnId, method: input.refund!.method, amount: refundDue, reference: blank(input.refund!.reference), createdById: ctx.auth.userId, cashSessionId } });
      }
      const refunded = sale.refundedTotal.add(refundDue);
      await tx.sale.update({ where: { id: saleId }, data: { returnedTotal: newReturned, refundedTotal: refunded, paymentStatus: payStatus(netOwed, sale.paidTotal.sub(refunded)) } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "sale.returned", entityType: "sale_return", entityId: returnId, branchId: sale.branchId, actorUserId: ctx.auth.userId, after: { code, sale: sale.code, total: total.toString(), refund: refundDue.toString(), reason: input.reason } });
      return toView(await tx.saleReturn.findUniqueOrThrow({ where: { id: returnId }, include }));
    });
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "SALE_RETURN", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "SALE_RETURN", prefix: "DV-", padding: 6 } });
    }
    return (await nextSequenceNumber(tx, "SALE_RETURN")).formatted;
  }
}

const toView = (r: Row): SaleReturnView => ({
  id: r.id, code: r.code, saleId: r.saleId, saleCode: r.sale.code ?? "", reason: r.reason, createdAt: r.createdAt.toISOString(),
  netTotal: r.netTotal.toString(), taxTotal: r.taxTotal.toString(), total: r.total.toString(), refundTotal: r.refundTotal.toString(),
  lines: r.lines.map((l) => ({ productCode: l.product.code, productName: l.product.name, quantity: l.quantity.toString(), netAmount: l.netAmount.toString(), taxAmount: l.taxAmount.toString(), totalAmount: l.totalAmount.toString() })),
});
