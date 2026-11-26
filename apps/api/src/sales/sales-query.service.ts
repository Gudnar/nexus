import { Inject, Injectable } from "@nestjs/common";
import type { SaleSearchQuery, SaleSearchResult } from "@erp/contracts";
import { Prisma, type Tx } from "@erp/db";
import { Clock } from "../access/clock";
import { localParts } from "../access/schedule";
import type { RequestContext } from "../common/request-context";

/** Saldo por cobrar de una venta: total − devuelto − (cobrado − reintegrado), sin bajar de cero. */
const BALANCE = Prisma.sql`GREATEST(s.total - s.returned_total - (s.paid_total - s.refunded_total), 0)`;

interface Row {
  id: string; code: string | null; status: "DRAFT" | "CONFIRMED" | "CANCELLED"; payment_status: "UNPAID" | "PARTIAL" | "PAID"; channel: "POS" | "ECOMMERCE" | "MESSAGING";
  at: Date; customer_id: string | null; cname: string | null; ctax: string | null; branch_id: string; bname: string; seller_id: string | null; currency: string;
  total: Prisma.Decimal; paid: Prisma.Decimal; returned: Prisma.Decimal; balance: Prisma.Decimal; due: Date | null;
}

/** Consulta e historial de ventas: filtros combinables, resumen de deudas y paginación. */
@Injectable()
export class SalesQueryService {
  constructor(@Inject(Clock) private readonly clock: Clock) {}

  private async scope(ctx: RequestContext, tx: Tx): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel: "VIEW" })).branchIds;
  }

  /** Condiciones WHERE (sin la de saldo, que se agrega aparte para el resumen). */
  private where(q: SaleSearchQuery, branchIds: string[], tz: string): Prisma.Sql[] {
    const w: Prisma.Sql[] = [Prisma.sql`s.branch_id IN (${Prisma.join(branchIds.map((b) => Prisma.sql`${b}::uuid`))})`];
    if (q.branchId) w.push(Prisma.sql`s.branch_id = ${q.branchId}::uuid`);
    if (q.code) w.push(Prisma.sql`s.code ILIKE ${`%${q.code.replace(/[%_\\]/g, (m) => "\\" + m)}%`}`);
    // Fechas según el día local de la empresa (no UTC).
    const day = Prisma.sql`((COALESCE(s.confirmed_at, s.created_at) AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;
    if (q.dateFrom) w.push(Prisma.sql`${day} >= ${q.dateFrom}::date`);
    if (q.dateTo) w.push(Prisma.sql`${day} <= ${q.dateTo}::date`);
    if (q.customerId) w.push(Prisma.sql`s.customer_id = ${q.customerId}::uuid`);
    if (q.taxId) w.push(Prisma.sql`c.tax_id ILIKE ${`%${q.taxId.replace(/[%_\\]/g, (m) => "\\" + m)}%`}`);
    if (q.sellerId) w.push(Prisma.sql`COALESCE(s.seller_id, s.created_by_id) = ${q.sellerId}::uuid`);
    if (q.status) w.push(Prisma.sql`s.status = ${q.status}::"SaleStatus"`);
    if (q.paymentStatus) w.push(Prisma.sql`s.payment_status = ${q.paymentStatus}::"SalePaymentStatus"`);
    if (q.channel) w.push(Prisma.sql`s.channel = ${q.channel}::"SalesChannel"`);
    return w;
  }

  async search(ctx: RequestContext, q: SaleSearchQuery): Promise<SaleSearchResult> {
    const tz = (await ctx.tenantInfo()).timezone;
    const today = localParts(this.clock.now(), tz).date;
    return ctx.run(async (tx) => {
      const branchIds = await this.scope(ctx, tx);
      if (q.branchId && !branchIds.includes(q.branchId)) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, summary: { pendingSales: 0, customersWithBalance: 0, totalOutstanding: "0" } };
      if (branchIds.length === 0) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, summary: { pendingSales: 0, customersWithBalance: 0, totalOutstanding: "0" } };
      const base = this.where(q, branchIds, tz);
      const debtor = Prisma.sql`s.status = 'CONFIRMED' AND ${BALANCE} > 0`;
      const list = q.onlyDebtors ? [...base, debtor] : base;
      const join = Prisma.sql`FROM sale s LEFT JOIN customer c ON c.tenant_id = s.tenant_id AND c.id = s.customer_id JOIN branch b ON b.tenant_id = s.tenant_id AND b.id = s.branch_id`;
      const whereOf = (w: Prisma.Sql[]) => Prisma.sql`WHERE ${Prisma.join(w, " AND ")}`;

      const [rows, count, sum] = await Promise.all([
        tx.$queryRaw<Row[]>(Prisma.sql`
          SELECT s.id, s.code, s.status, s.payment_status, s.channel, COALESCE(s.confirmed_at, s.created_at) AS at, s.customer_id, c.name AS cname, c.tax_id AS ctax,
                 s.branch_id, b.name AS bname, COALESCE(s.seller_id, s.created_by_id) AS seller_id, s.currency,
                 s.total, s.paid_total - s.refunded_total AS paid, s.returned_total AS returned, ${BALANCE} AS balance, s.due_date AS due
          ${join} ${whereOf(list)}
          ORDER BY COALESCE(s.confirmed_at, s.created_at) DESC, s.id DESC
          LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
        tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n ${join} ${whereOf(list)}`),
        tx.$queryRaw<{ n: bigint; customers: bigint; outstanding: Prisma.Decimal | null }[]>(Prisma.sql`
          SELECT count(*) AS n, count(DISTINCT s.customer_id) AS customers, COALESCE(sum(${BALANCE}), 0) AS outstanding ${join} ${whereOf([...base, debtor])}`),
      ]);

      const sellerIds = [...new Set(rows.map((r) => r.seller_id).filter((x): x is string => !!x))];
      const names = new Map<string, string>();
      if (sellerIds.length) for (const m of await tx.membership.findMany({ where: { userId: { in: sellerIds } }, select: { userId: true, user: { select: { name: true } } } })) names.set(m.userId, m.user.name);

      const day = (d: Date) => d.toISOString().slice(0, 10);
      return {
        total: Number(count[0]?.n ?? 0), page: q.page, pageSize: q.pageSize,
        summary: { pendingSales: Number(sum[0]?.n ?? 0), customersWithBalance: Number(sum[0]?.customers ?? 0), totalOutstanding: (sum[0]?.outstanding ?? new Prisma.Decimal(0)).toString() },
        items: rows.map((r) => {
          const owes = r.status === "CONFIRMED" && r.balance.gt(0);
          const overdue = owes && r.due ? Math.max(0, Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${day(r.due)}T00:00:00Z`).getTime()) / 86_400_000)) : 0;
          return {
            id: r.id, code: r.code, status: r.status, paymentStatus: r.payment_status, channel: r.channel, date: r.at.toISOString(),
            customer: r.customer_id ? { id: r.customer_id, name: r.cname ?? "—", taxId: r.ctax } : null, branch: { id: r.branch_id, name: r.bname },
            seller: r.seller_id ? names.get(r.seller_id) ?? null : null, currency: r.currency,
            total: r.total.toString(), paid: r.paid.toString(), returned: r.returned.toString(), balance: r.balance.toString(),
            dueDate: r.due ? day(r.due) : null, overdueDays: overdue,
          };
        }),
      };
    });
  }

  /** Personas que han vendido (para el filtro «Vendedor»). */
  async sellers(ctx: RequestContext): Promise<{ id: string; name: string }[]> {
    return ctx.run(async (tx) => {
      const branchIds = await this.scope(ctx, tx);
      if (branchIds.length === 0) return [];
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT DISTINCT COALESCE(s.seller_id, s.created_by_id) AS id FROM sale s
        WHERE s.branch_id IN (${Prisma.join(branchIds.map((b) => Prisma.sql`${b}::uuid`))}) AND COALESCE(s.seller_id, s.created_by_id) IS NOT NULL`);
      if (!rows.length) return [];
      const ms = await tx.membership.findMany({ where: { userId: { in: rows.map((r) => r.id) } }, select: { userId: true, user: { select: { name: true } } } });
      return ms.map((m) => ({ id: m.userId, name: m.user.name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
    });
  }
}
