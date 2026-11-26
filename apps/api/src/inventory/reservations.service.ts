import { Inject, Injectable } from "@nestjs/common";
import type { ReservationInput, ReservationStatus, ReservationView } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { Clock } from "../access/clock";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { InventoryService } from "./inventory.service";
import { StockEngine } from "./stock-engine";

const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  lines: { include: { product: { select: { code: true, name: true } }, lot: { select: { code: true } } }, orderBy: { id: "asc" as const } },
} satisfies Prisma.StockReservationInclude;
type Row = Prisma.StockReservationGetPayload<{ include: typeof include }>;

/**
 * Reservas de stock (ADR-004, punto 9): apartan existencias por lote con vencimiento. Bajan lo DISPONIBLE, no lo físico: otra venta
 * no puede llevarse lo reservado, pero el stock sigue en el almacén hasta que se consume (al confirmar la venta) o se libera.
 * El vencimiento se aplica al momento de necesitar la disponibilidad (reservar, vender, consultar existencias).
 */
@Injectable()
export class ReservationsService {
  constructor(
    @Inject(StockEngine) private readonly engine: StockEngine,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  list(ctx: RequestContext, status?: ReservationStatus): Promise<ReservationView[]> {
    return ctx.run(async (tx) => {
      await this.engine.expireDue(tx, ctx.auth.tenantId);
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.stockReservation.findMany({ where: { branchId: { in: ids }, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 100, include });
      return rows.map(toView);
    });
  }

  get(ctx: RequestContext, id: string): Promise<ReservationView> {
    return ctx.run(async (tx) => {
      await this.engine.expireDue(tx, ctx.auth.tenantId);
      const r = await tx.stockReservation.findUnique({ where: { id }, include });
      if (!r || !(await this.branches(ctx, tx, "VIEW")).includes(r.branchId)) throw notFound("Reserva");
      return toView(r);
    });
  }

  async create(ctx: RequestContext, input: ReservationInput): Promise<ReservationView> {
    await ctx.tenantInfo(); // fuera de la transacción: no pedir una 2.ª conexión del pool
    return ctx.run(async (tx) => {
      const id = await this.createTx(ctx, tx, { warehouseId: input.warehouseId, lines: input.lines, hours: input.hours, note: input.note ?? null });
      return toView(await tx.stockReservation.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  /** Crea una reserva dentro de una transacción ya abierta (la usan las cotizaciones). */
  async createTx(
    ctx: RequestContext, tx: Tx,
    p: { warehouseId: string; lines: { productId: string; quantity: number | Prisma.Decimal }[]; hours: number; note?: string | null; source?: { type: string; id: string }; notAfter?: Date },
  ): Promise<string> {
    const actor = await this.inventory.actor(ctx);
    const wh = await tx.warehouse.findUnique({ where: { id: p.warehouseId }, select: { id: true, branchId: true, status: true, kind: true } });
    if (!wh) throw notFound("Almacén");
    if (!(await this.branches(ctx, tx, "OPERATE")).includes(wh.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese almacén.");
    if (wh.status !== "ACTIVE" || wh.kind !== "STORAGE") throw conflict("WAREHOUSE_INACTIVE", "El almacén no está disponible.");
    const ids = p.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw badRequest("DUPLICATE_PRODUCT", "Un producto no puede repetirse: suma las cantidades en una sola línea.");

    await this.engine.lockValuations(tx, ctx.auth.tenantId, [wh.id], ids);
    const id = uuidv7();
    let expiresAt = new Date(this.clock.now().getTime() + p.hours * 3_600_000);
    if (p.notAfter && p.notAfter < expiresAt) expiresAt = p.notAfter;
    const parts: { productId: string; lotId: string; quantity: Prisma.Decimal }[] = [];
    for (const l of [...p.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
      for (const part of await this.engine.reserve(tx, actor, { warehouseId: wh.id, productId: l.productId, quantity: l.quantity })) parts.push({ productId: l.productId, ...part });
    }
    const code = await this.nextCode(tx, ctx.auth.tenantId);
    await tx.stockReservation.create({
      data: { id, tenantId: ctx.auth.tenantId, branchId: wh.branchId, warehouseId: wh.id, code, expiresAt, sourceType: p.source?.type ?? null, sourceId: p.source?.id ?? null, note: p.note?.trim() || null, createdById: ctx.auth.userId },
    });
    for (const x of parts) await tx.stockReservationLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, reservationId: id, productId: x.productId, lotId: x.lotId, quantity: x.quantity } });
    await writeAudit(tx, ctx.auth.tenantId, { action: "reservation.created", entityType: "stock_reservation", entityId: id, branchId: wh.branchId, actorUserId: ctx.auth.userId, after: { code, expiresAt: expiresAt.toISOString(), source: p.source ?? null } });
    return id;
  }

  /** Libera a mano una reserva activa: lo apartado vuelve a estar disponible. */
  release(ctx: RequestContext, id: string): Promise<ReservationView> {
    return ctx.run(async (tx) => {
      await this.engine.expireDue(tx, ctx.auth.tenantId);
      const r = await tx.stockReservation.findUnique({ where: { id }, select: { id: true, status: true, branchId: true } });
      if (!r) throw notFound("Reserva");
      if (!(await this.branches(ctx, tx, "OPERATE")).includes(r.branchId)) {
        if (!(await this.branches(ctx, tx, "VIEW")).includes(r.branchId)) throw notFound("Reserva");
        throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de esa reserva.");
      }
      if (!(await this.close(tx, ctx.auth.tenantId, [id], "RELEASED"))) throw conflict("INVALID_STATE", "Solo se libera una reserva activa.");
      await writeAudit(tx, ctx.auth.tenantId, { action: "reservation.released", entityType: "stock_reservation", entityId: id, branchId: r.branchId, actorUserId: ctx.auth.userId });
      return toView(await tx.stockReservation.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  /** Cierra las reservas ACTIVAS de un documento (consumo al vender, o liberación al cancelar). Devuelve cuántas cerró. */
  async closeForSource(tx: Tx, tenantId: string, type: string, sourceId: string, status: "RELEASED" | "CONSUMED"): Promise<number> {
    await this.engine.expireDue(tx, tenantId);
    const rows = await tx.stockReservation.findMany({ where: { sourceType: type, sourceId, status: "ACTIVE" }, select: { id: true } });
    return rows.length ? this.close(tx, tenantId, rows.map((r) => r.id), status) : 0;
  }

  /** Marca como cerradas las reservas activas indicadas y devuelve lo que apartaban. Con un cierre concurrente, solo una lo logra. */
  private async close(tx: Tx, tenantId: string, ids: string[], status: "RELEASED" | "CONSUMED"): Promise<number> {
    const locked = await tx.$queryRaw<{ id: string; warehouse_id: string }[]>`
      SELECT id, warehouse_id FROM stock_reservation
       WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[]) AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;
    if (locked.length === 0) return 0;
    const lines = await tx.stockReservationLine.findMany({ where: { reservationId: { in: locked.map((l) => l.id) } } });
    const wh = new Map(locked.map((l) => [l.id, l.warehouse_id]));
    await this.engine.unreserve(tx, tenantId, lines.map((l) => ({ warehouseId: wh.get(l.reservationId)!, productId: l.productId, lotId: l.lotId, quantity: l.quantity })));
    await tx.stockReservation.updateMany({ where: { id: { in: locked.map((l) => l.id) } }, data: { status, closedAt: this.clock.now() } });
    return locked.length;
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "RESERVATION", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "RESERVATION", prefix: "RS-", padding: 6 } });
    }
    return (await nextSequenceNumber(tx, "RESERVATION")).formatted;
  }
}

export const toView = (r: Row): ReservationView => ({
  id: r.id, code: r.code, status: r.status, expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null, note: r.note,
  sourceType: r.sourceType, sourceId: r.sourceId, warehouse: r.warehouse,
  lines: r.lines.map((l) => ({ productCode: l.product.code, productName: l.product.name, lotCode: l.lot.code, quantity: l.quantity.toString() })),
});
