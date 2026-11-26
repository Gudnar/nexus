import { Inject, Injectable } from "@nestjs/common";
import { AppConfig } from "../config";
import { DB, type Db } from "../db";
import { sha256, SecretBox } from "./crypto";
import { isRecoveryCode, normalizeRecoveryCode, verifyTotp } from "./totp";

/** Verificación del segundo factor (TOTP o código de recuperación) y cifrado de secretos. */
@Injectable()
export class SecondFactorService {
  private readonly box: SecretBox;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AppConfig) config: AppConfig,
  ) {
    this.box = new SecretBox(config.mfaEncryptionKey);
  }

  encrypt(secret: string): string {
    return this.box.encrypt(secret);
  }

  decrypt(payload: string): string {
    return this.box.decrypt(payload);
  }

  /**
   * true si `code` es un TOTP válido del usuario o un código de recuperación sin usar
   * (que queda consumido). Con MFA desactivado siempre es false.
   */
  async verify(user: { id: string; mfaEnabled: boolean; totpSecret: string | null }, code: string): Promise<boolean> {
    if (!user.mfaEnabled || !user.totpSecret) return false;
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) return verifyTotp(this.decrypt(user.totpSecret), trimmed);
    if (!isRecoveryCode(trimmed)) return false;
    const used = await this.db.mfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: sha256(normalizeRecoveryCode(trimmed)), usedAt: null },
      data: { usedAt: new Date() },
    });
    return used.count === 1;
  }
}
