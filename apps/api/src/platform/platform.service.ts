import { ServiceUnavailableException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { PlatformSettings } from "@erp/contracts";
import { AppConfig } from "../config";
import { DB, PLATFORM_DB, type Db } from "../db";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { RateLimiter } from "../security/rate-limiter";
import { SecondFactorService } from "../security/second-factor.service";
import { verifyTotp } from "../security/totp";

const invalid = () => new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Credenciales inválidas" });

/** Cliente de plataforma o 503 si el despliegue no lo configuró. */
export function requirePlatformDb(db: Db | null): Db {
  if (!db) throw new ServiceUnavailableException({ code: "PLATFORM_UNAVAILABLE", message: "La consola de plataforma no está configurada" });
  return db;
}

/** Ajustes globales de la plataforma. Los lee cualquiera; solo el administrador global los cambia. */
@Injectable()
export class PlatformSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PLATFORM_DB) private readonly platformDb: Db | null,
  ) {}

  async registrationEnabled(): Promise<boolean> {
    const row = await this.db.platformSetting.findUnique({ where: { key: "registration" } });
    return (row?.value as { enabled?: boolean } | null)?.enabled === true;
  }

  async get(): Promise<PlatformSettings> {
    return { registration: { enabled: await this.registrationEnabled() } };
  }

  async setRegistration(enabled: boolean, actorId: string): Promise<PlatformSettings> {
    const p = requirePlatformDb(this.platformDb);
    await p.platformSetting.upsert({
      where: { key: "registration" },
      update: { value: { enabled }, updatedById: actorId },
      create: { key: "registration", value: { enabled }, updatedById: actorId },
    });
    return this.get();
  }
}

/** Acceso del administrador global: credenciales propias (tabla platform_user), TOTP si lo tiene. */
@Injectable()
export class PlatformAuthService {
  constructor(
    @Inject(PLATFORM_DB) private readonly platformDb: Db | null,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SecondFactorService) private readonly second: SecondFactorService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  async login(email: string, password: string, totp: string | undefined, ip?: string) {
    const db = requirePlatformDb(this.platformDb);
    this.limiter.consume(`platform-login:ip:${ip ?? "?"}`, 10, 5 * 60_000);

    const user = await db.platformUser.findUnique({ where: { email } });
    const locked = !!user?.lockedUntil && user.lockedUntil > new Date();
    if (!user || !user.active || locked) {
      await this.passwords.verifyDummy(password);
      throw invalid();
    }
    let ok = await this.passwords.verify(user.passwordHash, password);
    if (ok && user.totpSecret) ok = !!totp && verifyTotp(this.second.decrypt(user.totpSecret), totp.trim());
    if (!ok) {
      const { failedLogins } = await db.platformUser.update({
        where: { id: user.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true },
      });
      const over = failedLogins - this.config.loginMaxFailures;
      if (over >= 0) {
        await db.platformUser.update({
          where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + Math.min(60, 2 ** over) * 60_000) },
        });
      }
      throw invalid();
    }
    if (user.failedLogins > 0 || user.lockedUntil) {
      await db.platformUser.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    return {
      tokenType: "Bearer" as const,
      accessToken: await this.tokens.signPlatform(user.id),
      expiresIn: this.tokens.platformTtl,
    };
  }

  /** Datos del administrador a partir de un token ya verificado (o null si fue desactivado). */
  async find(id: string) {
    const db = requirePlatformDb(this.platformDb);
    const u = await db.platformUser.findUnique({ where: { id }, select: { id: true, email: true, role: true, active: true } });
    return u?.active ? u : null;
  }
}
