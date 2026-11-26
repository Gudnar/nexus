import { Inject, Injectable } from "@nestjs/common";
import type { AddVariantInput, ProductGroupInput, ProductGroupView, ProductInput } from "@erp/contracts";
import { uuidv7, writeAudit, type Tx } from "@erp/db";
import { badRequest, conflict, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { thumbOf } from "../integrations/cloudinary.client";
import { ProductsService } from "./products.service";

type Option = { name: string; values: string[] };
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const abbr = (v: string, n: number) => strip(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n) || "X";
/** Clave estable de una combinación (sin mayúsculas ni acentos): evita «Rojo» y «rojo» como variantes distintas. */
const keyOf = (options: Option[], values: Record<string, string>) => options.map((o) => strip(values[o.name] ?? "").toLowerCase().trim()).join("|");
const labelOf = (options: Option[], values: Record<string, string>) => options.map((o) => values[o.name]).filter(Boolean).join(" / ");

function combos(options: Option[]): Record<string, string>[] {
  return options.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v }))), [{}]);
}

/**
 * Variantes de producto (talla, color…). Cada variante es un producto normal —con su propio código, código de barras, stock y precios—
 * agrupado en una familia, así compras, inventario, ventas y precios las tratan sin cambios.
 */
@Injectable()
export class ProductGroupsService {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  /** Códigos de las variantes: PREFIJO-VAL1-VAL2, alargando las abreviaturas si dos combinaciones chocan. */
  private codes(base: string, options: Option[], list: Record<string, string>[]): string[] {
    for (const n of [3, 4, 6]) {
      const codes = list.map((c) => [base, ...options.map((o) => abbr(c[o.name]!, n))].join("-"));
      if (new Set(codes).size === codes.length) return codes;
    }
    const seen = new Map<string, number>();
    return list.map((c) => {
      const code = [base, ...options.map((o) => abbr(c[o.name]!, 6))].join("-");
      const k = (seen.get(code) ?? 0) + 1; seen.set(code, k);
      return k === 1 ? code : `${code}-${k}`;
    });
  }

  async create(ctx: RequestContext, input: ProductGroupInput): Promise<ProductGroupView> {
    const options: Option[] = input.options.map((o) => ({ name: o.name, values: o.values }));
    const list = combos(options);
    const codes = this.codes(input.baseCode, options, list);
    if (codes.some((c) => c.length > 30)) throw badRequest("CODE_TOO_LONG", "Los códigos de las variantes superan 30 caracteres: usa un prefijo más corto.");
    const id = await ctx.run(async (tx) => {
      const taken = await tx.product.findMany({ where: { code: { in: codes } }, select: { code: true } });
      if (taken.length) throw conflict("CODE_TAKEN", `Ya existen productos con estos códigos: ${taken.slice(0, 5).map((t) => t.code).join(", ")}. Usa otro prefijo.`);
      const g = await tx.productGroup.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, name: input.name, description: input.description ?? null, options } });
      for (let i = 0; i < list.length; i++) await this.createVariant(tx, ctx, g.id, input, options, list[i]!, codes[i]!);
      await writeAudit(tx, ctx.auth.tenantId, { action: "product.group_created", entityType: "product_group", entityId: g.id, actorUserId: ctx.auth.userId, after: { name: input.name, variants: list.length } });
      return g.id;
    });
    return this.get(ctx, id);
  }

  private async createVariant(tx: Tx, ctx: RequestContext, groupId: string, base: Pick<ProductGroupInput, "name" | "description" | "baseUnitId" | "categoryId" | "brandId" | "taxProfileId" | "trackLots" | "trackExpiry">, options: Option[], values: Record<string, string>, code: string) {
    const input: ProductInput = {
      code, name: `${base.name} - ${labelOf(options, values)}`.slice(0, 160), description: base.description, kind: "GOODS",
      categoryId: base.categoryId ?? null, brandId: base.brandId ?? null, taxProfileId: base.taxProfileId ?? null, baseUnitId: base.baseUnitId,
      trackLots: base.trackLots, trackExpiry: base.trackExpiry, barcodes: [], conversions: [],
    };
    const p = await this.products.createTx(tx, ctx, input);
    await tx.product.update({ where: { id: p.id }, data: { groupId, variantValues: values, variantKey: keyOf(options, values) } });
    return p.id;
  }

  async get(ctx: RequestContext, groupId: string): Promise<ProductGroupView> {
    return ctx.run((tx) => this.view(tx, groupId));
  }

  private async view(tx: Tx, groupId: string): Promise<ProductGroupView> {
    const g = await tx.productGroup.findUnique({ where: { id: groupId } });
    if (!g) throw notFound("Producto con variantes");
    const options = g.options as Option[];
    const rows = await tx.product.findMany({
      where: { groupId }, orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, status: true, variantValues: true, images: { where: { isPrimary: true }, select: { url: true }, take: 1 } },
    });
    return {
      id: g.id, name: g.name, description: g.description, options,
      variants: rows.map((r) => {
        const values = (r.variantValues ?? {}) as Record<string, string>;
        const url = r.images[0]?.url ?? null;
        return { id: r.id, code: r.code, name: r.name, status: r.status, variantLabel: labelOf(options, values), values, imageUrl: url, thumbUrl: url ? thumbOf(url) : null };
      }),
    };
  }

  /** Agrega una variante a una familia existente (con valores nuevos si hace falta). */
  async addVariant(ctx: RequestContext, groupId: string, input: AddVariantInput): Promise<ProductGroupView> {
    await ctx.run(async (tx) => {
      const g = await tx.productGroup.findUnique({ where: { id: groupId } });
      if (!g) throw notFound("Producto con variantes");
      const options = g.options as Option[];
      const values: Record<string, string> = {};
      for (const o of options) {
        const v = input.values[o.name]?.trim();
        if (!v) throw badRequest("VALUE_REQUIRED", `Indica el valor de «${o.name}».`);
        values[o.name] = v;
      }
      if (Object.keys(input.values).some((k) => !options.some((o) => o.name === k))) throw badRequest("OPTION_UNKNOWN", "Hay una opción que este producto no tiene.");
      const key = keyOf(options, values);
      if (await tx.product.findFirst({ where: { groupId, variantKey: key }, select: { id: true } })) throw conflict("VARIANT_EXISTS", "Esa combinación ya existe.");
      // Hereda los datos de las variantes que ya hay.
      const sib = await tx.product.findFirst({ where: { groupId }, orderBy: { code: "asc" }, select: { code: true, description: true, baseUnitId: true, categoryId: true, brandId: true, taxProfileId: true, trackLots: true, trackExpiry: true } });
      if (!sib) throw conflict("EMPTY_GROUP", "La familia no tiene variantes de las que copiar los datos.");
      const prefix = sib.code.split("-")[0]!;
      let code = [prefix, ...options.map((o) => abbr(values[o.name]!, 3))].join("-");
      for (let n = 2; await tx.product.findFirst({ where: { code }, select: { id: true } }); n++) code = `${[prefix, ...options.map((o) => abbr(values[o.name]!, 3))].join("-")}-${n}`;
      if (code.length > 30) throw badRequest("CODE_TOO_LONG", "El código de la variante supera 30 caracteres.");
      await this.createVariant(tx, ctx, groupId, { name: g.name, description: sib.description ?? undefined, baseUnitId: sib.baseUnitId, categoryId: sib.categoryId, brandId: sib.brandId, taxProfileId: sib.taxProfileId, trackLots: sib.trackLots, trackExpiry: sib.trackExpiry }, options, values, code);
      // Los valores nuevos pasan a formar parte de las opciones de la familia.
      const grown = options.map((o) => ({ name: o.name, values: o.values.some((x) => keyOf([o], { [o.name]: x }) === keyOf([o], { [o.name]: values[o.name]! })) ? o.values : [...o.values, values[o.name]!] }));
      await tx.productGroup.update({ where: { id: groupId }, data: { options: grown } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "product.variant_added", entityType: "product_group", entityId: groupId, actorUserId: ctx.auth.userId, after: { values } });
    });
    return this.get(ctx, groupId);
  }
}
