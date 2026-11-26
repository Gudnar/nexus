import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { SecurityOverview, UpdateProfileRequest } from "@erp/contracts";
import { AuthService } from "../auth/auth.service";
import { PasswordService } from "../auth/password.service";
import { DB, type Db } from "../db";
import { MailService } from "../mail/mail.service";
import { assertPasswordPolicy } from "../security/password-policy";
import { RateLimiter } from "../security/rate-limiter";

@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  async overview(userId: string): Promise<SecurityOverview> {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const remaining = u.mfaEnabled
      ? await this.db.mfaRecoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    return {
      email: u.email, username: u.username, name: u.name,
      emailVerified: !!u.emailVerifiedAt,
      mfaEnabled: u.mfaEnabled, mfaEnabledAt: u.mfaEnabledAt?.toISOString() ?? null,
      recoveryCodesRemaining: remaining,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileRequest): Promise<SecurityOverview> {
    try {
      await this.db.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.username !== undefined ? { username: input.username } : {}),
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        throw new ConflictException({ code: "USERNAME_TAKEN", message: "Ese usuario ya está en uso" });
      }
      throw e;
    }
    return this.overview(userId);
  }

  /** Cambia la contraseña y cierra las demás sesiones (la actual se conserva). */
  async changePassword(userId: string, sessionId: string, current: string, next: string): Promise<void> {
    this.limiter.consume(`reauth:${userId}`, 8, 5 * 60_000);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "La contraseña actual es incorrecta" });
    }
    assertPasswordPolicy(next, { email: user.email, username: user.username });
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(next), failedLogins: 0, lockedUntil: null },
    });
    await this.auth.revokeSessions(userId, sessionId);
    void this.mail.sendPasswordChanged(user.email, user.name).catch(() => undefined);
  }

  /** Aviso por correo de que el MFA cambió (sin bloquear la operación si el envío falla). */
  async notifyMfaChanged(userId: string, enabled: boolean): Promise<void> {
    const u = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
    void this.mail.sendMfaChanged(u.email, u.name, enabled).catch(() => undefined);
  }
}
