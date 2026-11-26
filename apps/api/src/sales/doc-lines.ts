import { Prisma, type Tx } from "@erp/db";
import type { DocLineView } from "@erp/contracts";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import type { DocumentLinePrice, PricingService } from "../pricing/pricing.service";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface PricedLine {
  productId: string;
  kind: string;
  quantity: Prisma.Decimal;
  price: DocumentLinePrice;
  overrideReason?: string | null;
}

/**
 * Cotiza las líneas de un documento (cotización o venta). Valida producto, cantidad (decimales de la unidad), duplicados,
 * permiso de descuento y moneda única, y devuelve cada línea con la foto completa del cálculo (plan §8.5).
 */
export async function priceLines(
  pricing: PricingService, ctx: RequestContext, tx: Tx, perms: Set<string>,
  opts: { branchId: string; channel?: "POS" | "ECOMMERCE" | "MESSAGING"; priceListId?: string | null; lists?: Map<string, string>; trusted?: boolean; skipTax?: boolean; preferListId?: string | null },
  lines: { productId: string; quantity: number; discountPct: number; unitPrice?: number | null; overrideReason?: string | null }[],
): Promise<{ lines: PricedLine[]; currency: string }> {
  const ids = lines.map((l) => l.productId);
  if (new Set(ids).size !== ids.length) throw badRequest("DUPLICATE_PRODUCT", "Un producto no puede repetirse: suma las cantidades en una sola línea.");
  if (!opts.trusted && lines.some((l) => l.discountPct > 0) && !perms.has("sales.apply_discount")) throw forbid("DISCOUNT_FORBIDDEN", "No tienes permiso para aplicar descuentos.");
  if (!opts.trusted && lines.some((l) => l.unitPrice != null) && !perms.has("sales.override_price")) throw forbid("OVERRIDE_FORBIDDEN", "No tienes permiso para cambiar precios.");

  const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, kind: true, status: true, baseUnit: { select: { decimals: true } } } });
  if (products.length !== ids.length) throw notFound("Producto");
  const byId = new Map(products.map((p) => [p.id, p]));

  const out: PricedLine[] = [];
  const currencies = new Set<string>();
  for (const l of lines) {
    const p = byId.get(l.productId)!;
    if (p.status !== "ACTIVE") throw conflict("PRODUCT_INACTIVE", `${p.code} está inactivo.`);
    if (!D(l.quantity).toDecimalPlaces(p.baseUnit.decimals).eq(D(l.quantity))) throw badRequest("INVALID_QUANTITY", `${p.code} admite hasta ${p.baseUnit.decimals} decimales en su unidad base.`);
    const explicit = opts.lists?.get(l.productId) ?? opts.priceListId ?? undefined;
    const price = await pricing.priceDocumentLine(ctx, tx, {
      productId: l.productId, quantity: l.quantity, branchId: opts.branchId, channel: opts.channel, priceListId: explicit, discountPct: l.discountPct, ...(opts.skipTax ? { skipTax: true } : {}), ...(opts.preferListId ? { preferListId: opts.preferListId } : {}),
      ...(l.unitPrice != null ? { overrideUnitPrice: l.unitPrice } : {}),
    });
    currencies.add(price.currency);
    out.push({ productId: l.productId, kind: p.kind, quantity: D(l.quantity), price, overrideReason: l.unitPrice != null ? (l.overrideReason ?? null) : null });
  }
  if (currencies.size > 1) throw conflict("MIXED_CURRENCY", "Las líneas se cotizaron en monedas distintas; usa una lista de precios en una sola moneda.");
  return { lines: out, currency: [...currencies][0]! };
}

export function totalsOf(lines: PricedLine[]) {
  const sum = (f: (l: PricedLine) => Prisma.Decimal) => lines.reduce((s, l) => s.add(f(l)), D(0));
  return { net: sum((l) => l.price.netAmount), tax: sum((l) => l.price.taxAmount), discount: sum((l) => l.price.discountAmount), total: sum((l) => l.price.totalAmount) };
}

/** Columnas comunes (venta y cotización) para guardar la foto del cálculo. */
export const lineData = (l: PricedLine, overrideById?: string | null) => ({
  appliedUnitPrice: l.price.appliedUnitPrice, overrideReason: l.price.appliedUnitPrice !== null ? (l.overrideReason ?? "Precio modificado") : null, overrideById: l.price.appliedUnitPrice !== null ? (overrideById ?? null) : null,
  productId: l.productId, quantity: l.quantity, priceListId: l.price.priceListId, priceMode: l.price.priceMode, scalingMode: l.price.scalingMode,
  listUnitPrice: l.price.listUnitPrice, discountPct: l.price.discountPct, netAmount: l.price.netAmount, taxAmount: l.price.taxAmount, totalAmount: l.price.totalAmount,
  taxes: l.price.taxes as Prisma.InputJsonValue, breakdown: l.price.breakdown as Prisma.InputJsonValue,
});

type LineRow = {
  id: string; productId: string; quantity: Prisma.Decimal; appliedUnitPrice?: Prisma.Decimal | null; overrideReason?: string | null; priceMode: "WITH_TAX" | "WITHOUT_TAX"; listUnitPrice: Prisma.Decimal; discountPct: Prisma.Decimal;
  netAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal; taxes: unknown; costTotal?: Prisma.Decimal | null;
  product: { code: string; name: string; baseUnit: { code: string } }; priceList: { code: string };
  allocations?: { quantity: Prisma.Decimal; unitCost: Prisma.Decimal; lot: { code: string } }[];
};

export const lineView = (l: LineRow): DocLineView => ({
  id: l.id, productId: l.productId, productCode: l.product.code, productName: l.product.name, unit: l.product.baseUnit.code, quantity: l.quantity.toString(),
  priceListCode: l.priceList.code, priceMode: l.priceMode, listUnitPrice: l.listUnitPrice.toString(), discountPct: l.discountPct.toString(),
  appliedUnitPrice: l.appliedUnitPrice?.toString() ?? null, overrideReason: l.overrideReason ?? null,
  netAmount: l.netAmount.toString(), taxAmount: l.taxAmount.toString(), totalAmount: l.totalAmount.toString(), taxes: (l.taxes ?? []) as DocLineView["taxes"],
  lots: (l.allocations ?? []).map((a) => ({ lotCode: a.lot.code, quantity: a.quantity.toString(), unitCost: a.unitCost.toString() })),
  costTotal: l.costTotal?.toString() ?? null,
});

export const lineInclude = {
  product: { select: { code: true, name: true, baseUnit: { select: { code: true } } } },
  priceList: { select: { code: true } },
} as const;
