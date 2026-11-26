import { randomBytes } from "node:crypto";

/** UUID v7 (RFC 9562) generado en la aplicación: PostgreSQL 16 no lo trae de forma nativa. */
export function uuidv7(): string {
  const b = randomBytes(16);
  let ts = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  b[6] = (b[6]! & 0x0f) | 0x70; // versión 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
