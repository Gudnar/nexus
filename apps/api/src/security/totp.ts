import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// ── TOTP (RFC 6238) sobre HMAC-SHA1, 6 dígitos, paso de 30 s: compatible con Google
// Authenticator, Microsoft Authenticator, Authy y 1Password. ──

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("base32 inválido");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateSecret = (): string => base32Encode(randomBytes(20));

export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

/** Acepta el código del paso actual y ±`window` pasos (deriva de reloj). */
export function verifyTotp(secret: string, code: string, window = 1, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 30_000);
  let ok = false;
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(hotp(secret, step + d));
    if (timingSafeEqual(expected, Buffer.from(code))) ok = true; // sin cortocircuito
  }
  return ok;
}

export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ── Códigos de recuperación: xxxxx-xxxxx, sin caracteres ambiguos (0/O, 1/I/L) ──
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRecoveryCode(): string {
  const pick = () => Array.from({ length: 5 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

export const isRecoveryCode = (s: string): boolean => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(s.trim().toUpperCase());
export const normalizeRecoveryCode = (s: string): string => s.trim().toUpperCase();
