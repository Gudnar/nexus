import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifrado de secretos en reposo (secretos TOTP) con AES-256-GCM.
 * Formato: v1.<iv>.<tag>.<texto cifrado>, todo en base64url.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(secret).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
  }

  decrypt(payload: string): string {
    const [v, iv, tag, ct] = payload.split(".");
    if (v !== "v1" || !iv || !tag || !ct) throw new Error("Secreto con formato desconocido");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  }
}

export const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/** Token aleatorio de un solo uso: se entrega al usuario y solo se guarda su hash. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}
