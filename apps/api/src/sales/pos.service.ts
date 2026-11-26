import { Inject, Injectable } from "@nestjs/common";
import type { PosProductQuery, PosProductRow, SalePreviewRequest, SalePreviewResult } from "@erp/contracts";
import { Prisma, type Tx } from "@erp/db";
import { forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { thumbOf } from "../integrations/cloudinary.client";
import { PricingService } from "../pricing/pricing.service";
import { priceLines, totalsOf } from "./doc-lines";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Punto de venta: búsqueda de productos con sus escalas y existencias, y cálculo de la venta sin guardarla. */
@Injectable()
export class PosService {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  private async warehouse(ctx: RequestContext, tx: Tx, id: string) {
    const w = await tx.warehouse.findUnique({ where: { id }, select: { id: true, branchId: true, status: true } });
    if (!w || w.status !== "ACTIVE") throw notFound("Almacén");
    const ids = (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel: "OPERATE" })).branchIds;
    if (!ids.includes(w.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese almacén.");
    return w;
  }

  /** Calcula precios por cantidad, descuentos e impuestos de una venta que aún no existe. No escribe nada. */
  async preview(ctx: RequestContext, req: SalePreviewRequest): Promise<SalePreviewResult> {
    await ctx.tenantInfo(); const perms = await ctx.permissions();
    return ctx.run(async (tx) => {
      const wh = await this.warehouse(ctx, tx, req.warehouseId);
      const customer = req.customerId ? await tx.customer.findUnique({ where: { id: req.customerId }, select: { defaultPriceListId: true } }) : null;
      if (req.customerId && !customer) throw notFound("Cliente");
      const priced = await priceLines(this.pricing, ctx, tx, perms, { branchId: wh.branchId, channel: "POS", priceListId: req.priceListId ?? undefined, preferListId: customer?.defaultPriceListId, skipTax: !req.withTax }, req.lines);
      const t = totalsOf(priced.lines);
      const codes = new Map((await tx.priceList.findMany({ where: { id: { in: [...new Set(priced.lines.map((l) => l.price.priceListId))] } }, select: { id: true, code: true } })).map((l) => [l.id, l.code]));
      return {
        currency: priced.currency,
        lines: priced.lines.map((l) => {
          const parts = (l.price.breakdown ?? []) as { tierMin: string }[];
          const pct = l.price.discountPct;
          return {
            productId: l.productId, quantity: l.quantity.toString(),
            unitPrice: l.price.listUnitPrice.mul(D(100).minus(pct)).div(100).toDecimalPlaces(4).toString(), listUnitPrice: l.price.listUnitPrice.toString(),
            discountPct: pct.toString(), priceListCode: codes.get(l.price.priceListId) ?? "",
            tier: parts.length > 1 ? "PROGRESSIVE" : parts[0]?.tierMin ?? null,
            netAmount: l.price.netAmount.toString(), taxAmount: l.price.taxAmount.toString(), totalAmount: l.price.totalAmount.toString(),
          };
        }),
        totals: { net: t.net.toString(), tax: t.tax.toString(), discount: t.discount.toString(), total: t.total.toString() },
      };
    });
  }

  /** Busca productos por descripción, código, código de barras o proveedor, con existencias y escalas de precio. */
  async searchProducts(ctx: RequestContext, q: PosProductQuery): Promise<PosProductRow[]> {
    await ctx.tenantInfo();
    const fields = new Set(q.fields.split(",").map((f) => f.trim()).filter(Boolean));
    if (fields.size === 0) fields.add("description");
    return ctx.run(async (tx) => {
      const wh = await this.warehouse(ctx, tx, q.warehouseId);
      const text = q.q.trim();
      const tokens = strip(text).split(/\s+/).filter(Boolean).slice(0, 5);
      const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
      const or: Prisma.ProductWhereInput[] = [];
      if (fields.has("description") && tokens.length) {
        // Todas las palabras deben aparecer (en el nombre, la descripción, la categoría o la marca), sin distinguir mayúsculas ni acentos:
        // «riel 25» encuentra «RIEL TELESCOPICA ECO 25cm» e «instalacion» encuentra «Instalación».
        const like = tokens.map((t) => Prisma.sql`translate(lower(coalesce(p.name, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(c.name, '') || ' ' || coalesce(b.name, '')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') LIKE ${"%" + t.replace(/[%_\\]/g, (m) => "\\" + m) + "%"}`);
        const hit = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT p.id FROM product p
          LEFT JOIN category c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
          LEFT JOIN brand b ON b.tenant_id = p.tenant_id AND b.id = p.brand_id
          WHERE p.status = 'ACTIVE' AND ${Prisma.join(like, " AND ")} LIMIT 200`);
        if (hit.length) or.push({ id: { in: hit.map((h) => h.id) } });
      }
      if (fields.has("code")) or.push({ code: ci(text) });
      if (fields.has("barcode")) or.push({ barcodes: { some: { barcode: ci(text) } } });
      if (fields.has("supplier")) {
        or.push({ receiptLines: { some: { receipt: { supplier: { OR: [{ name: ci(text) }, { code: ci(text) }] } } } } });
        or.push({ orderLines: { some: { order: { supplier: { OR: [{ name: ci(text) }, { code: ci(text) }] } } } } });
      }
      const rows = await tx.product.findMany({
        where: { status: "ACTIVE", OR: or.length ? or : [{ id: { in: [] } }] },
        take: q.limit * 2,
        orderBy: { code: "asc" },
        select: {
          id: true, code: true, name: true, kind: true, variantValues: true,
          category: { select: { name: true } }, brand: { select: { name: true } }, baseUnit: { select: { code: true, decimals: true } },
          group: { select: { options: true } }, images: { where: { isPrimary: true }, select: { url: true }, take: 1 },
        },
      });
      // Primero lo que coincide exacto o empieza igual con el código, luego por nombre.
      const lower = text.toLowerCase();
      const rank = (r: { code: string; name: string }) => (r.code.toLowerCase() === lower ? 0 : r.code.toLowerCase().startsWith(lower) ? 1 : strip(r.name).startsWith(strip(text)) ? 2 : 3);
      const top = rows.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code)).slice(0, q.limit);
      const ids = top.map((r) => r.id);
      if (ids.length === 0) return [];

      const [balances, tiers, supp] = await Promise.all([
        tx.stockBalance.groupBy({ by: ["productId", "warehouseId"], where: { productId: { in: ids } }, _sum: { physicalQty: true, reservedQty: true } }),
        this.pricing.tiersFor(ctx, tx, { productIds: ids, branchId: wh.branchId, channel: "POS", priceListId: q.priceListId ?? (q.customerId ? (await tx.customer.findUnique({ where: { id: q.customerId }, select: { defaultPriceListId: true } }))?.defaultPriceListId : null) }),
        fields.has("supplier")
          ? tx.goodsReceiptLine.findMany({ where: { productId: { in: ids }, receipt: { supplier: { OR: [{ name: ci(text) }, { code: ci(text) }] } } }, select: { productId: true, receipt: { select: { supplier: { select: { name: true } } } } } })
          : Promise.resolve([]),
      ]);
      const avail = (productId: string, warehouseId?: string) =>
        balances.filter((b) => b.productId === productId && (!warehouseId || b.warehouseId === warehouseId)).reduce((s, b) => s.add(b._sum.physicalQty ?? 0).sub(b._sum.reservedQty ?? 0), D(0));

      return top.map((r) => {
        const goods = r.kind === "GOODS";
        const opts = (r.group?.options ?? []) as { name: string }[];
        const vals = (r.variantValues ?? {}) as Record<string, string>;
        const url = r.images[0]?.url ?? null;
        return {
          id: r.id, code: r.code, name: r.name, category: r.category?.name ?? null, brand: r.brand?.name ?? null, unit: r.baseUnit.code, decimals: r.baseUnit.decimals, kind: r.kind,
          thumbUrl: url ? thumbOf(url) : null, variantLabel: r.group ? opts.map((o) => vals[o.name]).filter(Boolean).join(" / ") : null,
          stockHere: goods ? avail(r.id, wh.id).toString() : null, stockTotal: goods ? avail(r.id).toString() : null,
          suppliers: [...new Set(supp.filter((s) => s.productId === r.id).map((s) => s.receipt.supplier.name))].slice(0, 3),
          price: tiers.get(r.id) ?? null,
        } satisfies PosProductRow;
      });
    });
  }
}
