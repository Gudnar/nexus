import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  /** Rol de plataforma (erp_platform): registro autoservicio y consola del administrador global. */
  PLATFORM_DATABASE_URL: z.string().min(1).optional(),
  /** Rol erp_worker: lee el outbox de todos los tenants. Sin él, el dispatcher queda desactivado. */
  WORKER_DATABASE_URL: z.string().min(1).optional(),
  OUTBOX_AUTOSTART: z.enum(["true", "false"]).default("true"),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(2000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET debe tener al menos 32 caracteres"),
  /** Clave para cifrar los secretos TOTP en reposo. */
  MFA_ENCRYPTION_KEY: z.string().min(32, "MFA_ENCRYPTION_KEY debe tener al menos 32 caracteres"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  /** Intentos de login por IP y minuto. */
  LOGIN_RATE_PER_MIN: z.coerce.number().int().positive().default(60),
  PORT: z.coerce.number().int().default(3000),
  /** URL pública de la web: se usa en los enlaces de los correos. */
  APP_PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  /** "log": no envía, guarda en el buzón de desarrollo. "smtp": envía con SMTP_URL. */
  MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("NEXUS ERP <no-reply@localhost>"),
  RESET_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(30),
  VERIFY_TOKEN_TTL_H: z.coerce.number().int().positive().default(24),
  /** Proxies de confianza para leer la IP real (X-Forwarded-For). Por defecto, solo el BFF local. */
  TRUST_PROXY: z.string().default("127.0.0.1,::1"),
  NODE_ENV: z.string().default("development"),
});

export function ttlSeconds(value: string): number {
  const m = /^(\d+)([smhd])$/.exec(value);
  if (!m) throw new Error(`TTL inválido: ${value} (use 30s, 15m, 12h, 30d)`);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "s" | "m" | "h" | "d"];
  return Number(m[1]) * unit;
}

export class AppConfig {
  readonly databaseUrl: string;
  readonly platformDatabaseUrl?: string;
  readonly workerDatabaseUrl?: string;
  readonly outboxAutostart: boolean;
  readonly outboxPollMs: number;
  readonly outboxMaxAttempts: number;
  readonly jwtSecret: Uint8Array;
  readonly mfaEncryptionKey: string;
  readonly accessTtl: number;
  readonly refreshTtl: number;
  readonly loginMaxFailures: number;
  readonly loginRatePerMin: number;
  readonly port: number;
  readonly appPublicUrl: string;
  readonly mailTransport: "log" | "smtp";
  readonly smtpUrl?: string;
  readonly mailFrom: string;
  readonly resetTokenTtlMin: number;
  readonly verifyTokenTtlH: number;
  readonly trustProxy: string[];
  readonly isProduction: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const e = Env.parse(env);
    this.databaseUrl = e.DATABASE_URL;
    this.platformDatabaseUrl = e.PLATFORM_DATABASE_URL;
    this.workerDatabaseUrl = e.WORKER_DATABASE_URL;
    this.outboxAutostart = e.OUTBOX_AUTOSTART === "true";
    this.outboxPollMs = e.OUTBOX_POLL_MS;
    this.outboxMaxAttempts = e.OUTBOX_MAX_ATTEMPTS;
    this.jwtSecret = new TextEncoder().encode(e.JWT_ACCESS_SECRET);
    this.mfaEncryptionKey = e.MFA_ENCRYPTION_KEY;
    this.accessTtl = ttlSeconds(e.ACCESS_TOKEN_TTL);
    this.refreshTtl = ttlSeconds(e.REFRESH_TOKEN_TTL);
    this.loginMaxFailures = e.LOGIN_MAX_FAILURES;
    this.loginRatePerMin = e.LOGIN_RATE_PER_MIN;
    this.port = e.PORT;
    this.appPublicUrl = e.APP_PUBLIC_URL.replace(/\/$/, "");
    this.mailTransport = e.MAIL_TRANSPORT;
    this.smtpUrl = e.SMTP_URL;
    this.mailFrom = e.MAIL_FROM;
    this.resetTokenTtlMin = e.RESET_TOKEN_TTL_MIN;
    this.verifyTokenTtlH = e.VERIFY_TOKEN_TTL_H;
    this.trustProxy = e.TRUST_PROXY.split(",").map((s) => s.trim()).filter(Boolean);
    this.isProduction = e.NODE_ENV === "production";
    if (this.isProduction && this.mailTransport === "log") {
      throw new Error("MAIL_TRANSPORT=log no está permitido en producción: configure SMTP_URL");
    }
  }
}
