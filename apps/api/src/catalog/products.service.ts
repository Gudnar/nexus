import { Injectable } from "@nestjs/common";
import type { ProductDetail, ProductInput, ProductList, ProductListQuery, ProductPatch, ProductSummary } from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type Tx } from "@erp/db";
import { thumbOf } from "../integrations/cloudinary.client";
import { badRequest, conflict, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

const summarySelect = {
  id: true, code: true, name: true, kind: true, status: true, trackLots: true, trackExpiry: true,
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  taxProfile: { select: { id: true, code: true, name: true } },
  baseUnit: { select: { id: true, code: true, decimals: true } },
  variantValues: true,
  group: { select: { id: true, name: true, options: true } },
  images: { where: { isPrimary: true }, select: { url: true }, take: 1 },
} as const;

type SummaryRow = Prisma.ProductGetPayload<{ select: typeof summarySelect }>;

/** Fila de la base → resumen del producto (con su foto principal y su variante). */
export function toSummary(r: SummaryRow): ProductSummary {
  const { variantValues, group, images, ...rest } = r;
  const opts = (group?.options ?? []) as { name: string }[];
  const vals = (variantValues ?? {}) as Record<string, string>;
  const url = images[0]?.url ?? null;
  return {
    ...rest, imageUrl: url, thumbUrl: url ? thumbOf(url) : null,
    group: group ? { id: group.id, name: group.name } : null,
    variantLabel: group ? opts.map((o) => vals[o.name]).filter(Boolean).join(" / ") : null,
  } as ProductSummary;
}

type Barcode = { barcode: string; unitId?: string | null };
type Conversion = { unitId: string; factor: number };

@Injectable()
export class ProductsService {
  async list(ctx: RequestContext, q: ProductListQuery): Promise<ProductList> {
    return ctx.run(async (tx) => {
      const categoryIds = q.categoryId ? await this.withDescendants(tx, q.categoryId) : undefined;
      const rows = await tx.product.findMany({
        where: {
          ...(q.status ? { status: q.status } : {}),
          ...(q.kind ? { kind: q.kind } : {}),
          ...(q.brandId ? { brandId: q.brandId } : {}),
          ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
          ...(q.cursor ? { code: { gt: q.cursor } } : {}),
          ...(q.q
            ? {
                OR: [
                  { code: { contains: q.q, mode: "insensitive" as const } },
                  { name: { contains: q.q, mode: "insensitive" as const } },
                  { barcodes: { some: { barcode: { contains: q.q, mode: "insensitive" as const } } } },
                ],
              }
            : {}),
        },
        orderBy: { code: "asc" },
        take: q.limit + 1,
        select: summarySelect,
      });
      const items = rows.slice(0, q.limit).map(toSummary);
      return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.code : null };
    });
  }

  get(ctx: RequestContext, id: string): Promise<ProductDetail> {
    return ctx.run((tx) => this.detail(tx, id));
  }

  create(ctx: RequestContext, input: ProductInput): Promise<ProductDetail> {
    return ctx.run((tx) => this.createTx(tx, ctx, input));
  }

  /** Crea dentro de la transacción del llamador (la importación aplica muchas filas atómicamente). */
  async createTx(tx: Tx, ctx: RequestContext, input: ProductInput): Promise<ProductDetail> {
    {
      await this.assertRefs(tx, { baseUnitId: input.baseUnitId, categoryId: input.categoryId, brandId: input.brandId, taxProfileId: input.taxProfileId }, true);
      this.assertUnits(input.baseUnitId, input.conversions, input.barcodes);
      await this.assertConversionUnits(tx, input.conversions);

      const id = uuidv7();
      const code = input.code ?? (await this.nextCode(tx, ctx.auth.tenantId));
      try {
        await tx.product.create({
          data: {
            id, tenantId: ctx.auth.tenantId, code, name: input.name, description: input.description || null, kind: input.kind,
            categoryId: input.categoryId ?? null, brandId: input.brandId ?? null, taxProfileId: input.taxProfileId ?? null, baseUnitId: input.baseUnitId,
            trackLots: input.trackLots, trackExpiry: input.trackExpiry,
          },
        });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe un producto con ese código.");
        throw e;
      }
      await this.replaceChildren(tx, ctx.auth.tenantId, id, input.barcodes, input.conversions);
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "product.created", entityType: "product", entityId: id, actorUserId: ctx.auth.userId, after: { code, name: input.name, kind: input.kind },
      });
      return this.detail(tx, id);
    }
  }

  update(ctx: RequestContext, id: string, patch: ProductPatch): Promise<ProductDetail> {
    return ctx.run((tx) => this.updateTx(tx, ctx, id, patch));
  }

  async updateTx(tx: Tx, ctx: RequestContext, id: string, patch: ProductPatch): Promise<ProductDetail> {
    {
      const before = await tx.product.findUnique({
        where: { id }, include: { barcodes: true, conversions: true },
      });
      if (!before) throw notFound("Producto");
      await this.assertRefs(tx, { categoryId: patch.categoryId, brandId: patch.brandId, taxProfileId: patch.taxProfileId }, false);

      const kind = patch.kind ?? before.kind;
      const trackLots = patch.trackLots ?? before.trackLots;
      const trackExpiry = patch.trackExpiry ?? before.trackExpiry;
      if (trackExpiry && !trackLots) throw badRequest("EXPIRY_NEEDS_LOTS", "El control de vencimiento requiere control por lote.");
      if (kind === "SERVICE" && (trackLots || trackExpiry)) throw badRequest("SERVICE_UNTRACKED", "Un servicio no lleva lote ni vencimiento.");

      const conversions = patch.conversions ?? before.conversions.map((c) => ({ unitId: c.unitId, factor: Number(c.factor) }));
      const barcodes = patch.barcodes ?? before.barcodes.map((b) => ({ barcode: b.barcode, unitId: b.unitId }));
      this.assertUnits(before.baseUnitId, conversions, barcodes);
      if (patch.conversions) await this.assertConversionUnits(tx, patch.conversions);

      await tx.product.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description || null } : {}),
          kind, trackLots, trackExpiry,
          ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
          ...(patch.brandId !== undefined ? { brandId: patch.brandId } : {}),
          ...(patch.taxProfileId !== undefined ? { taxProfileId: patch.taxProfileId } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      });
      if (patch.barcodes !== undefined || patch.conversions !== undefined) {
        await this.replaceChildren(tx, ctx.auth.tenantId, id, patch.barcodes, patch.conversions);
      }
      await writeAudit(tx, ctx.auth.tenantId, {
        action: patch.status !== undefined && patch.status !== before.status ? `product.${patch.status === "ACTIVE" ? "activated" : "deactivated"}` : "product.updated",
        entityType: "product", entityId: id, actorUserId: ctx.auth.userId,
        before: { name: before.name, status: before.status, kind: before.kind, trackLots: before.trackLots },
        after: { name: patch.name ?? before.name, status: patch.status ?? before.status, kind, trackLots },
      });
      return this.detail(tx, id);
    }
  }

  // ───────────── Reglas ─────────────

  /** Las conversiones no incluyen la unidad base ni se repiten; cada código de barras usa la base o una conversión. */
  private assertUnits(baseUnitId: string, conversions: Conversion[], barcodes: Barcode[]): void {
    const ids = conversions.map((c) => c.unitId);
    if (ids.includes(baseUnitId)) throw badRequest("CONVERSION_BASE", "La unidad base no necesita conversión (equivale a 1).");
    if (new Set(ids).size !== ids.length) throw badRequest("CONVERSION_DUPLICATE", "Hay una unidad repetida en las conversiones.");
    const codes = barcodes.map((b) => b.barcode.toLowerCase());
    if (new Set(codes).size !== codes.length) throw badRequest("BARCODE_DUPLICATE", "Hay un código de barras repetido.");
    const allowed = new Set([baseUnitId, ...ids]);
    for (const b of barcodes) {
      if (b.unitId && !allowed.has(b.unitId)) throw badRequest("BARCODE_UNIT", "Cada código de barras debe pertenecer a la unidad base o a una de sus conversiones.");
    }
  }

  private async assertConversionUnits(tx: Tx, conversions: Conversion[]): Promise<void> {
    if (!conversions.length) return;
    const n = await tx.unitOfMeasure.count({ where: { id: { in: conversions.map((c) => c.unitId) } } });
    if (n !== conversions.length) throw notFound("Unidad de la conversión");
  }

  private async assertRefs(
    tx: Tx, refs: { baseUnitId?: string; categoryId?: string | null; brandId?: string | null; taxProfileId?: string | null }, creating: boolean,
  ): Promise<void> {
    if (refs.baseUnitId) {
      const u = await tx.unitOfMeasure.findUnique({ where: { id: refs.baseUnitId }, select: { status: true } });
      if (!u) throw notFound("Unidad base");
      if (creating && u.status !== "ACTIVE") throw conflict("UNIT_INACTIVE", "La unidad base está inactiva.");
    }
    if (refs.categoryId && !(await tx.category.findUnique({ where: { id: refs.categoryId }, select: { id: true } }))) throw notFound("Categoría");
    if (refs.brandId && !(await tx.brand.findUnique({ where: { id: refs.brandId }, select: { id: true } }))) throw notFound("Marca");
    if (refs.taxProfileId) {
      const tp = await tx.taxProfile.findUnique({ where: { id: refs.taxProfileId }, select: { appliesTo: true, status: true } });
      if (!tp) throw notFound("Perfil fiscal");
      if (tp.appliesTo !== "PRODUCT") throw badRequest("TAX_PROFILE_KIND", "Ese perfil fiscal no es de productos.");
      if (creating && tp.status !== "ACTIVE") throw conflict("TAX_PROFILE_INACTIVE", "El perfil fiscal está inactivo.");
    }
  }

  private async replaceChildren(
    tx: Tx, tenantId: string, productId: string, barcodes: Barcode[] | undefined, conversions: Conversion[] | undefined,
  ): Promise<void> {
    if (conversions !== undefined) {
      await tx.productUnitConversion.deleteMany({ where: { productId } });
      if (conversions.length) {
        await tx.productUnitConversion.createMany({ data: conversions.map((c) => ({ tenantId, productId, unitId: c.unitId, factor: c.factor })) });
      }
    }
    if (barcodes !== undefined) {
      await tx.productBarcode.deleteMany({ where: { productId } });
      if (barcodes.length) {
        // Un código de barras identifica un solo producto en toda la empresa.
        const taken = await tx.productBarcode.findMany({ where: { barcode: { in: barcodes.map((b) => b.barcode) }, productId: { not: productId } }, select: { barcode: true } });
        if (taken.length) throw conflict("BARCODE_TAKEN", `El código de barras ${taken[0]!.barcode} ya pertenece a otro producto.`);
        try {
          await tx.productBarcode.createMany({ data: barcodes.map((b) => ({ id: uuidv7(), tenantId, productId, barcode: b.barcode, unitId: b.unitId ?? null })) });
        } catch (e) {
          if (isUnique(e)) throw conflict("BARCODE_TAKEN", "Uno de los códigos de barras ya pertenece a otro producto.");
          throw e;
        }
      }
    }
  }

  /** Correlativo automático P-000001… sin chocar con códigos manuales ya existentes. */
  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "PRODUCT", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "PRODUCT", prefix: "P-", padding: 6 } });
    }
    for (let i = 0; i < 20; i++) {
      const { formatted } = await nextSequenceNumber(tx, "PRODUCT");
      if (!(await tx.product.findUnique({ where: { tenantId_code: { tenantId, code: formatted } }, select: { id: true } }))) return formatted;
    }
    throw conflict("CODE_GENERATION", "No se pudo generar un código libre; indícalo manualmente.");
  }

  private async withDescendants(tx: Tx, rootId: string): Promise<string[]> {
    const all = await tx.category.findMany({ select: { id: true, parentId: true } });
    const out = new Set([rootId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of all) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; }
    }
    return [...out];
  }

  private async detail(tx: Tx, id: string): Promise<ProductDetail> {
    const p = await tx.product.findUnique({
      where: { id },
      select: {
        ...summarySelect, description: true,
        barcodes: { select: { barcode: true, unitId: true }, orderBy: { barcode: "asc" } },
        conversions: { select: { unitId: true, factor: true, unit: { select: { code: true } } }, orderBy: { unit: { code: "asc" } } },
      },
    });
    if (!p) throw notFound("Producto");
    return {
      ...toSummary(p), description: p.description,
      barcodes: p.barcodes,
      conversions: p.conversions.map((c) => ({ unitId: c.unitId, unitCode: c.unit.code, factor: c.factor.toString() })),
    };
  }
}
