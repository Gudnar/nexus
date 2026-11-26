import { Inject, Injectable } from "@nestjs/common";
import type { CollectMode, PaymentInput, SalesSettings, SaleConfirmRequest, SaleDetail, SaleInput, SalePatch, SaleStatus, SaleSummary } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { CashService } from "../cash/cash.service";
import { InventoryService } from "../inventory/inventory.service";
import { ReservationsService } from "../inventory/reservations.service";
import { StockEngine } from "../inventory/stock-engine";
import { PricingService } from "../pricing/pricing.service";
import { lineData, lineInclude, lineView, priceLines, totalsOf } from "./doc-lines";

const COLLECT_MODE_KEY = "sales.collectMode";
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

const include = {
  customer: { select: { id: true, code: true, name: true, taxId: true, phone: true } },
  warehouse: { select: { id: true, code: true, name: true } },
} satisfies Prisma.SaleInclude;
const detailInclude = {
  ...include,
  lines: { include: { ...lineInclude, allocations: { include: { lot: { select: { code: true } } } } }, orderBy: { id: "asc" as const } },
  payments: { orderBy: { receivedAt: "asc" as const } },
  returns: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.SaleInclude;
type Row = Prisma.SaleGetPayload<{ include: typeof include }>;
type DetailRow = Prisma.SaleGetPayload<{ include: typeof detailInclude }>;

/**
 * Ventas (plan §11.2). Borrador → confirmada → anulada, con el cobro como dimensión aparte. Confirmar descuenta stock en la
 * misma transacción (con el lote elegido por la política de valoración), fija el costo y el correlativo, y registra los cobros.
 * El precio y los impuestos de cada línea quedan guardados como foto: cambiar una lista o una tasa después no altera lo vendido.
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(StockEngine) private readonly engine: StockEngine,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(CashService) private readonly cash: CashService,
  ) {}

  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  private async warehouseFor(ctx: RequestContext, tx: Tx, id: string) {
    const w = await tx.warehouse.findUnique({ where: { id }, select: { id: true, branchId: true, status: true, kind: true } });
    if (!w) throw notFound("Almacén");
    if (!(await this.branches(ctx, tx, "OPERATE")).includes(w.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese almacén.");
    if (w.status !== "ACTIVE" || w.kind !== "STORAGE") throw conflict("WAREHOUSE_INACTIVE", "El almacén no está disponible.");
    return w;
  }

  // ───────────── Consulta ─────────────

  list(ctx: RequestContext, q: { status?: SaleStatus; customerId?: string; paymentStatus?: string }): Promise<SaleSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.sale.findMany({
        where: { branchId: { in: ids }, ...(q.status ? { status: q.status } : {}), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.paymentStatus ? { paymentStatus: q.paymentStatus as "UNPAID" } : {}) },
        orderBy: { createdAt: "desc" }, take: 100, include,
      });
      return rows.map(toSummary);
    });
  }

  get(ctx: RequestContext, id: string): Promise<SaleDetail> {
    return ctx.run(async (tx) => this.detail(ctx, tx, id));
  }

  private async detail(ctx: RequestContext, tx: Tx, id: string): Promise<SaleDetail> {
    const s = await tx.sale.findUnique({ where: { id }, include: detailInclude });
    if (!s || !(await this.branches(ctx, tx, "VIEW")).includes(s.branchId)) throw notFound("Venta");
    const quote = s.quoteId ? await tx.quote.findUnique({ where: { id: s.quoteId }, select: { id: true, code: true } }) : null;
    const returned = await tx.saleReturnLine.groupBy({ by: ["saleLineId"], where: { ret: { saleId: id } }, _sum: { quantity: true } });
    const d = toDetail(s, quote, new Map(returned.map((r) => [r.saleLineId, r._sum.quantity ?? D(0)])));

    // Datos para mostrar el detalle: ruta de la categoría de cada producto, quién vendió, la sucursal y quién cobró.
    const [cats, prods, branch] = await Promise.all([
      tx.category.findMany({ select: { id: true, name: true, parentId: true } }),
      tx.product.findMany({ where: { id: { in: [...new Set(s.lines.map((l) => l.productId))] } }, select: { id: true, categoryId: true } }),
      tx.branch.findUnique({ where: { id: s.branchId }, select: { name: true } }),
    ]);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const path = (id: string | null): string | null => {
      const parts: string[] = [];
      for (let c = id ? byId.get(id) : undefined, guard = 0; c && guard < 10; c = c.parentId ? byId.get(c.parentId) : undefined, guard++) parts.unshift(c.name);
      return parts.length ? parts.join(" / ") : null;
    };
    const catOf = new Map(prods.map((p) => [p.id, path(p.categoryId)]));
    const userIds = [...new Set([s.sellerId ?? s.createdById, ...s.payments.map((p) => p.createdById)].filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (userIds.length) for (const m of await tx.membership.findMany({ where: { userId: { in: userIds } }, select: { userId: true, user: { select: { name: true } } } })) names.set(m.userId, m.user.name);
    return {
      ...d, seller: names.get(s.sellerId ?? s.createdById ?? "") ?? null, branchName: branch?.name ?? null,
      lines: d.lines.map((l) => ({ ...l, category: catOf.get(l.productId) ?? null })),
      payments: d.payments.map((p, i) => ({ ...p, by: names.get(s.payments[i]?.createdById ?? "") ?? null })),
    };
  }

  // ───────────── Borrador ─────────────

  async create(ctx: RequestContext, input: SaleInput): Promise<SaleDetail> {
    await ctx.tenantInfo(); const perms = await ctx.permissions(); // fuera de la transacción: no pedir una 2.ª conexión del pool
    return ctx.run(async (tx) => {
      const wh = await this.warehouseFor(ctx, tx, input.warehouseId);
      const customer = input.customerId ? await this.customer(tx, input.customerId) : null;
      const priced = await priceLines(this.pricing, ctx, tx, perms, { branchId: wh.branchId, channel: input.channel, priceListId: input.priceListId ?? undefined, preferListId: customer?.defaultPriceListId, skipTax: !input.withTax }, input.lines);
      const id = uuidv7();
      const t = totalsOf(priced.lines);
      await tx.sale.create({
        data: {
          id, tenantId: ctx.auth.tenantId, branchId: wh.branchId, warehouseId: wh.id, customerId: customer?.id ?? null, sellerId: ctx.auth.userId, channel: input.channel,
          withTax: input.withTax, billingName: blank(input.billingName), billingTaxId: blank(input.billingTaxId),
          currency: priced.currency, netTotal: t.net, taxTotal: t.tax, discountTotal: t.discount, total: t.total, note: blank(input.note), createdById: ctx.auth.userId,
        },
      });
      for (const l of priced.lines) await tx.saleLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, saleId: id, ...lineData(l, ctx.auth.userId) } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "sale.drafted", entityType: "sale", entityId: id, branchId: wh.branchId, actorUserId: ctx.auth.userId, after: { lines: input.lines.length, total: t.total.toString() } });
      return this.detail(ctx, tx, id);
    });
  }

  async update(ctx: RequestContext, id: string, patch: SalePatch): Promise<SaleDetail> {
    await ctx.tenantInfo(); const perms = await ctx.permissions();
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id);
      if (s.status !== "DRAFT") throw conflict("SALE_NOT_EDITABLE", "Solo se edita una venta en borrador.");
      let branchId = s.branchId; let warehouseId = s.warehouseId;
      if (patch.warehouseId && patch.warehouseId !== s.warehouseId) { const wh = await this.warehouseFor(ctx, tx, patch.warehouseId); branchId = wh.branchId; warehouseId = wh.id; }
      const customerId = patch.customerId !== undefined ? patch.customerId : s.customerId;
      const customer = customerId ? await this.customer(tx, customerId) : null;

      const existing = patch.lines ?? (await tx.saleLine.findMany({ where: { saleId: id }, select: { productId: true, quantity: true, discountPct: true, appliedUnitPrice: true, overrideReason: true } })).map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber(), discountPct: l.discountPct.toNumber(), unitPrice: l.appliedUnitPrice?.toNumber() ?? null, overrideReason: l.overrideReason }));
      // Reprecio de todo el borrador si cambió algo que influye en el precio (líneas, almacén/sucursal, cliente o lista).
      const priced = await priceLines(this.pricing, ctx, tx, perms, { branchId, channel: s.channel, priceListId: patch.priceListId ?? undefined, preferListId: customer?.defaultPriceListId, skipTax: !(patch.withTax ?? s.withTax) }, existing);
      const t = totalsOf(priced.lines);
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      for (const l of priced.lines) await tx.saleLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, saleId: id, ...lineData(l, ctx.auth.userId) } });
      await tx.sale.update({
        where: { id },
        data: { branchId, warehouseId, customerId: customer?.id ?? null, currency: priced.currency, netTotal: t.net, taxTotal: t.tax, discountTotal: t.discount, total: t.total, ...(patch.note !== undefined ? { note: blank(patch.note) } : {}),
          ...(patch.withTax !== undefined ? { withTax: patch.withTax } : {}), ...(patch.billingName !== undefined ? { billingName: blank(patch.billingName) } : {}), ...(patch.billingTaxId !== undefined ? { billingTaxId: blank(patch.billingTaxId) } : {}) },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "sale.draft_updated", entityType: "sale", entityId: id, branchId, actorUserId: ctx.auth.userId, after: { total: t.total.toString() } });
      return this.detail(ctx, tx, id);
    });
  }

  /** Descarta un borrador (no deja rastro de stock ni de cobros). */
  discard(ctx: RequestContext, id: string): Promise<SaleDetail> {
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id);
      if (s.status !== "DRAFT") throw conflict("INVALID_STATE", "Solo se descarta un borrador. Una venta confirmada se anula.");
      await tx.sale.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.auth.userId, cancelReason: "Borrador descartado" } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "sale.discarded", entityType: "sale", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId });
      return this.detail(ctx, tx, id);
    });
  }

  // ───────────── Confirmación ─────────────

  // ───────────── Dónde se cobra ─────────────

  private async collectMode(tx: Tx): Promise<CollectMode> {
    const s = await tx.tenantSetting.findFirst({ where: { key: COLLECT_MODE_KEY } });
    return (s?.value as { mode?: string } | null)?.mode === "AT_CASHIER" ? "AT_CASHIER" : "AT_POS";
  }
  getSettings(ctx: RequestContext): Promise<SalesSettings> { return ctx.run(async (tx) => ({ collectMode: await this.collectMode(tx) })); }
  setSettings(ctx: RequestContext, input: SalesSettings): Promise<SalesSettings> {
    return ctx.run(async (tx) => {
      await tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: ctx.auth.tenantId, key: COLLECT_MODE_KEY } },
        create: { tenantId: ctx.auth.tenantId, key: COLLECT_MODE_KEY, value: { mode: input.collectMode } }, update: { value: { mode: input.collectMode } },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "sales.settings_changed", entityType: "tenant_setting", entityId: COLLECT_MODE_KEY, actorUserId: ctx.auth.userId, after: input });
      return input;
    });
  }

  /**
   * Confirma: reprecia el borrador (salvo el que viene de una cotización aceptada, que conserva su precio), valida crédito,
   * descuenta stock con asignación de lote, fija costo y correlativo, y registra los cobros recibidos en el acto.
   */
  async confirm(ctx: RequestContext, id: string, input: SaleConfirmRequest): Promise<SaleDetail> {
    await ctx.tenantInfo(); const perms = await ctx.permissions();
    return ctx.run(async (tx) => {
      if ((await this.collectMode(tx)) === "AT_CASHIER" && !perms.has("sales.collect_pending")) {
        throw forbid("COLLECT_BY_CASHIER", "En esta empresa las ventas las cobra el cajero desde «Ventas pendientes de cobro». Guarda la venta y pásala a caja.");
      }
      const actor = await this.inventory.actor(ctx);
      const s = await this.lock(ctx, tx, id);
      if (s.status !== "DRAFT") throw conflict("INVALID_STATE", "Solo se confirma una venta en borrador.");
      const lines = await tx.saleLine.findMany({ where: { saleId: id }, include: { product: { select: { code: true, kind: true } } }, orderBy: { productId: "asc" } });
      if (lines.length === 0) throw badRequest("EMPTY_SALE", "La venta no tiene líneas.");
      const wh = await this.warehouseFor(ctx, tx, s.warehouseId);

      // 1) Precio vigente (las ventas de cotización conservan el precio acordado).
      let total = s.total;
      let net = s.netTotal; let tax = s.taxTotal; let discount = s.discountTotal;
      if (!s.quoteId) {
        const lists = new Map(lines.map((l) => [l.productId, l.priceListId]));
        // Los descuentos y sobreprecios ya los autorizó quien armó el borrador: quien confirma no necesita ese permiso.
        const priced = await priceLines(this.pricing, ctx, tx, perms, { branchId: s.branchId, channel: s.channel, lists, trusted: true, skipTax: !s.withTax }, lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber(), discountPct: l.discountPct.toNumber(), unitPrice: l.appliedUnitPrice?.toNumber() ?? null, overrideReason: l.overrideReason })));
        const t = totalsOf(priced.lines);
        for (const l of priced.lines) {
          await tx.saleLine.update({ where: { tenantId_saleId_productId: { tenantId: ctx.auth.tenantId, saleId: id, productId: l.productId } }, data: lineData(l, lines.find((x) => x.productId === l.productId)?.overrideById) });
        }
        total = t.total; net = t.net; tax = t.tax; discount = t.discount;
      }

      // 2) Cobros y crédito.
      const paid = input.payments.reduce((sum, p) => sum.add(D(p.amount)), D(0));
      if (paid.gt(total)) throw conflict("OVERPAYMENT", "Los cobros superan el total de la venta.");
      const credit = total.sub(paid);
      if (credit.gt(0)) {
        if (!s.customerId) throw conflict("CUSTOMER_REQUIRED_FOR_CREDIT", "Para dejar saldo a crédito la venta necesita un cliente.");
        const cust = await tx.customer.findUniqueOrThrow({ where: { id: s.customerId }, select: { creditLimit: true, status: true } });
        if (cust.creditLimit) {
          const owed = (await tx.sale.aggregate({ where: { customerId: s.customerId, status: "CONFIRMED", paymentStatus: { not: "PAID" } }, _sum: { total: true, paidTotal: true, returnedTotal: true, refundedTotal: true } }))._sum;
          const outstanding = (owed.total ?? D(0)).sub(owed.returnedTotal ?? D(0)).sub(owed.paidTotal ?? D(0)).add(owed.refundedTotal ?? D(0));
          if (outstanding.add(credit).gt(cust.creditLimit)) throw conflict("CREDIT_LIMIT_EXCEEDED", `Supera el límite de crédito del cliente (deuda actual ${outstanding.toString()}, límite ${cust.creditLimit.toString()}).`);
        }
      }

      // 3) Stock: bloqueos en orden estable y salida por línea (los servicios no tienen stock).
      const goods = lines.filter((l) => l.product.kind === "GOODS");
      await this.engine.lockValuations(tx, ctx.auth.tenantId, [wh.id], goods.map((l) => l.productId));
      // Lo que la cotización tenía reservado se consume con esta venta: así la propia venta puede llevarse ese stock.
      if (s.quoteId) await this.reservations.closeForSource(tx, ctx.auth.tenantId, "QUOTE", s.quoteId, "CONSUMED");
      const source = { type: "SALE", id, reasonCode: "SALE" };
      for (const l of lines) {
        if (l.product.kind !== "GOODS") continue;
        const parts = await this.engine.issue(tx, actor, { warehouseId: wh.id, productId: l.productId, quantity: l.quantity, type: "ISSUE", source });
        let cost = D(0);
        for (const p of parts) {
          await tx.saleLineAllocation.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, saleId: id, lineId: l.id, productId: l.productId, lotId: p.lotId, quantity: p.quantity, unitCost: p.unitCost, movementId: p.movementId } });
          cost = cost.add(p.totalCost);
        }
        await tx.saleLine.update({ where: { id: l.id }, data: { costTotal: cost } });
      }

      // 4) Correlativo al final (bloqueo corto), cobros y estado.
      const code = await this.nextCode(tx, ctx.auth.tenantId);
      for (const p of input.payments) {
        const paymentId = uuidv7();
        const cashSessionId = await this.cash.attach(tx, ctx, { branchId: s.branchId, method: p.method, amount: p.amount, direction: "IN", sourceType: "SALE_PAYMENT", sourceId: paymentId, note: `Venta ${code}`, requestedSessionId: p.cashSessionId });
        await tx.payment.create({ data: { id: paymentId, tenantId: ctx.auth.tenantId, branchId: s.branchId, saleId: id, method: p.method, amount: p.amount, reference: blank(p.reference), createdById: ctx.auth.userId, cashSessionId } });
      }
      await tx.sale.update({
        where: { id },
        data: {
          code, status: "CONFIRMED", confirmedAt: new Date(), confirmedById: ctx.auth.userId, netTotal: net, taxTotal: tax, discountTotal: discount, total, paidTotal: paid,
          dueDate: input.dueDate ? await this.dueDateFrom(input.dueDate, actor.today) : await this.dueDate(tx, s.customerId, actor.today),
          paymentStatus: payStatus(total, paid),
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "sale.confirmed", entityType: "sale", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { code, total: total.toString(), paid: paid.toString() } });
      return this.detail(ctx, tx, id);
    });
  }

  // ───────────── Cobros ─────────────

  /** Registra un cobro sobre una venta confirmada (hecho financiero inmutable). */
  collect(ctx: RequestContext, id: string, input: PaymentInput): Promise<SaleDetail> {
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id);
      if (s.status !== "CONFIRMED") throw conflict("INVALID_STATE", "Solo se cobra una venta confirmada.");
      const sale = await tx.sale.findUniqueOrThrow({ where: { id }, select: { total: true, paidTotal: true, returnedTotal: true, refundedTotal: true } });
      const amount = D(input.amount);
      const net = sale.total.sub(sale.returnedTotal);
      const balance = net.sub(sale.paidTotal.sub(sale.refundedTotal));
      if (amount.gt(balance)) throw conflict("OVERPAYMENT", `El cobro supera el saldo pendiente (${balance.toString()}).`);
      const paymentId = uuidv7();
      const cashSessionId = await this.cash.attach(tx, ctx, { branchId: s.branchId, method: input.method, amount, direction: "IN", sourceType: "SALE_PAYMENT", sourceId: paymentId, note: "Cobro posterior de venta", requestedSessionId: input.cashSessionId });
      await tx.payment.create({ data: { id: paymentId, tenantId: ctx.auth.tenantId, branchId: s.branchId, saleId: id, method: input.method, amount, reference: blank(input.reference), createdById: ctx.auth.userId, cashSessionId } });
      const paid = sale.paidTotal.add(amount);
      await tx.sale.update({ where: { id }, data: { paidTotal: paid, paymentStatus: payStatus(net, paid.sub(sale.refundedTotal)) } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "sale.payment_recorded", entityType: "sale", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { method: input.method, amount: amount.toString() } });
      return this.detail(ctx, tx, id);
    });
  }

  // ───────────── Anulación ─────────────

  /**
   * Anula una venta confirmada: devuelve el stock a su lote y costo originales y deja registrado quién, cuándo y por qué.
   * Con cobros registrados no se anula (primero habría que devolver el dinero: llega con caja y devoluciones).
   */
  async voidSale(ctx: RequestContext, id: string, reason: string): Promise<SaleDetail> {
    await ctx.tenantInfo();
    return ctx.run(async (tx) => {
      const actor = await this.inventory.actor(ctx);
      const s = await this.lock(ctx, tx, id);
      if (s.status !== "CONFIRMED") throw conflict("INVALID_STATE", "Solo se anula una venta confirmada.");
      const sale = await tx.sale.findUniqueOrThrow({ where: { id }, select: { paidTotal: true, refundedTotal: true, returnedTotal: true, code: true, warehouseId: true } });
      if (sale.returnedTotal.gt(0)) throw conflict("HAS_RETURNS", "La venta tiene devoluciones registradas: ya no se puede anular completa.");
      if (sale.paidTotal.sub(sale.refundedTotal).gt(0)) throw conflict("HAS_PAYMENTS", "La venta tiene cobros registrados: hay que devolver el dinero antes de anularla.");
      const allocs = await tx.saleLineAllocation.findMany({ where: { saleId: id }, orderBy: [{ productId: "asc" }, { id: "asc" }] });
      await this.engine.lockValuations(tx, ctx.auth.tenantId, [sale.warehouseId], allocs.map((a) => a.productId));
      for (const a of allocs) await this.engine.reverse(tx, actor, a.movementId, `Anulación de venta ${sale.code}: ${reason}`);
      await tx.sale.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.auth.userId, cancelReason: reason } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "sale.voided", entityType: "sale", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { code: sale.code, reason } });
      return this.detail(ctx, tx, id);
    });
  }

  // ───────────── Internos ─────────────

  private async lock(ctx: RequestContext, tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM sale WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const s = await tx.sale.findUnique({ where: { id }, select: { id: true, status: true, withTax: true, branchId: true, warehouseId: true, customerId: true, channel: true, quoteId: true, total: true, netTotal: true, taxTotal: true, discountTotal: true } });
    if (!s) throw notFound("Venta");
    if (!(await this.branches(ctx, tx, "OPERATE")).includes(s.branchId)) {
      if (!(await this.branches(ctx, tx, "VIEW")).includes(s.branchId)) throw notFound("Venta");
      throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de esa venta.");
    }
    return s;
  }

  /** Fecha límite elegida a mano: no puede ser anterior a hoy. */
  private async dueDateFrom(date: string, today: string): Promise<Date> {
    if (date < today) throw badRequest("INVALID_DUE_DATE", "La fecha límite de pago no puede ser anterior a hoy.");
    return new Date(`${date}T00:00:00Z`);
  }

  /** Vencimiento del saldo: fecha de la venta + plazo de pago del cliente (0 días = vence el mismo día). */
  private async dueDate(tx: Tx, customerId: string | null, today: string): Promise<Date> {
    const terms = customerId ? (await tx.customer.findUnique({ where: { id: customerId }, select: { paymentTermsDays: true } }))?.paymentTermsDays ?? 0 : 0;
    return new Date(new Date(`${today}T00:00:00Z`).getTime() + terms * 86_400_000);
  }

  private async customer(tx: Tx, id: string) {
    const c = await tx.customer.findUnique({ where: { id }, select: { id: true, status: true, defaultPriceListId: true } });
    if (!c) throw notFound("Cliente");
    if (c.status !== "ACTIVE") throw conflict("CUSTOMER_INACTIVE", "El cliente está inactivo.");
    return c;
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "SALE", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "SALE", prefix: "V-", padding: 6 } });
    }
    return (await nextSequenceNumber(tx, "SALE")).formatted;
  }
}

/** Estado de cobro sobre el neto (total − devuelto) y el dinero neto recibido (cobrado − reintegrado). */
export const payStatus = (total: Prisma.Decimal, paid: Prisma.Decimal) => (total.lte(0) || paid.gte(total) ? "PAID" : paid.gt(0) ? "PARTIAL" : "UNPAID") as "PAID" | "PARTIAL" | "UNPAID";

const toSummary = (s: Row): SaleSummary => ({
  id: s.id, code: s.code, status: s.status, paymentStatus: s.paymentStatus, currency: s.currency, customer: s.customer, warehouse: s.warehouse,
  total: s.total.toString(), paidTotal: s.paidTotal.toString(), createdAt: s.createdAt.toISOString(), confirmedAt: s.confirmedAt?.toISOString() ?? null,
  returnedTotal: s.returnedTotal.toString(), refundedTotal: s.refundedTotal.toString(),
  /** Lo que el cliente aún debe: total − devuelto − (cobrado − reintegrado), sin bajar de cero. */
  balance: Prisma.Decimal.max(D(0), s.total.sub(s.returnedTotal).sub(s.paidTotal.sub(s.refundedTotal))).toString(),
});
const toDetail = (s: DetailRow, quote: { id: string; code: string } | null, returned: Map<string, Prisma.Decimal>): SaleDetail => ({
  ...toSummary(s), withTax: s.withTax, billingName: s.billingName, billingTaxId: s.billingTaxId, dueDate: s.dueDate ? s.dueDate.toISOString().slice(0, 10) : null, warehouseId: s.warehouseId, branchId: s.branchId, note: s.note, netTotal: s.netTotal.toString(), taxTotal: s.taxTotal.toString(), discountTotal: s.discountTotal.toString(), cancelReason: s.cancelReason, quote,
  lines: s.lines.map((l) => ({ ...lineView(l), returnedQty: (returned.get(l.id) ?? D(0)).toString() })),
  returns: s.returns.map((r) => ({ id: r.id, code: r.code, reason: r.reason, total: r.total.toString(), refundTotal: r.refundTotal.toString(), createdAt: r.createdAt.toISOString() })),
  payments: s.payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount.toString(), reference: p.reference, receivedAt: p.receivedAt.toISOString() })),
});
