import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { LoginRequest, MfaChallengeResponse, TokenResponse } from "@erp/contracts";
import { assertUuid, uuidv7, withTenant, withUserContext, writeAudit } from "@erp/db";
import { AppConfig } from "../config";
import { AccessScheduleService } from "../access/access-schedule.service";
import { DB, type Db } from "../db";
import { RateLimiter } from "../security/rate-limiter";
import { SecondFactorService } from "../security/second-factor.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export type LoginResult = TokenResponse | MfaChallengeResponse;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const invalid = () => new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Credenciales inválidas" });
const invalidSession = () => new UnauthorizedException({ code: "INVALID_SESSION", message: "Sesión inválida o expirada" });
const invalidMfa = () => new UnauthorizedException({ code: "INVALID_MFA_CODE", message: "Código de verificación inválido" });

/** Busca por correo si el identificador contiene "@"; si no, por username (ya normalizados). */
export const whereIdentifier = (identifier: string) =>
  identifier.includes("@") ? { email: identifier } : { username: identifier };

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(SecondFactorService) private readonly secondFactor: SecondFactorService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(AccessScheduleService) private readonly schedules: AccessScheduleService,
  ) {}

  async login(input: LoginRequest, meta: ClientMeta): Promise<LoginResult> {
    this.limiter.consume(`login:ip:${meta.ip ?? "?"}`, this.config.loginRatePerMin, 60_000);

    const user = await this.db.user.findUnique({ where: whereIdentifier(input.identifier) });
    const locked = !!user?.lockedUntil && user.lockedUntil > new Date();
    if (!user || !user.active || locked) {
      await this.passwords.verifyDummy(input.password);
      throw invalid(); // misma respuesta: no revela si existe, está bloqueado o inactivo
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      await this.registerFailure(user.id);
      throw invalid();
    }

    // Membresías propias: contexto de usuario (sin tenant), solo lectura.
    const memberships = await withUserContext(this.db, user.id, (tx) =>
      tx.membership.findMany({
        where: { status: "ACTIVE", tenant: { status: { in: ["ACTIVE", "TRIAL"] } } },
        include: { tenant: { select: { slug: true, legalName: true } } },
      }),
    );
    const chosen = input.tenant
      ? memberships.find((m) => m.tenant.slug === input.tenant)
      : memberships.length === 1
        ? memberships[0]
        : undefined;

    if (!chosen) {
      if (!input.tenant && memberships.length > 1) {
        throw new UnauthorizedException({
          code: "TENANT_REQUIRED",
          message: "Indique el tenant",
          tenants: memberships.map((m) => ({ slug: m.tenant.slug, name: m.tenant.legalName })),
        });
      }
      throw invalid();
    }

    if (user.mfaEnabled) {
      // La contraseña es correcta pero el contador de fallos se conserva hasta completar el 2.º factor.
      const mfaToken = await this.tokens.signMfa({ userId: user.id, tenantId: chosen.tenantId, membershipId: chosen.id });
      return { mfaRequired: true, mfaToken, expiresIn: this.tokens.mfaTtl };
    }
    return this.completeLogin(user, chosen.tenantId, chosen.id, meta);
  }

  /** Segundo paso del login con MFA: TOTP o código de recuperación. */
  async verifyMfa(mfaToken: string, code: string, meta: ClientMeta): Promise<TokenResponse> {
    const claims = await this.tokens.verifyMfa(mfaToken);
    if (!claims) throw invalidMfa();
    this.limiter.consume(`mfa:${claims.userId}`, 5, 5 * 60_000);

    const user = await this.db.user.findUnique({ where: { id: claims.userId } });
    if (!user || !user.active || (user.lockedUntil && user.lockedUntil > new Date())) throw invalidMfa();
    if (!(await this.secondFactor.verify(user, code))) {
      await this.registerFailure(user.id);
      throw invalidMfa();
    }

    // La membresía debe seguir activa entre ambos pasos.
    const stillActive = await withUserContext(this.db, user.id, (tx) =>
      tx.membership.findFirst({
        where: { id: claims.membershipId, tenantId: claims.tenantId, status: "ACTIVE", tenant: { status: { in: ["ACTIVE", "TRIAL"] } } },
        select: { id: true },
      }),
    );
    if (!stillActive) throw invalid();
    return this.completeLogin(user, claims.tenantId, claims.membershipId, meta, true);
  }

  private async completeLogin(
    user: { id: string; failedLogins: number; lockedUntil: Date | null },
    tenantId: string,
    membershipId: string,
    meta: ClientMeta,
    mfa = false,
  ): Promise<TokenResponse> {
    await this.schedules.assertAllowed(tenantId, membershipId); // fuera de horario: no se emite sesión
    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    const session = await this.createSession(user.id, tenantId, membershipId, meta);
    await withTenant(this.db, tenantId, (tx) =>
      writeAudit(tx, tenantId, {
        action: "auth.login", entityType: "session", entityId: session.sessionId,
        actorUserId: user.id, ip: meta.ip, after: { mfa },
      }),
    );
    return session.response;
  }

  /** Refresh rotativo con detección de reutilización (ADR / plan §5.1). */
  async refresh(refreshToken: string, meta: ClientMeta): Promise<TokenResponse> {
    const [sessionId, secret, ...rest] = refreshToken.split(".");
    if (!sessionId || !secret || rest.length) throw invalidSession();
    try {
      assertUuid(sessionId, "sessionId");
    } catch {
      throw invalidSession();
    }

    const session = await this.db.session.findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.tenantId) throw invalidSession();

    const presented = Buffer.from(sha256(secret), "hex");
    const stored = Buffer.from(session.refreshTokenHash, "hex");
    const matches = presented.length === stored.length && timingSafeEqual(presented, stored);
    if (!matches) return this.reuseDetected(session.userId);

    const membership = await withUserContext(this.db, session.userId, (tx) =>
      tx.membership.findFirst({
        where: { tenantId: session.tenantId!, status: "ACTIVE", tenant: { status: { in: ["ACTIVE", "TRIAL"] } } },
        select: { id: true },
      }),
    );
    if (!membership) {
      await this.db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw invalidSession();
    }

    await this.schedules.assertAllowed(session.tenantId, membership.id);

    // Rotación atómica: solo prospera si el hash sigue siendo el presentado.
    const newSecret = randomBytes(32).toString("base64url");
    const rotated = await this.db.session.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
      data: { refreshTokenHash: sha256(newSecret), ip: meta.ip ?? session.ip, userAgent: meta.userAgent ?? session.userAgent },
    });
    if (rotated.count !== 1) return this.reuseDetected(session.userId);

    const accessToken = await this.tokens.sign({
      userId: session.userId, tenantId: session.tenantId, membershipId: membership.id, sessionId: session.id,
    });
    return {
      tokenType: "Bearer",
      accessToken,
      refreshToken: `${session.id}.${newSecret}`,
      expiresIn: this.config.accessTtl,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Cierra todas las sesiones del usuario, salvo (opcional) la actual. */
  async revokeSessions(userId: string, exceptSessionId?: string): Promise<void> {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  private async reuseDetected(userId: string): Promise<never> {
    // Token ya rotado o robado: se revocan todas las sesiones del usuario.
    await this.revokeSessions(userId);
    throw invalidSession();
  }

  /** Cuenta un fallo (contraseña o MFA) y aplica bloqueo progresivo: 1, 2, 4 ... 60 min. */
  async registerFailure(userId: string): Promise<void> {
    const { failedLogins } = await this.db.user.update({
      where: { id: userId },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    const over = failedLogins - this.config.loginMaxFailures;
    if (over >= 0) {
      const minutes = Math.min(60, 2 ** over);
      await this.db.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + minutes * 60_000) } });
    }
  }

  private async createSession(userId: string, tenantId: string, membershipId: string, meta: ClientMeta) {
    const sessionId = uuidv7();
    const secret = randomBytes(32).toString("base64url");
    await this.db.session.create({
      data: {
        id: sessionId, userId, tenantId, refreshTokenHash: sha256(secret),
        ip: meta.ip, userAgent: meta.userAgent?.slice(0, 255),
        expiresAt: new Date(Date.now() + this.config.refreshTtl * 1000),
      },
    });
    const accessToken = await this.tokens.sign({ userId, tenantId, membershipId, sessionId });
    const response: TokenResponse = {
      tokenType: "Bearer", accessToken, refreshToken: `${sessionId}.${secret}`, expiresIn: this.config.accessTtl,
    };
    return { sessionId, response };
  }
}
