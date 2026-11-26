import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { MfaEnableResponse, MfaSetupResponse } from "@erp/contracts";
import { uuidv7 } from "@erp/db";
import QRCode from "qrcode";
import { PasswordService } from "../auth/password.service";
import { DB, type Db } from "../db";
import { sha256 } from "../security/crypto";
import { RateLimiter } from "../security/rate-limiter";
import { SecondFactorService } from "../security/second-factor.service";
import { generateRecoveryCode, generateSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from "../security/totp";

const ISSUER = "NEXUS ERP";
const RECOVERY_CODES = 10;

const wrongPassword = () => new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Contraseña incorrecta" });
const wrongCode = () => new UnauthorizedException({ code: "INVALID_MFA_CODE", message: "Código de verificación inválido" });

/** Alta, baja y recuperación del MFA TOTP de la cuenta autenticada. */
@Injectable()
export class MfaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SecondFactorService) private readonly second: SecondFactorService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  private async user(userId: string) {
    return this.db.user.findUniqueOrThrow({ where: { id: userId } });
  }

  private async requirePassword(userId: string, password: string) {
    this.limiter.consume(`reauth:${userId}`, 8, 5 * 60_000); // evita adivinar la contraseña con un token robado
    const user = await this.user(userId);
    if (!(await this.passwords.verify(user.passwordHash, password))) throw wrongPassword();
    return user;
  }

  /** Paso 1: genera un secreto pendiente (aún no activo) y el QR para la app autenticadora. */
  async beginSetup(userId: string, password: string): Promise<MfaSetupResponse> {
    const user = await this.requirePassword(userId, password);
    if (user.mfaEnabled) throw new ConflictException({ code: "MFA_ALREADY_ENABLED", message: "El MFA ya está activado" });
    const secret = generateSecret();
    await this.db.user.update({ where: { id: userId }, data: { mfaPendingSecret: this.second.encrypt(secret) } });
    const uri = otpauthUri(ISSUER, user.email, secret);
    return { secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: "svg", margin: 1, width: 220 }) };
  }

  /** Paso 2: confirma con un código de la app. Activa el MFA y entrega los códigos de recuperación (una sola vez). */
  async enable(userId: string, code: string): Promise<MfaEnableResponse> {
    this.limiter.consume(`mfa-enable:${userId}`, 8, 5 * 60_000);
    const user = await this.user(userId);
    if (user.mfaEnabled) throw new ConflictException({ code: "MFA_ALREADY_ENABLED", message: "El MFA ya está activado" });
    if (!user.mfaPendingSecret) {
      throw new BadRequestException({ code: "MFA_SETUP_REQUIRED", message: "Primero inicia la configuración del MFA" });
    }
    const secret = this.second.decrypt(user.mfaPendingSecret);
    if (!verifyTotp(secret, code.trim())) throw wrongCode();

    const codes = Array.from({ length: RECOVERY_CODES }, generateRecoveryCode);
    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { mfaEnabled: true, totpSecret: user.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date() },
      }),
      this.db.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.db.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ id: uuidv7(), userId, codeHash: sha256(normalizeRecoveryCode(c)) })),
      }),
    ]);
    return { recoveryCodes: codes };
  }

  async disable(userId: string, password: string, code: string): Promise<void> {
    const user = await this.requirePassword(userId, password);
    if (!user.mfaEnabled) return;
    if (!(await this.second.verify(user, code))) throw wrongCode();
    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, totpSecret: null, mfaPendingSecret: null, mfaEnabledAt: null },
      }),
      this.db.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  async regenerateRecoveryCodes(userId: string, password: string, code: string): Promise<MfaEnableResponse> {
    const user = await this.requirePassword(userId, password);
    if (!user.mfaEnabled) throw new BadRequestException({ code: "MFA_NOT_ENABLED", message: "El MFA no está activado" });
    if (!(await this.second.verify(user, code))) throw wrongCode();
    const codes = Array.from({ length: RECOVERY_CODES }, generateRecoveryCode);
    await this.db.$transaction([
      this.db.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.db.mfaRecoveryCode.createMany({
        data: codes.map((c) => ({ id: uuidv7(), userId, codeHash: sha256(normalizeRecoveryCode(c)) })),
      }),
    ]);
    return { recoveryCodes: codes };
  }
}
