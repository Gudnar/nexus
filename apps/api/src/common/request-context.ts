import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { BRANCH_HEADER } from "@erp/contracts";
import {
  ALL_BRANCHES, resolveBranchScope, withTenant,
  type BranchAccessLevel, type BranchScope, type Db, type Tx,
} from "@erp/db";
import type { AuthClaims } from "../auth/token.service";

export interface BranchScopeOptions {
  minLevel?: BranchAccessLevel;
  /** Permite la sucursal "ALL" (consultas de lectura autorizadas). */
  allowAll?: boolean;
  /** Si no llega cabecera: true = "ALL", false = sucursal por defecto de la membresía. */
  defaultToAll?: boolean;
}

/**
 * TenantContext + BranchContext de una petición. El tenant sale del JWT validado (nunca
 * del cliente); la sucursal se valida SIEMPRE contra el acceso de la membresía.
 */
type TenantInfo = { slug: string; legalName: string; timezone: string; planLimits: Record<string, number> | null };

export class RequestContext {
  private perms?: Set<string>;

  constructor(
    private readonly db: Db,
    readonly auth: AuthClaims,
    private readonly headers: Record<string, string | string[] | undefined>,
  ) {}

  /** Datos globales de la empresa (tabla de plataforma, fuera de RLS) y límites de su plan. */
  tenantInfo(): Promise<TenantInfo> {
    return (this.info ??= this.loadTenantInfo());
  }

  private info?: Promise<TenantInfo>;
  private async loadTenantInfo(): Promise<TenantInfo> {
    const t = await this.db.tenant.findUniqueOrThrow({
      where: { id: this.auth.tenantId },
      select: { slug: true, legalName: true, timezone: true, plan: { select: { limits: true } } },
    });
    return { slug: t.slug, legalName: t.legalName, timezone: t.timezone, planLimits: (t.plan?.limits ?? null) as Record<string, number> | null };
  }

  /** Única vía de acceso a tablas tenant-scoped: transacción con RLS activo. */
  run<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    return withTenant(this.db, this.auth.tenantId, fn, opts);
  }

  /** Permisos efectivos de la membresía (unión de sus roles). Falla si ya no está activa. */
  async permissions(): Promise<Set<string>> {
    if (this.perms) return this.perms;
    const m = await this.run((tx) =>
      tx.membership.findUnique({
        where: { id: this.auth.membershipId },
        select: {
          status: true,
          roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } },
        },
      }),
    );
    if (!m || m.status !== "ACTIVE") {
      throw new UnauthorizedException({ code: "INVALID_SESSION", message: "Membresía inactiva" });
    }
    this.perms = new Set(m.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)));
    return this.perms;
  }

  /** Valida la sucursal pedida en la cabecera X-Branch-Id (UUID o "ALL"). Dentro de `run`. */
  async branchScope(tx: Tx, opts: BranchScopeOptions = {}): Promise<BranchScope> {
    const raw = this.headers[BRANCH_HEADER];
    const header = Array.isArray(raw) ? raw[0] : raw;
    let requested: string;
    if (header) {
      requested = header.toUpperCase() === ALL_BRANCHES ? ALL_BRANCHES : header;
    } else if (opts.defaultToAll) {
      requested = ALL_BRANCHES;
    } else {
      const m = await tx.membership.findUnique({
        where: { id: this.auth.membershipId },
        select: { defaultBranchId: true },
      });
      if (!m?.defaultBranchId) {
        throw new BadRequestException({ code: "BRANCH_REQUIRED", message: `Indique la sucursal en la cabecera ${BRANCH_HEADER}` });
      }
      requested = m.defaultBranchId;
    }
    try {
      return await resolveBranchScope(tx, this.auth.membershipId, requested, opts);
    } catch (e) {
      if (e instanceof Error && e.message.endsWith("inválido")) {
        throw new BadRequestException({ code: "INVALID_BRANCH", message: "Sucursal inválida" });
      }
      throw e;
    }
  }
}
