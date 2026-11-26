import { Inject, Injectable } from "@nestjs/common";
import type { TaxCodeInput, TaxCodePatch, TaxCodeSummary, TaxProfileInput, TaxProfilePatch, TaxProfileSummary } from "@erp/contracts";
import { uuidv7, writeAudit, type Tx } from "@erp/db";
import { Clock } from "../access/clock";
import { localParts } from "../access/schedule";
import { badRequest, conflict, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import type { TaxInput } from "./tax";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
export const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
export const dateStr = (d: Date) => d.toISOString().slice(0, 10);

/** Capas 1 y 2 del modelo fiscal (ADR-002): catálogo de tributos con tasas por vigencia y perfiles fiscales. */
@Injectable()
export class TaxesService {
  constructor(@Inject(Clock) private readonly clock: Clock) {}

  /** Fecha local de hoy en la zona de la empresa. */
  async today(ctx: RequestContext): Promise<string> {
    return localParts(this.clock.now(), (await ctx.tenantInfo()).timezone).date;
  }

  // ───────────── Tributos y tasas ─────────────

  async listCodes(ctx: RequestContext): Promise<TaxCodeSummary[]> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const today = await this.today(ctx);
      const rows = await tx.taxCode.findMany({ orderBy: { code: "asc" }, include: { rates: { orderBy: { validFrom: "asc" } } } });
      return rows.map((c) => this.toSummary(c, today));
    });
  }

  async createCode(ctx: RequestContext, input: TaxCodeInput): Promise<TaxCodeSummary> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const id = uuidv7();
      try {
        await tx.taxCode.create({ data: { id, tenantId: ctx.auth.tenantId, code: input.code, name: input.name, jurisdiction: input.jurisdiction || null } });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe un tributo con ese código.");
        throw e;
      }
      await tx.taxRate.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, taxCodeId: id, rate: input.rate.rate, validFrom: dateOnly(input.rate.validFrom) } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "tax.code_created", entityType: "tax_code", entityId: id, actorUserId: ctx.auth.userId, after: { code: input.code, rate: input.rate.rate } });
      return this.codeSummary(ctx, tx, id);
    });
  }

  async updateCode(ctx: RequestContext, id: string, patch: TaxCodePatch): Promise<TaxCodeSummary> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      if (!(await tx.taxCode.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Tributo");
      await tx.taxCode.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.jurisdiction !== undefined ? { jurisdiction: patch.jurisdiction } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "tax.code_updated", entityType: "tax_code", entityId: id, actorUserId: ctx.auth.userId, after: patch });
      return this.codeSummary(ctx, tx, id);
    });
  }

  /** Nueva tasa desde `validFrom`: cierra la anterior el día previo. Los cálculos históricos no cambian. */
  async addRate(ctx: RequestContext, codeId: string, input: { rate: number; validFrom: string }): Promise<TaxCodeSummary> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      if (!(await tx.taxCode.findUnique({ where: { id: codeId }, select: { id: true } }))) throw notFound("Tributo");
      const from = dateOnly(input.validFrom);
      const last = await tx.taxRate.findFirst({ where: { taxCodeId: codeId }, orderBy: { validFrom: "desc" } });
      if (last) {
        if (from <= last.validFrom) throw conflict("RATE_OVERLAP", `La nueva tasa debe empezar después del ${dateStr(last.validFrom)} (inicio de la tasa vigente más reciente).`);
        if (last.validTo && last.validTo >= from) throw conflict("RATE_OVERLAP", "La nueva vigencia se solapa con una tasa existente.");
        if (!last.validTo) await tx.taxRate.update({ where: { id: last.id }, data: { validTo: new Date(from.getTime() - 86_400_000) } });
      }
      await tx.taxRate.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, taxCodeId: codeId, rate: input.rate, validFrom: from } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "tax.rate_added", entityType: "tax_code", entityId: codeId, actorUserId: ctx.auth.userId, after: input });
      return this.codeSummary(ctx, tx, codeId);
    });
  }

  private async codeSummary(ctx: RequestContext, tx: Tx, id: string): Promise<TaxCodeSummary> {
    const c = await tx.taxCode.findUniqueOrThrow({ where: { id }, include: { rates: { orderBy: { validFrom: "asc" } } } });
    return this.toSummary(c, await this.today(ctx));
  }

  private toSummary(
    c: { id: string; code: string; name: string; jurisdiction: string | null; status: "ACTIVE" | "INACTIVE"; rates: { rate: { toString(): string }; validFrom: Date; validTo: Date | null }[] },
    today: string,
  ): TaxCodeSummary {
    const current = c.rates.find((r) => dateStr(r.validFrom) <= today && (!r.validTo || dateStr(r.validTo) >= today));
    return {
      id: c.id, code: c.code, name: c.name, jurisdiction: c.jurisdiction, status: c.status,
      currentRate: current ? current.rate.toString() : null,
      rates: c.rates.map((r) => ({ rate: r.rate.toString(), validFrom: dateStr(r.validFrom), validTo: r.validTo ? dateStr(r.validTo) : null })),
    };
  }

  // ───────────── Perfiles fiscales ─────────────

  listProfiles(ctx: RequestContext): Promise<TaxProfileSummary[]> {
    return ctx.run(async (tx) => (await this.loadProfiles(tx)));
  }

  createProfile(ctx: RequestContext, input: TaxProfileInput): Promise<TaxProfileSummary> {
    return ctx.run(async (tx) => {
      await this.assertRules(tx, input.rules);
      const id = uuidv7();
      try {
        await tx.taxProfile.create({ data: { id, tenantId: ctx.auth.tenantId, code: input.code, name: input.name, appliesTo: input.appliesTo } });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe un perfil fiscal con ese código.");
        throw e;
      }
      await this.replaceRules(tx, ctx.auth.tenantId, id, input.rules);
      await writeAudit(tx, ctx.auth.tenantId, { action: "tax.profile_created", entityType: "tax_profile", entityId: id, actorUserId: ctx.auth.userId, after: { code: input.code, rules: input.rules.length } });
      return (await this.loadProfiles(tx, id))[0]!;
    });
  }

  updateProfile(ctx: RequestContext, id: string, patch: TaxProfilePatch): Promise<TaxProfileSummary> {
    return ctx.run(async (tx) => {
      if (!(await tx.taxProfile.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Perfil fiscal");
      if (patch.rules) await this.assertRules(tx, patch.rules);
      await tx.taxProfile.update({ where: { id }, data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) } });
      if (patch.rules) await this.replaceRules(tx, ctx.auth.tenantId, id, patch.rules);
      await writeAudit(tx, ctx.auth.tenantId, { action: "tax.profile_updated", entityType: "tax_profile", entityId: id, actorUserId: ctx.auth.userId, after: { name: patch.name, status: patch.status, rules: patch.rules?.length } });
      return (await this.loadProfiles(tx, id))[0]!;
    });
  }

  private async assertRules(tx: Tx, rules: TaxProfileInput["rules"]): Promise<void> {
    const ids = rules.map((r) => r.taxCodeId);
    if (new Set(ids).size !== ids.length) throw badRequest("RULE_DUPLICATE", "Un tributo solo puede aparecer una vez en el perfil.");
    if (ids.length && (await tx.taxCode.count({ where: { id: { in: ids } } })) !== ids.length) throw notFound("Tributo de la regla");
    for (const r of rules) {
      if (r.validFrom && r.validTo && r.validTo < r.validFrom) throw badRequest("RULE_VALIDITY", "La vigencia final de una regla no puede ser anterior a la inicial.");
    }
  }

  private async replaceRules(tx: Tx, tenantId: string, profileId: string, rules: TaxProfileInput["rules"]): Promise<void> {
    await tx.taxRule.deleteMany({ where: { taxProfileId: profileId } });
    if (rules.length) {
      await tx.taxRule.createMany({
        data: rules.map((r) => ({
          id: uuidv7(), tenantId, taxProfileId: profileId, taxCodeId: r.taxCodeId, priority: r.priority,
          exemptionReason: r.exemptionReason || null,
          validFrom: r.validFrom ? dateOnly(r.validFrom) : null, validTo: r.validTo ? dateOnly(r.validTo) : null,
        })),
      });
    }
  }

  private async loadProfiles(tx: Tx, id?: string): Promise<TaxProfileSummary[]> {
    const rows = await tx.taxProfile.findMany({
      where: id ? { id } : {}, orderBy: { code: "asc" },
      include: { rules: { orderBy: [{ priority: "asc" }], include: { taxCode: { select: { code: true } } } }, _count: { select: { products: true } } },
    });
    return rows.map((p) => ({
      id: p.id, code: p.code, name: p.name, appliesTo: p.appliesTo, status: p.status, products: p._count.products,
      rules: p.rules.map((r) => ({
        taxCodeId: r.taxCodeId, taxCode: r.taxCode.code, priority: r.priority, exemptionReason: r.exemptionReason,
        validFrom: r.validFrom ? dateStr(r.validFrom) : null, validTo: r.validTo ? dateStr(r.validTo) : null,
      })),
    }));
  }

  // ───────────── Resolución (capa 2 → cálculo) ─────────────

  /**
   * Tributos que aplican a un producto en una fecha: reglas vigentes de su perfil, con la tasa
   * vigente de cada tributo. Un tributo no exento sin tasa vigente impide cotizar (no se asume 0).
   */
  async resolveForProduct(tx: Tx, taxProfileId: string | null, at: string): Promise<TaxInput[]> {
    if (!taxProfileId) return [];
    const day = dateOnly(at);
    const rules = await tx.taxRule.findMany({
      where: {
        taxProfileId,
        AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: day } }] }, { OR: [{ validTo: null }, { validTo: { gte: day } }] }],
        taxCode: { status: "ACTIVE" },
      },
      orderBy: [{ priority: "asc" }, { taxCode: { code: "asc" } }],
      include: { taxCode: { include: { rates: true } } },
    });
    return rules.map((r) => {
      const rate = r.taxCode.rates.find((x) => dateStr(x.validFrom) <= at && (!x.validTo || dateStr(x.validTo) >= at));
      if (!rate && !r.exemptionReason) {
        throw conflict("NO_TAX_RATE", `El tributo ${r.taxCode.code} no tiene una tasa vigente el ${at}.`);
      }
      return { code: r.taxCode.code, rate: rate?.rate.toString() ?? "0", exempt: !!r.exemptionReason, exemptionReason: r.exemptionReason };
    });
  }
}
