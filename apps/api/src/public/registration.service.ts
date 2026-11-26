import { ConflictException, ForbiddenException, Inject, Injectable, BadRequestException } from "@nestjs/common";
import type { RegisterRequest } from "@erp/contracts";
import { provisionTenant, uuidv7 } from "@erp/db";
import { PasswordService } from "../auth/password.service";
import type { ClientMeta } from "../auth/auth.service";
import { AppConfig } from "../config";
import { DB, PLATFORM_DB, type Db } from "../db";
import { MailService } from "../mail/mail.service";
import { PlatformSettingsService, requirePlatformDb } from "../platform/platform.service";
import { newToken, sha256 } from "../security/crypto";
import { assertPasswordPolicy } from "../security/password-policy";
import { RateLimiter } from "../security/rate-limiter";

const disabled = () =>
  new ForbiddenException({ code: "REGISTRATION_DISABLED", message: "El registro de nuevas empresas no está habilitado" });

function slugify(name: string): string {
  const s = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (s || "empresa").slice(0, 40);
}

/**
 * Registro autoservicio de una empresa nueva. Solo existe si el administrador global lo
 * habilita. No crea nada hasta que se confirma el correo: antes solo queda una solicitud
 * pendiente (con el hash de la contraseña) que vence sola.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PLATFORM_DB) private readonly platformDb: Db | null,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /** Respuesta uniforme: no revela si el correo ya tiene cuenta (se le avisa por correo). */
  async request(input: RegisterRequest, meta: ClientMeta): Promise<void> {
    const platform = requirePlatformDb(this.platformDb);
    if (!(await this.settings.registrationEnabled())) throw disabled();
    this.limiter.consume(`register:ip:${meta.ip ?? "?"}`, 5, 3_600_000);
    this.limiter.consume(`register:email:${input.email}`, 3, 3_600_000);
    assertPasswordPolicy(input.password, { email: input.email, username: input.username });

    if (input.username) {
      const taken =
        (await this.db.user.findUnique({ where: { username: input.username }, select: { id: true } })) ||
        (await platform.registrationRequest.findFirst({
          where: { username: input.username, consumedAt: null, expiresAt: { gt: new Date() }, NOT: { email: input.email } },
          select: { id: true },
        }));
      if (taken) throw new ConflictException({ code: "USERNAME_TAKEN", message: "Ese usuario ya está en uso" });
    }

    if (await this.db.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
      void this.mail
        .sendAlreadyRegistered(input.email, `${this.config.appPublicUrl}/login`, `${this.config.appPublicUrl}/forgot-password`)
        .catch(() => undefined);
      return;
    }

    await platform.registrationRequest.deleteMany({ where: { email: input.email, consumedAt: null } });
    const { token, hash } = newToken();
    await platform.registrationRequest.create({
      data: {
        id: uuidv7(), email: input.email, username: input.username ?? null, companyName: input.companyName,
        taxId: input.taxId || null, adminName: input.adminName,
        passwordHash: await this.passwords.hash(input.password), tokenHash: hash,
        expiresAt: new Date(Date.now() + this.config.verifyTokenTtlH * 3_600_000), ip: meta.ip,
      },
    });
    const url = `${this.config.appPublicUrl}/verify-email?token=${token}`;
    await this.mail.sendRegistrationVerification(input.email, input.adminName, url, this.config.verifyTokenTtlH).catch(() => undefined);
  }

  /** Confirma el correo y crea la empresa (TRIAL) con su administrador. */
  async verify(token: string, meta: ClientMeta): Promise<{ email: string; tenant: string }> {
    const platform = requirePlatformDb(this.platformDb);
    this.limiter.consume(`register-verify:ip:${meta.ip ?? "?"}`, 20, 15 * 60_000);
    const invalid = () => new BadRequestException({ code: "INVALID_TOKEN", message: "El enlace no es válido o ya venció" });

    const row = await platform.registrationRequest.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.consumedAt || row.expiresAt <= new Date()) throw invalid();
    if (!(await this.settings.registrationEnabled())) throw disabled();

    // Consumo atómico, y se descarta el hash de la contraseña de la solicitud.
    const consumed = await platform.registrationRequest.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date(), passwordHash: "-" },
    });
    if (consumed.count !== 1) throw invalid();

    const clash = await this.db.user.findFirst({
      where: { OR: [{ email: row.email }, ...(row.username ? [{ username: row.username }] : [])] },
      select: { id: true },
    });
    if (clash) throw new ConflictException({ code: "ACCOUNT_EXISTS", message: "Ya existe una cuenta con esos datos" });

    let slug = slugify(row.companyName);
    for (let i = 2; await platform.tenant.findUnique({ where: { slug }, select: { id: true } }); i++) {
      slug = `${slugify(row.companyName).slice(0, 34)}-${i}`;
    }
    await provisionTenant(platform, {
      slug, legalName: row.companyName, taxId: row.taxId ?? undefined,
      mainBranch: { code: "CEN", name: "Sucursal Central" },
      admin: { email: row.email, name: row.adminName, passwordHash: row.passwordHash, username: row.username ?? undefined, emailVerified: true },
      status: "TRIAL", planCode: "base",
    });
    return { email: row.email, tenant: slug };
  }
}
