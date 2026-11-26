import { Injectable } from "@nestjs/common";
import type { CustomerInput, CustomerPatch, CustomerSummary } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type Tx } from "@erp/db";
import { conflict, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const include = { defaultPriceList: { select: { id: true, code: true, name: true } } } satisfies Prisma.CustomerInclude;
type Row = Prisma.CustomerGetPayload<{ include: typeof include }>;

@Injectable()
export class CustomersService {
  list(ctx: RequestContext, q?: string): Promise<CustomerSummary[]> {
    return ctx.run(async (tx) => {
      const rows = await tx.customer.findMany({
        where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { taxId: { contains: q, mode: "insensitive" } }, { phone: { contains: q, mode: "insensitive" } }] } : {},
        orderBy: { name: "asc" }, take: 200, include,
      });
      const owed = await this.outstanding(tx, rows.map((r) => r.id));
      return rows.map((r) => toSummary(r, owed.get(r.id) ?? new Prisma.Decimal(0)));
    });
  }

  get(ctx: RequestContext, id: string): Promise<CustomerSummary> {
    return ctx.run(async (tx) => this.load(tx, id));
  }

  create(ctx: RequestContext, input: CustomerInput): Promise<CustomerSummary> {
    return ctx.run(async (tx) => {
      if (input.defaultPriceListId) await this.assertList(tx, input.defaultPriceListId);
      const id = uuidv7();
      const code = input.code ?? (await this.nextCode(tx, ctx.auth.tenantId));
      try {
        await tx.customer.create({
          data: {
            id, tenantId: ctx.auth.tenantId, code, name: input.name, taxId: blank(input.taxId), email: blank(input.email), phone: blank(input.phone), address: blank(input.address),
            defaultPriceListId: input.defaultPriceListId ?? null, paymentTermsDays: input.paymentTermsDays, creditLimit: input.creditLimit ?? null,
          },
        });
      } catch (e) {
        if (isUnique(e)) throw conflict("DUPLICATE_CUSTOMER", "Ya existe un cliente con ese código o con ese NIT/documento.");
        throw e;
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "customer.created", entityType: "customer", entityId: id, actorUserId: ctx.auth.userId, after: { code, name: input.name } });
      return this.load(tx, id);
    });
  }

  update(ctx: RequestContext, id: string, patch: CustomerPatch): Promise<CustomerSummary> {
    return ctx.run(async (tx) => {
      if (!(await tx.customer.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Cliente");
      if (patch.defaultPriceListId) await this.assertList(tx, patch.defaultPriceListId);
      try {
        await tx.customer.update({
          where: { id },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.taxId !== undefined ? { taxId: blank(patch.taxId) } : {}),
            ...(patch.email !== undefined ? { email: blank(patch.email) } : {}),
            ...(patch.phone !== undefined ? { phone: blank(patch.phone) } : {}),
            ...(patch.address !== undefined ? { address: blank(patch.address) } : {}),
            ...(patch.defaultPriceListId !== undefined ? { defaultPriceListId: patch.defaultPriceListId } : {}),
            ...(patch.paymentTermsDays !== undefined ? { paymentTermsDays: patch.paymentTermsDays } : {}),
            ...(patch.creditLimit !== undefined ? { creditLimit: patch.creditLimit } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
          },
        });
      } catch (e) {
        if (isUnique(e)) throw conflict("DUPLICATE_CUSTOMER", "Ya existe un cliente con ese NIT/documento.");
        throw e;
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "customer.updated", entityType: "customer", entityId: id, actorUserId: ctx.auth.userId, after: patch });
      return this.load(tx, id);
    });
  }

  private async load(tx: Tx, id: string): Promise<CustomerSummary> {
    const c = await tx.customer.findUnique({ where: { id }, include });
    if (!c) throw notFound("Cliente");
    return toSummary(c, (await this.outstanding(tx, [id])).get(id) ?? new Prisma.Decimal(0));
  }

  /** Deuda pendiente: lo confirmado y aún no cobrado. */
  async outstanding(tx: Tx, customerIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (customerIds.length === 0) return new Map();
    const rows = await tx.sale.groupBy({ by: ["customerId"], where: { customerId: { in: customerIds }, status: "CONFIRMED", paymentStatus: { not: "PAID" } }, _sum: { total: true, paidTotal: true, returnedTotal: true, refundedTotal: true } });
    const z = new Prisma.Decimal(0);
    return new Map(rows.map((r) => [r.customerId!, (r._sum.total ?? z).sub(r._sum.returnedTotal ?? z).sub(r._sum.paidTotal ?? z).add(r._sum.refundedTotal ?? z)]));
  }

  private async assertList(tx: Tx, id: string) {
    if (!(await tx.priceList.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Lista de precios");
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "CUSTOMER", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "CUSTOMER", prefix: "C-", padding: 6 } });
    }
    for (let i = 0; i < 20; i++) {
      const { formatted } = await nextSequenceNumber(tx, "CUSTOMER");
      if (!(await tx.customer.findUnique({ where: { tenantId_code: { tenantId, code: formatted } }, select: { id: true } }))) return formatted;
    }
    throw conflict("CODE_GENERATION", "No se pudo generar un código libre; indícalo manualmente.");
  }
}

const toSummary = (c: Row, owed: Prisma.Decimal): CustomerSummary => ({
  id: c.id, code: c.code, name: c.name, taxId: c.taxId, email: c.email, phone: c.phone, address: c.address, defaultPriceList: c.defaultPriceList,
  paymentTermsDays: c.paymentTermsDays, creditLimit: c.creditLimit?.toString() ?? null, status: c.status, outstanding: owed.toString(),
});
