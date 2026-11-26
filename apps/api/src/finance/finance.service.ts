import { Inject, Injectable } from "@nestjs/common";
import type { PayableRow, PayablesReport, ReceivableRow, ReceivablesReport, SupplierPaymentInput, SupplierPaymentView } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { Clock } from "../access/clock";
import { localParts } from "../access/schedule";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import { CashService } from "../cash/cash.service";
import type { RequestContext } from "../common/request-context";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const day = (d: Date) => d.toISOString().slice(0, 10);
const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const;
type Bucket = (typeof BUCKETS)[number];

/** Tramo de antigüedad según los días de atraso respecto de hoy (0 o menos = aún no vence). */
export const bucketOf = (daysOverdue: number): Bucket => (daysOverdue <= 0 ? "current" : daysOverdue <= 30 ? "d1_30" : daysOverdue <= 60 ? "d31_60" : daysOverdue <= 90 ? "d61_90" : "d90plus");
const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, D(0)])) as Record<Bucket, Prisma.Decimal>;
const fmt = (b: Record<Bucket, Prisma.Decimal>) => Object.fromEntries(BUCKETS.map((k) => [k, b[k].toString()])) as Record<Bucket, string>;
const daysBetween = (asOf: string, due: Date) => Math.round((dateOnly(asOf).getTime() - due.getTime()) / 86_400_000);

/**
 * Finanzas operativas (plan §12): cuentas por cobrar y por pagar con antigüedad de saldos, y pagos a proveedores asignados a sus
 * deudas. El saldo por cobrar nace de las ventas confirmadas (total − devuelto − cobrado neto); la deuda con el proveedor nace de cada
 * recepción de mercadería. Un pago es un hecho inmutable; su aplicación a deudas queda en asignaciones.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(Clock) private readonly clock: Clock,
    @Inject(CashService) private readonly cash: CashService,
  ) {}

  private async today(ctx: RequestContext): Promise<string> {
    return localParts(this.clock.now(), (await ctx.tenantInfo()).timezone).date;
  }
  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  // ───────────── Por cobrar ─────────────

  async receivables(ctx: RequestContext): Promise<ReceivablesReport> {
    const asOf = await this.today(ctx);
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await this.openSales(tx, ids);
      const byCustomer = new Map<string, { code: string; name: string; creditLimit: Prisma.Decimal | null; outstanding: Prisma.Decimal; overdue: Prisma.Decimal; oldest: Date | null; docs: number; buckets: Record<Bucket, Prisma.Decimal> }>();
      const totals = emptyBuckets();
      for (const r of rows) {
        const b = bucketOf(daysBetween(asOf, r.due));
        totals[b] = totals[b].add(r.balance);
        const c = byCustomer.get(r.customerId) ?? { code: r.ccode, name: r.cname, creditLimit: r.limit, outstanding: D(0), overdue: D(0), oldest: null, docs: 0, buckets: emptyBuckets() };
        c.outstanding = c.outstanding.add(r.balance); c.docs++; c.buckets[b] = c.buckets[b].add(r.balance);
        if (b !== "current") c.overdue = c.overdue.add(r.balance);
        if (!c.oldest || r.due < c.oldest) c.oldest = r.due;
        byCustomer.set(r.customerId, c);
      }
      const outstanding = BUCKETS.reduce((s, b) => s.add(totals[b]), D(0));
      return {
        asOf, totals: { ...fmt(totals), outstanding: outstanding.toString(), overdue: outstanding.sub(totals.current).toString() },
        customers: [...byCustomer.entries()].sort((a, b) => b[1].overdue.comparedTo(a[1].overdue) || b[1].outstanding.comparedTo(a[1].outstanding)).map(([customerId, c]) => ({
          customerId, code: c.code, name: c.name, creditLimit: c.creditLimit?.toString() ?? null, outstanding: c.outstanding.toString(), overdue: c.overdue.toString(), oldestDue: c.oldest ? day(c.oldest) : null, documents: c.docs, buckets: fmt(c.buckets),
        })),
      };
    });
  }

  async receivableDetail(ctx: RequestContext, customerId: string): Promise<ReceivableRow[]> {
    const asOf = await this.today(ctx);
    return ctx.run(async (tx) => {
      if (!(await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) throw notFound("Cliente");
      const ids = await this.branches(ctx, tx, "VIEW");
      return (await this.openSales(tx, ids, customerId)).sort((a, b) => a.due.getTime() - b.due.getTime()).map((r) => ({
        saleId: r.id, code: r.code, confirmedAt: r.confirmedAt.toISOString(), dueDate: day(r.due), daysOverdue: Math.max(0, daysBetween(asOf, r.due)), total: r.total.toString(), balance: r.balance.toString(), currency: r.currency,
      }));
    });
  }

  private async openSales(tx: Tx, branchIds: string[], customerId?: string) {
    if (branchIds.length === 0) return [];
    const rows = await tx.$queryRaw<{ id: string; code: string; customer_id: string; ccode: string; cname: string; climit: Prisma.Decimal | null; total: Prisma.Decimal; balance: Prisma.Decimal; due: Date; confirmed_at: Date; currency: string }[]>(Prisma.sql`
      SELECT s.id, s.code, s.customer_id, c.code AS ccode, c.name AS cname, c.credit_limit AS climit, s.total, s.currency, s.confirmed_at,
             (s.total - s.returned_total - (s.paid_total - s.refunded_total)) AS balance, COALESCE(s.due_date, s.confirmed_at::date) AS due
        FROM sale s JOIN customer c ON c.tenant_id = s.tenant_id AND c.id = s.customer_id
       WHERE s.status = 'CONFIRMED' AND s.customer_id IS NOT NULL
         AND s.branch_id IN (${Prisma.join(branchIds.map((b) => Prisma.sql`${b}::uuid`))})
         AND (s.total - s.returned_total - (s.paid_total - s.refunded_total)) > 0
         ${customerId ? Prisma.sql`AND s.customer_id = ${customerId}::uuid` : Prisma.empty}`);
    return rows.map((r) => ({ id: r.id, code: r.code, customerId: r.customer_id, ccode: r.ccode, cname: r.cname, limit: r.climit ? D(r.climit) : null, total: D(r.total), balance: D(r.balance), due: new Date(r.due), confirmedAt: new Date(r.confirmed_at), currency: r.currency }));
  }

  // ───────────── Por pagar ─────────────

  async payables(ctx: RequestContext): Promise<PayablesReport> {
    const asOf = await this.today(ctx);
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await this.openPayables(tx, ids);
      const bySupplier = new Map<string, { code: string; name: string; outstanding: Prisma.Decimal; overdue: Prisma.Decimal; oldest: Date | null; docs: number; buckets: Record<Bucket, Prisma.Decimal> }>();
      const totals = emptyBuckets();
      for (const r of rows) {
        const b = bucketOf(daysBetween(asOf, r.due));
        totals[b] = totals[b].add(r.balance);
        const c = bySupplier.get(r.supplierId) ?? { code: r.scode, name: r.sname, outstanding: D(0), overdue: D(0), oldest: null, docs: 0, buckets: emptyBuckets() };
        c.outstanding = c.outstanding.add(r.balance); c.docs++; c.buckets[b] = c.buckets[b].add(r.balance);
        if (b !== "current") c.overdue = c.overdue.add(r.balance);
        if (!c.oldest || r.due < c.oldest) c.oldest = r.due;
        bySupplier.set(r.supplierId, c);
      }
      const outstanding = BUCKETS.reduce((s, b) => s.add(totals[b]), D(0));
      return {
        asOf, totals: { ...fmt(totals), outstanding: outstanding.toString(), overdue: outstanding.sub(totals.current).toString() },
        suppliers: [...bySupplier.entries()].sort((a, b) => b[1].overdue.comparedTo(a[1].overdue) || b[1].outstanding.comparedTo(a[1].outstanding)).map(([supplierId, c]) => ({
          supplierId, code: c.code, name: c.name, outstanding: c.outstanding.toString(), overdue: c.overdue.toString(), oldestDue: c.oldest ? day(c.oldest) : null, documents: c.docs, buckets: fmt(c.buckets),
        })),
      };
    });
  }

  async payableDetail(ctx: RequestContext, supplierId: string): Promise<PayableRow[]> {
    const asOf = await this.today(ctx);
    return ctx.run(async (tx) => {
      if (!(await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) throw notFound("Proveedor");
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.payable.findMany({
        where: { supplierId, receipt: { branchId: { in: ids } } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: 200,
        include: { receipt: { select: { code: true, supplierRef: true, createdAt: true, order: { select: { code: true } } } } },
      });
      return rows.map((p) => ({
        id: p.id, receiptCode: p.receipt.code, orderCode: p.receipt.order?.code ?? null, supplierRef: p.receipt.supplierRef, createdAt: p.receipt.createdAt.toISOString(), dueDate: day(p.dueDate),
        daysOverdue: p.status === "OPEN" ? Math.max(0, daysBetween(asOf, p.dueDate)) : 0, total: p.total.toString(), paid: p.paidTotal.toString(), balance: p.total.sub(p.paidTotal).toString(), status: p.status, currency: p.currency,
      }));
    });
  }

  private async openPayables(tx: Tx, branchIds: string[]) {
    if (branchIds.length === 0) return [];
    const rows = await tx.$queryRaw<{ supplier_id: string; scode: string; sname: string; balance: Prisma.Decimal; due: Date }[]>(Prisma.sql`
      SELECT p.supplier_id, s.code AS scode, s.name AS sname, (p.total - p.paid_total) AS balance, p.due_date AS due
        FROM payable p JOIN supplier s ON s.tenant_id = p.tenant_id AND s.id = p.supplier_id JOIN goods_receipt r ON r.tenant_id = p.tenant_id AND r.id = p.receipt_id
       WHERE p.status = 'OPEN' AND r.branch_id IN (${Prisma.join(branchIds.map((b) => Prisma.sql`${b}::uuid`))})`);
    return rows.map((r) => ({ supplierId: r.supplier_id, scode: r.scode, sname: r.sname, balance: D(r.balance), due: new Date(r.due) }));
  }

  // ───────────── Pagos a proveedores ─────────────

  listPayments(ctx: RequestContext, supplierId?: string): Promise<SupplierPaymentView[]> {
    return ctx.run(async (tx) => {
      const rows = await tx.supplierPayment.findMany({
        where: supplierId ? { supplierId } : {}, orderBy: { paidAt: "desc" }, take: 100,
        include: { supplier: { select: { id: true, code: true, name: true } }, allocations: { include: { payable: { select: { receipt: { select: { code: true } } } } } } },
      });
      return rows.map(toPaymentView);
    });
  }

  /**
   * Paga a un proveedor y aplica el pago a sus deudas (las indicadas, o las que vencen primero). No se paga más de lo que se debe. Un pago en
   * efectivo sale del turno de caja de quien paga cuando la sucursal tiene caja.
   */
  async pay(ctx: RequestContext, input: SupplierPaymentInput): Promise<SupplierPaymentView> {
    await ctx.tenantInfo(); // fuera de la transacción: no pedir una 2.ª conexión del pool
    return ctx.run(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } });
      if (!supplier) throw notFound("Proveedor");
      const visible = await this.branches(ctx, tx, "OPERATE");

      // Bloqueo de las deudas abiertas del proveedor, en orden estable: dos pagos simultáneos no aplican lo mismo dos veces.
      await tx.$queryRaw`SELECT id FROM payable WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND supplier_id = ${input.supplierId}::uuid AND status = 'OPEN' ORDER BY due_date, id FOR UPDATE`;
      const open = await tx.payable.findMany({ where: { supplierId: input.supplierId, status: "OPEN", receipt: { branchId: { in: visible } } }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], include: { receipt: { select: { code: true, branchId: true } } } });
      const amount = D(input.amount);
      const plan: { payable: (typeof open)[number]; amount: Prisma.Decimal }[] = [];

      if (input.allocations?.length) {
        const total = input.allocations.reduce((s, a) => s.add(D(a.amount)), D(0));
        if (!total.eq(amount)) throw badRequest("ALLOCATION_MISMATCH", `Las asignaciones suman ${total.toString()} y el pago es de ${amount.toString()}.`);
        const seen = new Set<string>();
        for (const a of input.allocations) {
          if (seen.has(a.payableId)) throw badRequest("DUPLICATE_ALLOCATION", "No repitas una deuda en las asignaciones.");
          seen.add(a.payableId);
          const p = open.find((x) => x.id === a.payableId);
          if (!p) throw conflict("PAYABLE_NOT_PAYABLE", "Una deuda no existe, no es de ese proveedor, ya está pagada o no está en tu alcance.");
          if (D(a.amount).gt(p.total.sub(p.paidTotal))) throw conflict("OVERPAYMENT", `El pago a ${p.receipt.code} supera su saldo (${p.total.sub(p.paidTotal).toString()}).`);
          plan.push({ payable: p, amount: D(a.amount) });
        }
      } else {
        let left = amount;
        for (const p of open) {
          if (left.lte(0)) break;
          const take = Prisma.Decimal.min(left, p.total.sub(p.paidTotal));
          plan.push({ payable: p, amount: take }); left = left.sub(take);
        }
        if (left.gt(0)) throw conflict("OVERPAYMENT", `El pago supera lo que se le debe al proveedor (${open.reduce((s, p) => s.add(p.total.sub(p.paidTotal)), D(0)).toString()}).`);
      }

      const branchId = input.branchId ?? plan[0]!.payable.receipt.branchId;
      if (!visible.includes(branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a esa sucursal.");
      const id = uuidv7();
      const cashSessionId = await this.cash.attach(tx, ctx, { branchId, method: input.method, amount, direction: "OUT", sourceType: "SUPPLIER_PAYMENT", sourceId: id, note: "Pago a proveedor", requestedSessionId: input.cashSessionId, movementType: "SUPPLIER_PAYMENT" });

      const code = await this.nextCode(tx, ctx.auth.tenantId);
      await tx.supplierPayment.create({ data: { id, tenantId: ctx.auth.tenantId, supplierId: input.supplierId, branchId, code, method: input.method, amount, reference: input.reference?.trim() || null, cashSessionId, createdById: ctx.auth.userId } });
      for (const a of plan) {
        await tx.supplierPaymentAllocation.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, paymentId: id, payableId: a.payable.id, amount: a.amount } });
        const paid = a.payable.paidTotal.add(a.amount);
        await tx.payable.update({ where: { id: a.payable.id }, data: { paidTotal: paid, status: paid.gte(a.payable.total) ? "PAID" : "OPEN" } });
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "supplier.payment_recorded", entityType: "supplier_payment", entityId: id, branchId, actorUserId: ctx.auth.userId, after: { code, supplierId: input.supplierId, amount: amount.toString(), method: input.method, documents: plan.length } });
      return toPaymentView(await tx.supplierPayment.findUniqueOrThrow({
        where: { id }, include: { supplier: { select: { id: true, code: true, name: true } }, allocations: { include: { payable: { select: { receipt: { select: { code: true } } } } } } },
      }));
    });
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "SUPPLIER_PAYMENT", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "SUPPLIER_PAYMENT", prefix: "PG-", padding: 6 } });
    }
    return (await nextSequenceNumber(tx, "SUPPLIER_PAYMENT")).formatted;
  }
}

type PaymentRow = Prisma.SupplierPaymentGetPayload<{ include: { supplier: { select: { id: true; code: true; name: true } }; allocations: { include: { payable: { select: { receipt: { select: { code: true } } } } } } } }>;
const toPaymentView = (p: PaymentRow): SupplierPaymentView => ({
  id: p.id, code: p.code, method: p.method, amount: p.amount.toString(), reference: p.reference, paidAt: p.paidAt.toISOString(), supplier: p.supplier,
  allocations: p.allocations.map((a) => ({ payableId: a.payableId, receiptCode: a.payable.receipt.code, amount: a.amount.toString() })),
});
