import { Inject, Injectable } from "@nestjs/common";
import type { QuoteConvertRequest, QuoteReserveRequest, QuoteDetail, QuoteInput, QuotePatch, QuoteStatus, QuoteSummary, SaleDetail } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { Clock } from "../access/clock";
import { localParts } from "../access/schedule";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { ReservationsService } from "../inventory/reservations.service";
import { PricingService } from "../pricing/pricing.service";
import { lineData, lineInclude, lineView, priceLines, totalsOf } from "./doc-lines";
import { SalesService } from "./sales.service";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);

const include = { customer: { select: { id: true, code: true, name: true } } } satisfies Prisma.QuoteInclude;
const detailInclude = { ...include, lines: { include: lineInclude, orderBy: { id: "asc" as const } } } satisfies Prisma.QuoteInclude;
type Row = Prisma.QuoteGetPayload<{ include: typeof include }>;
type DetailRow = Prisma.QuoteGetPayload<{ include: typeof detailInclude }>;

/**
 * Cotizaciones (plan §11.1): borrador → enviada → aceptada / rechazada / cancelada; vencen por fecha. El precio de cada línea
 * queda fijado como foto al cotizar, y la conversión a venta lo CONSERVA (no cambia silenciosamente las condiciones) y es
 * idempotente: una cotización no genera dos ventas.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private async today(ctx: RequestContext): Promise<string> {
    return localParts(this.clock.now(), (await ctx.tenantInfo()).timezone).date;
  }
  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  async list(ctx: RequestContext, q: { status?: QuoteStatus; customerId?: string }): Promise<QuoteSummary[]> {
    const today = await this.today(ctx);
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.quote.findMany({ where: { branchId: { in: ids }, ...(q.status ? { status: q.status } : {}), ...(q.customerId ? { customerId: q.customerId } : {}) }, orderBy: { createdAt: "desc" }, take: 100, include });
      return rows.map((r) => toSummary(r, today));
    });
  }

  async get(ctx: RequestContext, id: string): Promise<QuoteDetail> {
    const today = await this.today(ctx);
    return ctx.run((tx) => this.detail(ctx, tx, id, today));
  }

  private async detail(ctx: RequestContext, tx: Tx, id: string, today: string): Promise<QuoteDetail> {
    const q = await tx.quote.findUnique({ where: { id }, include: detailInclude });
    if (!q || !(await this.branches(ctx, tx, "VIEW")).includes(q.branchId)) throw notFound("Cotización");
    const reservation = await tx.stockReservation.findFirst({ where: { sourceType: "QUOTE", sourceId: id }, orderBy: { createdAt: "desc" }, select: { id: true, code: true, status: true, expiresAt: true } });
    return toDetail(q, today, reservation);
  }

  async create(ctx: RequestContext, input: QuoteInput): Promise<QuoteDetail> {
    const today = await this.today(ctx); const perms = await ctx.permissions();
    return ctx.run(async (tx) => {
      if (!(await this.branches(ctx, tx, "OPERATE")).includes(input.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a esa sucursal.");
      if (input.validUntil < today) throw badRequest("INVALID_VALIDITY", "La vigencia no puede estar en el pasado.");
      const customer = input.customerId ? await this.customer(tx, input.customerId) : null;
      const priced = await priceLines(this.pricing, ctx, tx, perms, { branchId: input.branchId, priceListId: input.priceListId ?? undefined, preferListId: customer?.defaultPriceListId }, input.lines);
      const t = totalsOf(priced.lines);
      const id = uuidv7();
      const code = await this.nextCode(tx, ctx.auth.tenantId);
      await tx.quote.create({
        data: {
          id, tenantId: ctx.auth.tenantId, branchId: input.branchId, code, customerId: customer?.id ?? null, prospectName: blank(input.prospectName), validUntil: dateOnly(input.validUntil),
          currency: priced.currency, note: blank(input.note), netTotal: t.net, taxTotal: t.tax, total: t.total, createdById: ctx.auth.userId,
        },
      });
      for (const l of priced.lines) await tx.quoteLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, quoteId: id, ...lineData(l, ctx.auth.userId) } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "quote.created", entityType: "quote", entityId: id, branchId: input.branchId, actorUserId: ctx.auth.userId, after: { code, total: t.total.toString() } });
      return this.detail(ctx, tx, id, today);
    });
  }

  async update(ctx: RequestContext, id: string, patch: QuotePatch): Promise<QuoteDetail> {
    const today = await this.today(ctx); const perms = await ctx.permissions();
    return ctx.run(async (tx) => {
      const q = await this.lock(ctx, tx, id);
      if (q.status !== "DRAFT") throw conflict("QUOTE_NOT_EDITABLE", "Solo se edita una cotización en borrador.");
      if (patch.validUntil && patch.validUntil < today) throw badRequest("INVALID_VALIDITY", "La vigencia no puede estar en el pasado.");
      const customerId = patch.customerId !== undefined ? patch.customerId : q.customerId;
      const customer = customerId ? await this.customer(tx, customerId) : null;
      const existing = patch.lines ?? (await tx.quoteLine.findMany({ where: { quoteId: id }, select: { productId: true, quantity: true, discountPct: true, appliedUnitPrice: true, overrideReason: true } })).map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber(), discountPct: l.discountPct.toNumber(), unitPrice: l.appliedUnitPrice?.toNumber() ?? null, overrideReason: l.overrideReason }));
      const priced = await priceLines(this.pricing, ctx, tx, perms, { branchId: q.branchId, priceListId: patch.priceListId ?? undefined, preferListId: customer?.defaultPriceListId }, existing);
      const t = totalsOf(priced.lines);
      const prospect = patch.prospectName !== undefined ? blank(patch.prospectName) : q.prospectName;
      if (!customer && !prospect) throw badRequest("PARTY_REQUIRED", "Indica el cliente o el nombre del prospecto.");
      await tx.quoteLine.deleteMany({ where: { quoteId: id } });
      for (const l of priced.lines) await tx.quoteLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, quoteId: id, ...lineData(l, ctx.auth.userId) } });
      await tx.quote.update({
        where: { id },
        data: {
          customerId: customer?.id ?? null, prospectName: prospect, currency: priced.currency, netTotal: t.net, taxTotal: t.tax, total: t.total,
          ...(patch.validUntil ? { validUntil: dateOnly(patch.validUntil) } : {}), ...(patch.note !== undefined ? { note: blank(patch.note) } : {}),
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "quote.updated", entityType: "quote", entityId: id, branchId: q.branchId, actorUserId: ctx.auth.userId, after: { total: t.total.toString() } });
      return this.detail(ctx, tx, id, today);
    });
  }

  send(ctx: RequestContext, id: string): Promise<QuoteDetail> {
    return this.move(ctx, id, "quote.sent", (q, expired) => {
      if (q.status !== "DRAFT") throw conflict("INVALID_STATE", "Solo se envía una cotización en borrador.");
      if (expired) throw conflict("QUOTE_EXPIRED", "La cotización está vencida: extiende su vigencia antes de enviarla.");
      return { status: "SENT", sentAt: new Date() };
    });
  }
  accept(ctx: RequestContext, id: string): Promise<QuoteDetail> {
    return this.move(ctx, id, "quote.accepted", (q, expired) => {
      if (q.status !== "SENT") throw conflict("INVALID_STATE", "Solo se acepta una cotización enviada.");
      if (expired) throw conflict("QUOTE_EXPIRED", "La cotización venció.");
      return { status: "ACCEPTED", decidedAt: new Date() };
    });
  }
  reject(ctx: RequestContext, id: string): Promise<QuoteDetail> {
    return this.move(ctx, id, "quote.rejected", (q) => {
      if (q.status !== "SENT") throw conflict("INVALID_STATE", "Solo se rechaza una cotización enviada.");
      return { status: "REJECTED", decidedAt: new Date() };
    });
  }
  cancel(ctx: RequestContext, id: string): Promise<QuoteDetail> {
    return this.move(ctx, id, "quote.cancelled", (q) => {
      if (q.convertedSaleId) throw conflict("ALREADY_CONVERTED", "La cotización ya se convirtió en una venta.");
      if (q.status !== "DRAFT" && q.status !== "SENT" && q.status !== "ACCEPTED") throw conflict("INVALID_STATE", "Esta cotización ya no se puede cancelar.");
      return { status: "CANCELLED", decidedAt: new Date() };
    });
  }

  private async move(ctx: RequestContext, id: string, action: string, fn: (q: { status: QuoteStatus; convertedSaleId: string | null }, expired: boolean) => Prisma.QuoteUpdateInput): Promise<QuoteDetail> {
    const today = await this.today(ctx);
    return ctx.run(async (tx) => {
      const q = await this.lock(ctx, tx, id);
      const data = fn(q, q.validUntil < dateOnly(today));
      await tx.quote.update({ where: { id }, data });
      if (data.status === "CANCELLED" || data.status === "REJECTED") await this.reservations.closeForSource(tx, ctx.auth.tenantId, "QUOTE", id, "RELEASED");
      await writeAudit(tx, ctx.auth.tenantId, { action, entityType: "quote", entityId: id, branchId: q.branchId, actorUserId: ctx.auth.userId, before: { status: q.status }, after: { status: data.status } });
      return this.detail(ctx, tx, id, today);
    });
  }

  /**
   * Convierte una cotización ACEPTADA en una venta en borrador, conservando precios, descuentos e impuestos acordados.
   * Es idempotente (la segunda llamada devuelve la misma venta). Stock y crédito se validan al confirmar esa venta.
   */
  async convert(ctx: RequestContext, id: string, input: QuoteConvertRequest): Promise<SaleDetail> {
    const today = await this.today(ctx);
    const saleId = await ctx.run(async (tx) => {
      const q = await this.lock(ctx, tx, id);
      if (q.convertedSaleId) return q.convertedSaleId;
      if (q.status !== "ACCEPTED") throw conflict("INVALID_STATE", "Solo se convierte una cotización aceptada.");
      if (q.validUntil < dateOnly(today)) throw conflict("QUOTE_EXPIRED", "La cotización venció.");
      const wh = await tx.warehouse.findUnique({ where: { id: input.warehouseId }, select: { id: true, branchId: true, status: true, kind: true } });
      if (!wh) throw notFound("Almacén");
      if (!(await this.branches(ctx, tx, "OPERATE")).includes(wh.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese almacén.");
      if (wh.status !== "ACTIVE" || wh.kind !== "STORAGE") throw conflict("WAREHOUSE_INACTIVE", "El almacén no está disponible.");
      if (wh.branchId !== q.branchId) throw badRequest("BRANCH_MISMATCH", "El almacén debe ser de la misma sucursal de la cotización (los precios dependen de ella).");
      if (q.customerId) await this.customer(tx, q.customerId);

      const full = await tx.quote.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      const sid = uuidv7();
      await tx.sale.create({
        data: {
          id: sid, tenantId: ctx.auth.tenantId, branchId: wh.branchId, warehouseId: wh.id, customerId: full.customerId, sellerId: ctx.auth.userId, quoteId: id, currency: full.currency,
          netTotal: full.netTotal, taxTotal: full.taxTotal, discountTotal: 0, total: full.total, note: full.note, createdById: ctx.auth.userId,
        },
      });
      let discount = D(0);
      for (const l of full.lines) {
        await tx.saleLine.create({
          data: {
            id: uuidv7(), tenantId: ctx.auth.tenantId, saleId: sid, productId: l.productId, quantity: l.quantity, priceListId: l.priceListId, priceMode: l.priceMode, scalingMode: l.scalingMode,
            listUnitPrice: l.listUnitPrice, discountPct: l.discountPct, netAmount: l.netAmount, taxAmount: l.taxAmount, totalAmount: l.totalAmount,
            appliedUnitPrice: l.appliedUnitPrice, overrideReason: l.overrideReason, overrideById: l.overrideById,
            taxes: l.taxes as Prisma.InputJsonValue, breakdown: l.breakdown as Prisma.InputJsonValue,
          },
        });
        discount = discount.add(l.listUnitPrice.mul(l.quantity).mul(l.discountPct).div(100));
      }
      await tx.sale.update({ where: { id: sid }, data: { discountTotal: discount.toDecimalPlaces(6) } });
      await tx.quote.update({ where: { id }, data: { convertedSaleId: sid } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "quote.converted", entityType: "quote", entityId: id, branchId: q.branchId, actorUserId: ctx.auth.userId, after: { saleId: sid } });
      return sid;
    });
    return this.sales.get(ctx, saleId);
  }

  /**
   * Aparta el stock de una cotización enviada o aceptada, con vigencia (como máximo hasta el fin de la cotización). Se consume al
   * confirmar la venta que nace de ella, y se libera sola si vence o si la cotización se cancela o rechaza.
   */
  async reserve(ctx: RequestContext, id: string, input: QuoteReserveRequest): Promise<QuoteDetail> {
    const today = await this.today(ctx);
    return ctx.run(async (tx) => {
      const q = await this.lock(ctx, tx, id);
      if (q.status !== "SENT" && q.status !== "ACCEPTED") throw conflict("INVALID_STATE", "Solo se reserva stock de una cotización enviada o aceptada.");
      if (q.validUntil < dateOnly(today)) throw conflict("QUOTE_EXPIRED", "La cotización venció.");
      if (q.convertedSaleId) throw conflict("ALREADY_CONVERTED", "La cotización ya se convirtió en venta: la reserva se hace en la venta.");
      await this.reservations.closeForSource(tx, ctx.auth.tenantId, "QUOTE", id, "RELEASED").then(async (n) => {
        if (n > 0) throw conflict("ALREADY_RESERVED", "La cotización ya tiene una reserva vigente: libérala antes de reservar de nuevo.");
      });
      const lines = await tx.quoteLine.findMany({ where: { quoteId: id, product: { kind: "GOODS" } }, select: { productId: true, quantity: true } });
      if (lines.length === 0) throw badRequest("NOTHING_TO_RESERVE", "La cotización no tiene productos con inventario.");
      await this.reservations.createTx(ctx, tx, {
        warehouseId: input.warehouseId, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), hours: input.hours,
        note: `Cotización ${id}`, source: { type: "QUOTE", id }, notAfter: new Date(dateOnly(day(q.validUntil)).getTime() + 86_400_000),
      });
      return this.detail(ctx, tx, id, today);
    });
  }

  // ───────────── Internos ─────────────

  private async lock(ctx: RequestContext, tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM quote WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const q = await tx.quote.findUnique({ where: { id }, select: { id: true, status: true, branchId: true, customerId: true, prospectName: true, validUntil: true, convertedSaleId: true } });
    if (!q) throw notFound("Cotización");
    if (!(await this.branches(ctx, tx, "OPERATE")).includes(q.branchId)) {
      if (!(await this.branches(ctx, tx, "VIEW")).includes(q.branchId)) throw notFound("Cotización");
      throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de esa cotización.");
    }
    return q;
  }

  private async customer(tx: Tx, id: string) {
    const c = await tx.customer.findUnique({ where: { id }, select: { id: true, status: true, defaultPriceListId: true } });
    if (!c) throw notFound("Cliente");
    if (c.status !== "ACTIVE") throw conflict("CUSTOMER_INACTIVE", "El cliente está inactivo.");
    return c;
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "QUOTE", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "QUOTE", prefix: "CT-", padding: 6 } });
    }
    return (await nextSequenceNumber(tx, "QUOTE")).formatted;
  }
}

const isExpired = (r: { status: QuoteStatus; validUntil: Date }, today: string) => (r.status === "DRAFT" || r.status === "SENT") && day(r.validUntil) < today;
const toSummary = (q: Row, today: string): QuoteSummary => ({
  id: q.id, code: q.code, status: q.status, currency: q.currency, validUntil: day(q.validUntil), expired: isExpired(q, today), customer: q.customer, prospectName: q.prospectName,
  total: q.total.toString(), createdAt: q.createdAt.toISOString(), convertedSaleId: q.convertedSaleId,
});
const toDetail = (q: DetailRow, today: string, reservation: { id: string; code: string; status: "ACTIVE" | "RELEASED" | "CONSUMED" | "EXPIRED"; expiresAt: Date } | null): QuoteDetail => ({
  ...toSummary(q, today), note: q.note, netTotal: q.netTotal.toString(), taxTotal: q.taxTotal.toString(), lines: q.lines.map(lineView),
  reservation: reservation ? { id: reservation.id, code: reservation.code, status: reservation.status, expiresAt: reservation.expiresAt.toISOString() } : null,
});
