import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * Limitador de ritmo de ventana deslizante EN MEMORIA. Suficiente para un solo proceso;
 * con varias instancias debe migrarse a Redis (BullMQ/Redis ya está en el stack).
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  /** Lanza 429 si `key` superó `limit` intentos en `windowMs`. */
  consume(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      const retry = Math.ceil((windowMs - (now - recent[0]!)) / 1000);
      throw new HttpException(
        { code: "RATE_LIMITED", message: `Demasiados intentos. Reintenta en ${retry} s.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (now - this.lastSweep > 60_000) this.sweep(now);
  }

  private sweep(now: number): void {
    this.lastSweep = now;
    for (const [k, v] of this.hits) if (now - v[v.length - 1]! > 3_600_000) this.hits.delete(k);
  }

  /** Solo para pruebas. */
  reset(): void {
    this.hits.clear();
  }
}
