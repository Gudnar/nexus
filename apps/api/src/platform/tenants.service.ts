import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateTenantRequest, CreateTenantResult, PlatformPlanView, PlatformTenantView, UpdateTenantRequest } from "@erp/contracts";
import { provisionTenant, uuidv7, withTenant, writeAudit } from "@erp/db";
import { PasswordService } from "../auth/password.service";
import { AppConfig } from "../config";
import { PLATFORM_DB, type Db } from "../db";
import { MailService } from "../mail/mail.service";
import { newToken } from "../security/crypto";
import { requirePlatformDb } from "./platform.service";

const SETUP_TTL_H = 72;

function slugify(name: string): string {
  const s = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s || "empresa").slice(0, 40);
}

/**
 * Empresas clientes desde la consola de plataforma: alta con su administrador, plan y estado (activa, prueba, suspendida).
 * Muestra solo datos de cuenta (estado, plan, cantidad de usuarios y sucursales), nunca datos de negocio de la empresa.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    @Inject(PLATFORM_DB) private readonly platformDb: Db | null,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  async plans(): Promise<PlatformPlanView[]> {
    const rows = await requirePlatformDb(this.platformDb).plan.findMany({ orderBy: { code: "asc" } });
    return rows.map((p) => ({ code: p.code, name: p.name, limits: (p.limits ?? {}) as Record<string, number> }));
  }

  async list(): Promise<PlatformTenantView[]> {
    const db = requirePlatformDb(this.platformDb);
    const rows = await db.tenant.findMany({ orderBy: { createdAt: "desc" }, include: { plan: { select: { code: true, name: true } } } });
    return Promise.all(rows.map((t) => this.view(db, t)));
  }

  private async view(db: Db, t: { id: string; slug: string; legalName: string; taxId: string | null; status: string; createdAt: Date; plan: { code: string; name: string } | null }): Promise<PlatformTenantView> {
    // Los conteos pasan por RLS: se consultan en el contexto de cada empresa.
    const [users, branches] = await withTenant(db, t.id, (tx) => Promise.all([tx.membership.count({ where: { status: "ACTIVE" } }), tx.branch.count()]));
    return { id: t.id, slug: t.slug, legalName: t.legalName, taxId: t.taxId, status: t.status as PlatformTenantView["status"], plan: t.plan, createdAt: t.createdAt.toISOString(), users, branches };
  }

  async create(input: CreateTenantRequest, platformUserId: string): Promise<CreateTenantResult> {
    const db = requirePlatformDb(this.platformDb);
    const plan = await db.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) throw new BadRequestException({ code: "PLAN_UNKNOWN", message: "El plan elegido no existe." });
    if (input.adminUsername && (await db.user.findUnique({ where: { username: input.adminUsername }, select: { id: true } }))) {
      throw new ConflictException({ code: "USERNAME_TAKEN", message: "Ese usuario ya está en uso." });
    }
    const existing = await db.user.findUnique({ where: { email: input.adminEmail }, select: { id: true } });

    let slug = slugify(input.companyName);
    for (let i = 2; await db.tenant.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${slugify(input.companyName).slice(0, 34)}-${i}`;

    // Sin contraseña conocida: el administrador la fija con un enlace de un solo uso. Quien ya tiene cuenta entra con la suya.
    const passwordHash = await this.passwords.hash(randomBytes(32).toString("hex"));
    const p = await provisionTenant(db, {
      slug, legalName: input.companyName, taxId: input.taxId || undefined, mainBranch: { code: "CEN", name: "Sucursal Central" },
      admin: { email: input.adminEmail, name: input.adminName, passwordHash, username: existing ? undefined : input.adminUsername, emailVerified: true },
      status: input.status, planCode: plan.code,
    });

    let setupUrl: string | null = null;
    let emailSent = false;
    if (!existing) {
      const { token, hash } = newToken();
      await db.oneTimeToken.create({ data: { id: uuidv7(), userId: p.userId, purpose: "PASSWORD_RESET", tokenHash: hash, expiresAt: new Date(Date.now() + SETUP_TTL_H * 3_600_000) } });
      setupUrl = `${this.config.appPublicUrl}/reset-password?token=${token}`;
      emailSent = await this.mail.sendCompanyCreated(input.adminEmail, input.adminName, input.companyName, setupUrl, SETUP_TTL_H).then(() => true, () => false);
    } else {
      emailSent = await this.mail.sendCompanyAdded(input.adminEmail, input.adminName, input.companyName, `${this.config.appPublicUrl}/login`).then(() => true, () => false);
    }
    await withTenant(db, p.tenantId, (tx) => writeAudit(tx, p.tenantId, { action: "platform.tenant_created", entityType: "tenant", entityId: p.tenantId, after: { plan: plan.code, status: input.status, platformUserId } }));
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: p.tenantId }, include: { plan: { select: { code: true, name: true } } } });
    return { tenant: await this.view(db, tenant), setupUrl, adminAlreadyExisted: !!existing, emailSent };
  }

  async update(id: string, input: UpdateTenantRequest, platformUserId: string): Promise<PlatformTenantView> {
    const db = requirePlatformDb(this.platformDb);
    const cur = await db.tenant.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException({ code: "NOT_FOUND", message: "Empresa no encontrada" });
    if (cur.status === "CANCELLED") throw new ConflictException({ code: "TENANT_CANCELLED", message: "La empresa está cancelada." });
    let planId: string | undefined;
    if (input.planCode) {
      const plan = await db.plan.findUnique({ where: { code: input.planCode }, select: { id: true } });
      if (!plan) throw new BadRequestException({ code: "PLAN_UNKNOWN", message: "El plan elegido no existe." });
      planId = plan.id;
    }
    await db.tenant.update({ where: { id }, data: { ...(input.status ? { status: input.status } : {}), ...(planId ? { planId } : {}) } });
    // Al suspender se cierran las sesiones abiertas de esa empresa.
    if (input.status === "SUSPENDED") await db.session.updateMany({ where: { tenantId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await withTenant(db, id, (tx) => writeAudit(tx, id, { action: "platform.tenant_updated", entityType: "tenant", entityId: id, before: { status: cur.status }, after: { status: input.status ?? cur.status, planCode: input.planCode ?? null, platformUserId } }));
    const t = await db.tenant.findUniqueOrThrow({ where: { id }, include: { plan: { select: { code: true, name: true } } } });
    return this.view(db, t);
  }
}
