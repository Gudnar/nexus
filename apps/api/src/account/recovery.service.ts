import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { RecoveryChannel } from "@erp/contracts";
import { uuidv7, withTenant, withUserContext, writeAudit } from "@erp/db";
import { AuthService, whereIdentifier, type ClientMeta } from "../auth/auth.service";
import { PasswordService } from "../auth/password.service";
import { AppConfig } from "../config";
import { DB, type Db } from "../db";
import { MailService } from "../mail/mail.service";
import { newToken, sha256 } from "../security/crypto";
import { assertPasswordPolicy } from "../security/password-policy";
import { RateLimiter } from "../security/rate-limiter";
import { SecondFactorService } from "../security/second-factor.service";

/** Canal de entrega del enlace de recuperación. EMAIL funciona; SMS y WhatsApp se conectan vía integraciones. */
export interface RecoverySender {
  readonly channel: RecoveryChannel;
  available(): boolean;
  send(user: { email: string; name: string; phone: string | null }, url: string, minutes: number): Promise<void>;
}

@Injectable()
export class RecoveryChannels {
  private readonly senders: RecoverySender[];

  constructor(@Inject(MailService) mail: MailService) {
    this.senders = [
      {
        channel: "EMAIL",
        available: () => true,
        send: (u, url, minutes) => mail.sendPasswordReset(u.email, u.name, url, minutes),
      },
      // SMS y WhatsApp: se habilitarán al registrar un proveedor (plan §17, adaptadores de integración).
    ];
  }

  available(): RecoveryChannel[] {
    return this.senders.filter((s) => s.available()).map((s) => s.channel);
  }

  get(channel: RecoveryChannel): RecoverySender | undefined {
    return this.senders.find((s) => s.channel === channel && s.available());
  }
}

@Injectable()
export class RecoveryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(RecoveryChannels) private readonly channels: RecoveryChannels,
    @Inject(SecondFactorService) private readonly second: SecondFactorService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  /**
   * Solicita el restablecimiento. La respuesta es SIEMPRE la misma (exista o no la cuenta)
   * para no permitir enumerar usuarios; solo se rechaza un canal no disponible, que depende
   * de la configuración del despliegue y no de la cuenta.
   */
  async forgot(identifier: string, channel: RecoveryChannel, meta: ClientMeta): Promise<void> {
    this.limiter.consume(`forgot:ip:${meta.ip ?? "?"}`, 10, 15 * 60_000);
    this.limiter.consume(`forgot:id:${identifier}`, 3, 15 * 60_000);

    const sender = this.channels.get(channel);
    if (!sender) {
      throw new BadRequestException({ code: "CHANNEL_UNAVAILABLE", message: "Ese canal de recuperación no está disponible" });
    }
    const user = await this.db.user.findUnique({ where: whereIdentifier(identifier) });
    if (!user || !user.active) return;
    if (channel !== "EMAIL" && !user.phone) return;

    const recent = await this.db.oneTimeToken.count({
      where: { userId: user.id, purpose: "PASSWORD_RESET", createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= 3) return; // límite por cuenta: no se bombardea al usuario con correos

    const { token, hash } = newToken();
    await this.db.oneTimeToken.create({
      data: {
        id: uuidv7(), userId: user.id, purpose: "PASSWORD_RESET", channel, tokenHash: hash,
        expiresAt: new Date(Date.now() + this.config.resetTokenTtlMin * 60_000), ip: meta.ip,
      },
    });
    const url = `${this.config.appPublicUrl}/reset-password?token=${token}`;
    await sender.send(user, url, this.config.resetTokenTtlMin).catch(() => undefined);
  }

  async reset(token: string, password: string, mfaCode: string | undefined, meta: ClientMeta): Promise<void> {
    this.limiter.consume(`reset:ip:${meta.ip ?? "?"}`, 20, 15 * 60_000);
    const hash = sha256(token);
    const row = await this.db.oneTimeToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    const invalid = () => new BadRequestException({ code: "INVALID_TOKEN", message: "El enlace no es válido o ya venció" });
    if (!row || row.purpose !== "PASSWORD_RESET" || row.usedAt || row.expiresAt <= new Date() || !row.user.active) throw invalid();
    const user = row.user;

    // Con MFA activo, el enlace por sí solo no basta. No se consume el token si falta el código.
    if (user.mfaEnabled) {
      if (!mfaCode) {
        throw new UnauthorizedException({ code: "MFA_REQUIRED", message: "Ingresa tu código de verificación" });
      }
      this.limiter.consume(`mfa:${user.id}`, 5, 5 * 60_000);
      if (!(await this.second.verify(user, mfaCode))) {
        await this.auth.registerFailure(user.id);
        throw new UnauthorizedException({ code: "INVALID_MFA_CODE", message: "Código de verificación inválido" });
      }
    }
    assertPasswordPolicy(password, { email: user.email, username: user.username });

    // Consumo atómico: un enlace solo puede usarse una vez, aunque lleguen dos peticiones a la vez.
    const consumed = await this.db.oneTimeToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count !== 1) throw invalid();

    await this.db.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(password), failedLogins: 0, lockedUntil: null },
    });
    await this.db.oneTimeToken.updateMany({
      where: { userId: user.id, purpose: "PASSWORD_RESET", usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.auth.revokeSessions(user.id);

    // Auditoría en cada empresa donde el usuario tiene membresía.
    const memberships = await withUserContext(this.db, user.id, (tx) => tx.membership.findMany({ select: { tenantId: true } }));
    for (const m of memberships) {
      await withTenant(this.db, m.tenantId, (tx) =>
        writeAudit(tx, m.tenantId, {
          action: "auth.password_reset", entityType: "user", entityId: user.id,
          actorUserId: user.id, ip: meta.ip, after: { channel: row.channel },
        }),
      );
    }
    void this.mail.sendPasswordChanged(user.email, user.name).catch(() => undefined);
  }
}
