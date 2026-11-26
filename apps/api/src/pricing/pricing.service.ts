import { Inject, Injectable } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type {
  BulkPricesRequest, BulkPricesResult, PriceGrid, PriceListInput, PriceListPatch, PriceListSummary, PriceRowList, QuoteRequest, QuoteResponse, SetPricesRequest,
} from "@erp/contracts";
import { Prisma, resolveBranchScope, uuidv7, writeAudit, type Tx } from "@erp/db";
import { conflict, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { calculateLineTax } from "./tax";
import { dateOnly, dateStr, TaxesService } from "./taxes.service";
import { NoTierError, priceQuantity, validateTiers } from "./tiers";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const SCOPE_RANK = { BRANCH: 0, CHANNEL: 1, TENANT: 2 } as const;
const RESOLVED_BY = { BRANCH: "BRANCH", CHANNEL: "CHANNEL", TENANT: "GENERAL" } as const;

type ListRow = Awaited<ReturnType<typeof loadLists>>[number];

function loadLists(tx: Tx, where: object = {}) {
  return tx.priceList.findMany({
    where, orderBy: { code: "asc" },
    include: { branch: { select: { id: true, code: true } }, _count: { select: { prices: true } } },
  });
}

const toSummary = (l: ListRow): PriceListSummary => ({
  id: l.id, code: l.code, name: l.name, priceMode: l.priceMode, currency: l.currency, scope: l.scope,
  branch: l.branch, channel: l.channel, scalingMode: l.scalingMode,
  validFrom: l.validFrom ? dateStr(l.validFrom) : null, validTo: l.validTo ? dateStr(l.validTo) : null,
  priority: l.priority, roundingDecimals: l.roundingDecimals, status: l.status, products: l._count.prices,
});

@Injectable()
export class PricingService {
  constructor(@Inject(TaxesService) private readonly taxes: TaxesService) {}

  // ───────────── Listas ─────────────

  list(ctx: RequestContext): Promise<PriceListSummary[]> {
    return ctx.run(async (tx) => (await loadLists(tx)).map(toSummary));
  }

  create(ctx: RequestContext, input: PriceListInput): Promise<PriceListSummary> {
    return ctx.run(async (tx) => {
      if (input.branchId && !(await tx.branch.findUnique({ where: { id: input.branchId }, select: { id: true } }))) throw notFound("Sucursal");
      const id = uuidv7();
      try {
        await tx.priceList.create({
          data: {
            id, tenantId: ctx.auth.tenantId, code: input.code, name: input.name, priceMode: input.priceMode, currency: input.currency,
            scope: input.scope, branchId: input.scope === "BRANCH" ? input.branchId! : null, channel: input.scope === "CHANNEL" ? input.channel! : null,
            scalingMode: input.scalingMode, validFrom: input.validFrom ? dateOnly(input.validFrom) : null, validTo: input.validTo ? dateOnly(input.validTo) : null,
            priority: input.priority, roundingDecimals: input.roundingDecimals,
          },
        });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe una lista con ese código.");
        throw e;
      }
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "pricelist.created", entityType: "price_list", entityId: id, actorUserId: ctx.auth.userId,
        after: { code: input.code, priceMode: input.priceMode, scope: input.scope },
      });
      return toSummary((await loadLists(tx, { id }))[0]!);
    });
  }

  update(ctx: RequestContext, id: string, patch: PriceListPatch): Promise<PriceListSummary> {
    return ctx.run(async (tx) => {
      const [before] = await loadLists(tx, { id });
      if (!before) throw notFound("Lista de precios");
      // Una lista tiene UNA sola modalidad: no cambia una vez que hay precios cargados (cambiaría su significado).
      if (patch.priceMode && patch.priceMode !== before.priceMode && before._count.prices > 0) {
        throw conflict("MODE_LOCKED", "No puedes cambiar la modalidad (con/sin impuestos) de una lista que ya tiene precios. Crea otra lista.");
      }
      const validFrom = patch.validFrom === undefined ? before.validFrom : patch.validFrom ? dateOnly(patch.validFrom) : null;
      const validTo = patch.validTo === undefined ? before.validTo : patch.validTo ? dateOnly(patch.validTo) : null;
      if (validFrom && validTo && validTo < validFrom) throw new BadRequestException({ code: "VALIDITY", message: "La vigencia final no puede ser anterior a la inicial." });
      await tx.priceList.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.priceMode !== undefined ? { priceMode: patch.priceMode } : {}),
          ...(patch.scalingMode !== undefined ? { scalingMode: patch.scalingMode } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.roundingDecimals !== undefined ? { roundingDecimals: patch.roundingDecimals } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          validFrom, validTo,
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "pricelist.updated", entityType: "price_list", entityId: id, actorUserId: ctx.auth.userId,
        before: { name: before.name, status: before.status, scalingMode: before.scalingMode },
        after: { name: patch.name ?? before.name, status: patch.status ?? before.status, scalingMode: patch.scalingMode ?? before.scalingMode },
      });
      return toSummary((await loadLists(tx, { id }))[0]!);
    });
  }

  // ───────────── Precios de una lista ─────────────

  prices(ctx: RequestContext, listId: string, q: { q?: string; cursor?: string; limit: number }): Promise<PriceRowList> {
    return ctx.run(async (tx) => {
      if (!(await tx.priceList.findUnique({ where: { id: listId }, select: { id: true } }))) throw notFound("Lista de precios");
      const rows = await tx.productPrice.findMany({
        where: {
          priceListId: listId,
          product: {
            ...(q.cursor ? { code: { gt: q.cursor } } : {}),
            ...(q.q ? { OR: [{ code: { contains: q.q, mode: "insensitive" as const } }, { name: { contains: q.q, mode: "insensitive" as const } }] } : {}),
          },
        },
        orderBy: { product: { code: "asc" } },
        take: q.limit + 1,
        include: { product: { select: { id: true, code: true, name: true, baseUnit: { select: { code: true } } } }, tiers: { orderBy: { minQuantity: "asc" } } },
      });
      const items = rows.slice(0, q.limit).map((r) => ({
        productId: r.product.id, code: r.product.code, name: r.product.name, unit: r.product.baseUnit.code, status: r.status,
        tiers: r.tiers.map((t) => ({ minQuantity: t.minQuantity.toString(), maxQuantity: t.maxQuantity?.toString() ?? null, unitPrice: t.unitPrice.toString() })),
      }));
      return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.code : null };
    });
  }

  /** Hoja de edición: productos activos (opcionalmente de una categoría y sus subcategorías) con sus escalas en la lista. */
  grid(ctx: RequestContext, listId: string, q: { categoryId?: string; q?: string; limit: number }): Promise<PriceGrid> {
    return ctx.run(async (tx) => {
      const list = await tx.priceList.findUnique({ where: { id: listId }, select: { id: true, priceMode: true, scalingMode: true, currency: true } });
      if (!list) throw notFound("Lista de precios");
      let categoryIds: string[] | undefined;
      if (q.categoryId) {
        const all = await tx.category.findMany({ select: { id: true, parentId: true } });
        const set = new Set([q.categoryId]);
        for (let grew = true; grew; ) { grew = false; for (const c of all) if (c.parentId && set.has(c.parentId) && !set.has(c.id)) { set.add(c.id); grew = true; } }
        categoryIds = [...set];
      }
      const rows = await tx.product.findMany({
        where: {
          status: "ACTIVE",
          ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
          ...(q.q ? { OR: [{ code: { contains: q.q, mode: "insensitive" as const } }, { name: { contains: q.q, mode: "insensitive" as const } }] } : {}),
        },
        orderBy: { code: "asc" },
        take: q.limit + 1,
        select: {
          id: true, code: true, name: true, categoryId: true, baseUnit: { select: { code: true } }, category: { select: { name: true } },
          prices: { where: { priceListId: listId }, select: { tiers: { orderBy: { minQuantity: "asc" }, select: { minQuantity: true, unitPrice: true } } } },
        },
      });
      return {
        priceMode: list.priceMode, scalingMode: list.scalingMode, currency: list.currency, truncated: rows.length > q.limit,
        items: rows.slice(0, q.limit).map((p) => ({
          productId: p.id, code: p.code, name: p.name, unit: p.baseUnit.code, categoryId: p.categoryId, category: p.category?.name ?? null,
          tiers: (p.prices[0]?.tiers ?? []).map((t) => ({ minQuantity: t.minQuantity.toString(), unitPrice: t.unitPrice.toString() })),
        })),
      };
    });
  }

  /** Guarda de una vez las escalas de varios productos. Todo o nada: si alguno no es válido no se guarda ninguno. */
  bulkSetPrices(ctx: RequestContext, listId: string, req: BulkPricesRequest): Promise<BulkPricesResult> {
    return ctx.run(async (tx) => {
      if (!(await tx.priceList.findUnique({ where: { id: listId }, select: { id: true } }))) throw notFound("Lista de precios");
      const ids = req.items.map((i) => i.productId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException({ code: "DUPLICATE_PRODUCT", message: "Un producto aparece dos veces en los cambios." });
      const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } });
      if (products.length !== ids.length) throw notFound("Producto");
      const code = new Map(products.map((p) => [p.id, p.code]));
      const current = await tx.productPrice.findMany({ where: { priceListId: listId, productId: { in: ids } }, include: { tiers: { orderBy: { minQuantity: "asc" } } } });
      const before = new Map(current.map((c) => [c.productId, c.tiers.map((t) => `${t.minQuantity}:${t.unitPrice}`).join("|")]));

      const errors: string[] = [];
      const work: { productId: string; tiers: SetPricesRequest["tiers"] }[] = [];
      let unchanged = 0;
      for (const item of req.items) {
        const sorted = [...item.tiers].sort((a, b) => a.minQuantity - b.minQuantity);
        // En la hoja solo se edita el mínimo de cada tramo: el máximo es el mínimo del siguiente.
        const tiers = sorted.map((t, i) => ({ minQuantity: t.minQuantity, maxQuantity: sorted[i + 1]?.minQuantity ?? null, unitPrice: t.unitPrice }));
        const problems = validateTiers(tiers);
        if (problems.length) { errors.push(...problems.map((m) => `${code.get(item.productId)}: ${m}`)); continue; }
        const key = tiers.map((t) => `${new Prisma.Decimal(t.minQuantity)}:${new Prisma.Decimal(t.unitPrice)}`).join("|");
        if (before.get(item.productId) === key) { unchanged++; continue; }
        work.push({ productId: item.productId, tiers });
      }
      if (errors.length) throw new BadRequestException({ code: "INVALID_TIERS", message: "Hay precios no válidos; no se guardó nada.", errors: errors.slice(0, 30) });
      for (const w of work) await this.writeTiers(tx, ctx, listId, w.productId, w.tiers);
      await writeAudit(tx, ctx.auth.tenantId, { action: "price.bulk_updated", entityType: "price_list", entityId: listId, actorUserId: ctx.auth.userId, after: { updated: work.length, unchanged } });
      return { updated: work.length, unchanged };
    });
  }

  /** Reemplaza los tramos de un producto en la lista (valida contigüidad) y registra el historial. */
  setPrices(ctx: RequestContext, listId: string, productId: string, req: SetPricesRequest): Promise<{ productId: string; tiers: number }> {
    return ctx.run(async (tx) => {
      if (!(await tx.priceList.findUnique({ where: { id: listId }, select: { id: true } }))) throw notFound("Lista de precios");
      if (!(await tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw notFound("Producto");
      const errors = validateTiers(req.tiers);
      if (errors.length) throw new BadRequestException({ code: "INVALID_TIERS", message: "Los tramos no son válidos.", errors });
      await this.writeTiers(tx, ctx, listId, productId, req.tiers);
      return { productId, tiers: req.tiers.length };
    });
  }

  /** Reutilizable por la importación: debe ejecutarse dentro de `ctx.run`. */
  async writeTiers(tx: Tx, ctx: RequestContext, listId: string, productId: string, tiers: SetPricesRequest["tiers"]): Promise<void> {
    const existing = await tx.productPrice.findUnique({
      where: { tenantId_priceListId_productId: { tenantId: ctx.auth.tenantId, priceListId: listId, productId } },
      include: { tiers: { orderBy: { minQuantity: "asc" } } },
    });
    const snapshot = (rows: { minQuantity: unknown; maxQuantity?: unknown; unitPrice: unknown }[]) =>
      rows.map((t) => ({ min: String(t.minQuantity), max: t.maxQuantity == null ? null : String(t.maxQuantity), price: String(t.unitPrice) }));
    const before = existing ? snapshot(existing.tiers) : null;

    const ppId = existing?.id ?? uuidv7();
    if (!existing) {
      await tx.productPrice.create({ data: { id: ppId, tenantId: ctx.auth.tenantId, priceListId: listId, productId } });
    } else {
      await tx.productPrice.update({ where: { id: ppId }, data: { status: "ACTIVE" } });
      await tx.productPriceTier.deleteMany({ where: { productPriceId: ppId } });
    }
    await tx.productPriceTier.createMany({
      data: tiers.map((t) => ({ id: uuidv7(), tenantId: ctx.auth.tenantId, productPriceId: ppId, minQuantity: t.minQuantity, maxQuantity: t.maxQuantity ?? null, unitPrice: t.unitPrice })),
    });
    const after = snapshot(tiers.map((t) => ({ minQuantity: t.minQuantity, maxQuantity: t.maxQuantity, unitPrice: t.unitPrice })));
    await tx.priceHistory.create({
      data: { id: uuidv7(), tenantId: ctx.auth.tenantId, priceListId: listId, productId, before: before ?? Prisma.JsonNull, after, actorId: ctx.auth.userId },
    });
    await writeAudit(tx, ctx.auth.tenantId, { action: "price.updated", entityType: "product_price", entityId: ppId, actorUserId: ctx.auth.userId, after: { listId, productId, tiers: tiers.length } });
  }

  removePrice(ctx: RequestContext, listId: string, productId: string): Promise<void> {
    return ctx.run(async (tx) => {
      const pp = await tx.productPrice.findUnique({
        where: { tenantId_priceListId_productId: { tenantId: ctx.auth.tenantId, priceListId: listId, productId } },
        include: { tiers: { orderBy: { minQuantity: "asc" } } },
      });
      if (!pp) throw notFound("Precio");
      await tx.productPrice.delete({ where: { id: pp.id } });
      await tx.priceHistory.create({
        data: {
          id: uuidv7(), tenantId: ctx.auth.tenantId, priceListId: listId, productId, actorId: ctx.auth.userId, after: Prisma.JsonNull,
          before: pp.tiers.map((t) => ({ min: t.minQuantity.toString(), max: t.maxQuantity?.toString() ?? null, price: t.unitPrice.toString() })),
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "price.removed", entityType: "product_price", entityId: pp.id, actorUserId: ctx.auth.userId, after: { listId, productId } });
    });
  }

  history(ctx: RequestContext, listId: string, productId: string) {
    return ctx.run(async (tx) =>
      (await tx.priceHistory.findMany({ where: { priceListId: listId, productId }, orderBy: { changedAt: "desc" }, take: 50 })).map((h) => ({
        changedAt: h.changedAt.toISOString(), actorId: h.actorId, before: h.before, after: h.after,
      })),
    );
  }

  // ───────────── Cotización ─────────────

  /**
   * Calcula el precio de una línea. Elige la lista por precedencia (plan §8.2): lista explícita >
   * sucursal > canal > general; dentro del mismo ámbito, mayor prioridad. La primera lista que
   * tenga precio del producto para esa cantidad gana.
   */
  async quote(ctx: RequestContext, req: QuoteRequest): Promise<QuoteResponse> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run((tx) => this.quoteInTx(ctx, tx, req));
  }

  /** Cotiza una línea dentro de una transacción ya abierta (la usan cotizaciones y ventas). */
  async quoteInTx(ctx: RequestContext, tx: Tx, req: QuoteRequest & { preferListId?: string | null }): Promise<QuoteResponse> {
    {
      const at = req.at ?? (await this.taxes.today(ctx));
      const day = dateOnly(at);
      const product = await tx.product.findUnique({ where: { id: req.productId }, select: { id: true, code: true, name: true, status: true, taxProfileId: true } });
      if (!product) throw notFound("Producto");
      if (product.status !== "ACTIVE") throw conflict("PRODUCT_INACTIVE", "El producto está inactivo.");
      if (req.branchId) await resolveBranchScope(tx, ctx.auth.membershipId, req.branchId, { minLevel: "VIEW" });

      const applicable = [
        { OR: [{ validFrom: null }, { validFrom: { lte: day } }] },
        { OR: [{ validTo: null }, { validTo: { gte: day } }] },
      ];
      const scopes: object[] = [{ scope: "TENANT" }];
      if (req.branchId) scopes.push({ scope: "BRANCH", branchId: req.branchId });
      if (req.channel) scopes.push({ scope: "CHANNEL", channel: req.channel });

      const lists = await tx.priceList.findMany({
        where: { status: "ACTIVE", AND: applicable, ...(req.priceListId ? { id: req.priceListId } : { OR: scopes }) },
      });
      if (req.priceListId && lists.length === 0) throw conflict("LIST_NOT_APPLICABLE", "La lista indicada no existe, está inactiva o no está vigente en esa fecha.");
      lists.sort((a, b) => (req.priceListId ? 0 : SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]) || b.priority - a.priority || a.code.localeCompare(b.code));
      // Lista preferida (la del cliente): se usa primero si tiene el producto; si no, se sigue con las demás listas vigentes.
      if (!req.priceListId && req.preferListId) {
        const own = await tx.priceList.findFirst({ where: { id: req.preferListId, status: "ACTIVE", AND: applicable } });
        if (own) { const i = lists.findIndex((l) => l.id === own.id); if (i >= 0) lists.splice(i, 1); lists.unshift(own); }
      }

      let belowMin: NoTierError | null = null;
      for (const list of lists) {
        const pp = await tx.productPrice.findUnique({
          where: { tenantId_priceListId_productId: { tenantId: ctx.auth.tenantId, priceListId: list.id, productId: product.id } },
          include: { tiers: true },
        });
        if (!pp || pp.status !== "ACTIVE" || pp.tiers.length === 0) continue;

        let priced;
        try {
          priced = priceQuantity(pp.tiers.map((t) => ({ minQuantity: t.minQuantity, maxQuantity: t.maxQuantity, unitPrice: t.unitPrice })), req.quantity, list.scalingMode);
        } catch (e) {
          if (e instanceof NoTierError) { belowMin = e; continue; }
          throw e;
        }
        const lineAmount = priced.total.toDecimalPlaces(list.roundingDecimals, Prisma.Decimal.ROUND_HALF_UP);
        const taxInputs = await this.taxes.resolveForProduct(tx, product.taxProfileId, at);
        const tax = calculateLineTax(lineAmount, list.priceMode, taxInputs, list.roundingDecimals);
        const qty = new Prisma.Decimal(req.quantity);
        return {
          product: { id: product.id, code: product.code, name: product.name },
          priceList: { id: list.id, code: list.code, name: list.name, priceMode: list.priceMode, scalingMode: list.scalingMode, currency: list.currency },
          resolvedBy: req.priceListId ? ("EXPLICIT" as const) : RESOLVED_BY[list.scope],
          quantity: qty.toString(),
          unitPrice: lineAmount.div(qty).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toString(),
          lineAmount: lineAmount.toFixed(list.roundingDecimals),
          breakdown: priced.parts,
          tax,
        };
      }
      if (belowMin) throw conflict("BELOW_MINIMUM", belowMin.message);
      throw notFound("Precio del producto en las listas vigentes");
    }
  }

  /**
   * Escalas de precio vigentes de varios productos, con la misma precedencia de listas que la cotización: lista explícita > sucursal > canal > general.
   * Para cada producto vale la primera lista que lo tenga con precio activo.
   */
  async tiersFor(ctx: RequestContext, tx: Tx, req: { productIds: string[]; branchId?: string; channel?: "POS" | "ECOMMERCE" | "MESSAGING"; priceListId?: string | null }) {
    const day = dateOnly(await this.taxes.today(ctx));
    const scopes: object[] = [{ scope: "TENANT" }];
    if (req.branchId) scopes.push({ scope: "BRANCH", branchId: req.branchId });
    if (req.channel) scopes.push({ scope: "CHANNEL", channel: req.channel });
    const applicable = [{ OR: [{ validFrom: null }, { validFrom: { lte: day } }] }, { OR: [{ validTo: null }, { validTo: { gte: day } }] }];
    const lists = await tx.priceList.findMany({ where: { status: "ACTIVE", AND: applicable, OR: scopes } });
    lists.sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] || b.priority - a.priority || a.code.localeCompare(b.code));
    // La lista propia del cliente se prefiere si tiene el producto; si no, se sigue con las demás.
    if (req.priceListId) {
      const own = await tx.priceList.findFirst({ where: { id: req.priceListId, status: "ACTIVE", AND: applicable } });
      if (own) { lists.splice(lists.findIndex((l) => l.id === own.id) >= 0 ? lists.findIndex((l) => l.id === own.id) : lists.length, 1); lists.unshift(own); }
    }
    const prices = await tx.productPrice.findMany({
      where: { productId: { in: req.productIds }, status: "ACTIVE", priceListId: { in: lists.map((l) => l.id) } },
      include: { tiers: { orderBy: { minQuantity: "asc" } } },
    });
    const out = new Map<string, { listId: string; listCode: string; priceMode: "WITH_TAX" | "WITHOUT_TAX"; scalingMode: "TIER_THRESHOLD" | "PROGRESSIVE"; currency: string; tiers: { min: string; max: string | null; price: string }[] }>();
    for (const id of req.productIds) {
      for (const l of lists) {
        const pp = prices.find((x) => x.productId === id && x.priceListId === l.id);
        if (!pp || pp.tiers.length === 0) continue;
        out.set(id, { listId: l.id, listCode: l.code, priceMode: l.priceMode, scalingMode: l.scalingMode, currency: l.currency, tiers: pp.tiers.map((t) => ({ min: t.minQuantity.toString(), max: t.maxQuantity?.toString() ?? null, price: t.unitPrice.toString() })) });
        break;
      }
    }
    return out;
  }

  /**
   * Precio de una línea de DOCUMENTO (cotización o venta): lista + tramos + descuento + impuestos, con la foto completa del
   * cálculo para guardarla en el documento (plan §8.5). El descuento se aplica sobre el importe de la lista y los tributos
   * se recalculan sobre lo que realmente se cobra.
   */
  async priceDocumentLine(ctx: RequestContext, tx: Tx, req: QuoteRequest & { discountPct?: number; overrideUnitPrice?: number; skipTax?: boolean; preferListId?: string | null }): Promise<DocumentLinePrice> {
    const q = await this.quoteInTx(ctx, tx, req);
    const list = await tx.priceList.findUniqueOrThrow({ where: { id: q.priceList.id }, select: { roundingDecimals: true } });
    const product = await tx.product.findUniqueOrThrow({ where: { id: req.productId }, select: { taxProfileId: true } });
    const at = req.at ?? (await this.taxes.today(ctx));
    const dec = list.roundingDecimals;
    const pct = new Prisma.Decimal(req.discountPct ?? 0);
    const listAmountFromList = new Prisma.Decimal(q.lineAmount);
    // Precio cambiado a mano: reemplaza el importe de la lista (el precio de lista original queda en la foto).
    const listAmount = req.overrideUnitPrice !== undefined ? new Prisma.Decimal(req.overrideUnitPrice).mul(new Prisma.Decimal(q.quantity)).toDecimalPlaces(dec, Prisma.Decimal.ROUND_HALF_UP) : listAmountFromList;
    const charged = listAmount.mul(new Prisma.Decimal(100).minus(pct)).div(100).toDecimalPlaces(dec, Prisma.Decimal.ROUND_HALF_UP);
    // Venta «sin impuestos» (SF): se cobra el precio tal cual, sin tributos.
    const taxInputs = req.skipTax ? [] : await this.taxes.resolveForProduct(tx, product.taxProfileId, at);
    const tax = calculateLineTax(charged, q.priceList.priceMode, taxInputs, dec);
    return {
      priceListId: q.priceList.id, priceMode: q.priceList.priceMode, scalingMode: q.priceList.scalingMode, currency: q.priceList.currency,
      listUnitPrice: listAmountFromList.div(new Prisma.Decimal(q.quantity)).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP),
      appliedUnitPrice: req.overrideUnitPrice !== undefined ? new Prisma.Decimal(req.overrideUnitPrice) : null,
      discountPct: pct, netAmount: new Prisma.Decimal(tax.net), taxAmount: new Prisma.Decimal(tax.taxTotal), totalAmount: new Prisma.Decimal(tax.total),
      /** Importe que dejó de cobrarse por el descuento (en la misma base que el total de la línea). */
      discountAmount: Prisma.Decimal.max(new Prisma.Decimal(0), new Prisma.Decimal(calculateLineTax(listAmount, q.priceList.priceMode, taxInputs, dec).total).minus(new Prisma.Decimal(tax.total))),
      taxes: tax.taxes, breakdown: q.breakdown, resolvedBy: q.resolvedBy,
    };
  }
}

export interface DocumentLinePrice {
  priceListId: string; priceMode: "WITH_TAX" | "WITHOUT_TAX"; scalingMode: "TIER_THRESHOLD" | "PROGRESSIVE"; currency: string;
  listUnitPrice: Prisma.Decimal; appliedUnitPrice: Prisma.Decimal | null; discountPct: Prisma.Decimal; netAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal; discountAmount: Prisma.Decimal;
  taxes: unknown; breakdown: unknown; resolvedBy: string;
}
