import { Injectable } from "@nestjs/common";
import type {
  BrandInput, BrandPatch, BrandSummary, CategoryInput, CategoryPatch, CategorySummary, UnitInput, UnitPatch, UnitSummary,
} from "@erp/contracts";
import { uuidv7, writeAudit, type Tx } from "@erp/db";
import { badRequest, conflict, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const MAX_DEPTH = 5;

/** Maestros simples del catálogo: unidades de medida, categorías y marcas. */
@Injectable()
export class MastersService {
  // ───────────── Unidades ─────────────

  listUnits(ctx: RequestContext): Promise<UnitSummary[]> {
    return ctx.run(async (tx) =>
      (await tx.unitOfMeasure.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { products: true } } } })).map((u) => ({
        id: u.id, code: u.code, name: u.name, decimals: u.decimals, status: u.status, products: u._count.products,
      })),
    );
  }

  createUnit(ctx: RequestContext, input: UnitInput): Promise<UnitSummary> {
    return ctx.run(async (tx) => {
      const id = uuidv7();
      try {
        await tx.unitOfMeasure.create({ data: { id, tenantId: ctx.auth.tenantId, code: input.code, name: input.name, decimals: input.decimals } });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe una unidad con ese código.");
        throw e;
      }
      await this.audit(ctx, tx, "unit.created", "unit", id, { code: input.code });
      return { id, code: input.code, name: input.name, decimals: input.decimals, status: "ACTIVE", products: 0 };
    });
  }

  updateUnit(ctx: RequestContext, id: string, patch: UnitPatch): Promise<UnitSummary> {
    return ctx.run(async (tx) => {
      const before = await tx.unitOfMeasure.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
      if (!before) throw notFound("Unidad");
      if (patch.decimals !== undefined && patch.decimals !== before.decimals && before._count.products > 0) {
        throw conflict("UNIT_IN_USE", "No puedes cambiar los decimales de una unidad que usan productos.");
      }
      const u = await tx.unitOfMeasure.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.decimals !== undefined ? { decimals: patch.decimals } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      });
      await this.audit(ctx, tx, "unit.updated", "unit", id, { before: { name: before.name, decimals: before.decimals, status: before.status }, after: { name: u.name, decimals: u.decimals, status: u.status } });
      return { id, code: u.code, name: u.name, decimals: u.decimals, status: u.status, products: before._count.products };
    });
  }

  // ───────────── Categorías ─────────────

  listCategories(ctx: RequestContext): Promise<CategorySummary[]> {
    return ctx.run(async (tx) =>
      (await tx.category.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { products: true } } } })).map((c) => ({
        id: c.id, code: c.code, name: c.name, parentId: c.parentId, status: c.status, products: c._count.products,
      })),
    );
  }

  createCategory(ctx: RequestContext, input: CategoryInput): Promise<CategorySummary> {
    return ctx.run(async (tx) => {
      if (input.parentId) await this.assertParent(tx, null, input.parentId);
      const id = uuidv7();
      try {
        await tx.category.create({ data: { id, tenantId: ctx.auth.tenantId, code: input.code, name: input.name, parentId: input.parentId ?? null } });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe una categoría con ese código.");
        throw e;
      }
      await this.audit(ctx, tx, "category.created", "category", id, { code: input.code, name: input.name });
      return { id, code: input.code, name: input.name, parentId: input.parentId ?? null, status: "ACTIVE", products: 0 };
    });
  }

  updateCategory(ctx: RequestContext, id: string, patch: CategoryPatch): Promise<CategorySummary> {
    return ctx.run(async (tx) => {
      const before = await tx.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
      if (!before) throw notFound("Categoría");
      if (patch.parentId !== undefined && patch.parentId !== before.parentId && patch.parentId !== null) {
        await this.assertParent(tx, id, patch.parentId);
      }
      const c = await tx.category.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      });
      await this.audit(ctx, tx, "category.updated", "category", id, { before: { name: before.name, parentId: before.parentId, status: before.status }, after: { name: c.name, parentId: c.parentId, status: c.status } });
      return { id, code: c.code, name: c.name, parentId: c.parentId, status: c.status, products: before._count.products };
    });
  }

  /** El padre debe existir, no crear ciclos y no superar la profundidad máxima. */
  private async assertParent(tx: Tx, selfId: string | null, parentId: string): Promise<void> {
    const all = await tx.category.findMany({ select: { id: true, parentId: true } });
    const byId = new Map(all.map((c) => [c.id, c.parentId]));
    if (!byId.has(parentId)) throw notFound("Categoría padre");
    // Ancestros del padre propuesto
    let depth = 1;
    for (let cur: string | null = parentId; cur; cur = byId.get(cur) ?? null) {
      if (selfId && cur === selfId) throw badRequest("CATEGORY_CYCLE", "Una categoría no puede ser hija de sí misma ni de sus descendientes.");
      depth++;
      if (depth > MAX_DEPTH) throw badRequest("DEPTH_EXCEEDED", `Las categorías admiten hasta ${MAX_DEPTH} niveles.`);
    }
    // Profundidad de la rama que cuelga de `self`
    if (selfId) {
      const height = (id: string): number => 1 + Math.max(0, ...all.filter((c) => c.parentId === id).map((c) => height(c.id)));
      if (depth - 1 + height(selfId) > MAX_DEPTH) throw badRequest("DEPTH_EXCEEDED", `Las categorías admiten hasta ${MAX_DEPTH} niveles.`);
    }
  }

  // ───────────── Marcas ─────────────

  listBrands(ctx: RequestContext): Promise<BrandSummary[]> {
    return ctx.run(async (tx) =>
      (await tx.brand.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } })).map((b) => ({
        id: b.id, name: b.name, status: b.status, products: b._count.products,
      })),
    );
  }

  createBrand(ctx: RequestContext, input: BrandInput): Promise<BrandSummary> {
    return ctx.run(async (tx) => {
      const id = uuidv7();
      try {
        await tx.brand.create({ data: { id, tenantId: ctx.auth.tenantId, name: input.name } });
      } catch (e) {
        if (isUnique(e)) throw conflict("NAME_TAKEN", "Ya existe una marca con ese nombre.");
        throw e;
      }
      await this.audit(ctx, tx, "brand.created", "brand", id, { name: input.name });
      return { id, name: input.name, status: "ACTIVE", products: 0 };
    });
  }

  updateBrand(ctx: RequestContext, id: string, patch: BrandPatch): Promise<BrandSummary> {
    return ctx.run(async (tx) => {
      const before = await tx.brand.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
      if (!before) throw notFound("Marca");
      let b;
      try {
        b = await tx.brand.update({ where: { id }, data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) } });
      } catch (e) {
        if (isUnique(e)) throw conflict("NAME_TAKEN", "Ya existe una marca con ese nombre.");
        throw e;
      }
      await this.audit(ctx, tx, "brand.updated", "brand", id, { before: { name: before.name, status: before.status }, after: { name: b.name, status: b.status } });
      return { id, name: b.name, status: b.status, products: before._count.products };
    });
  }

  private audit(ctx: RequestContext, tx: Tx, action: string, entityType: string, entityId: string, data: Record<string, unknown>) {
    const { before, after, ...rest } = data as { before?: unknown; after?: unknown };
    return writeAudit(tx, ctx.auth.tenantId, {
      action, entityType, entityId, actorUserId: ctx.auth.userId, before, after: after ?? (Object.keys(rest).length ? rest : undefined),
    });
  }
}
