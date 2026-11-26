import { Inject, Injectable } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import { AppConfig } from "../config";

export interface AuthClaims {
  userId: string;
  tenantId: string;
  membershipId: string;
  sessionId: string;
}

/** Desafío MFA: la contraseña ya fue validada, falta el segundo factor. */
export interface MfaClaims {
  userId: string;
  tenantId: string;
  membershipId: string;
}

const ISSUER = "erp-api";
const MFA_TTL_SECONDS = 300;
const PLATFORM_AUDIENCE = "erp-platform";
const PLATFORM_TTL_SECONDS = 1800;

@Injectable()
export class TokenService {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

  sign(c: AuthClaims): Promise<string> {
    return new SignJWT({ tid: c.tenantId, mid: c.membershipId, sid: c.sessionId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtl}s`)
      .sign(this.config.jwtSecret);
  }

  /** Devuelve null si la firma, el emisor o la vigencia no son válidos. Rechaza tokens MFA/plataforma. */
  async verify(token: string): Promise<AuthClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, { issuer: ISSUER, algorithms: ["HS256"] });
      const { sub, tid, mid, sid, use } = payload as Record<string, unknown>;
      if (use !== undefined || payload.aud !== undefined) return null;
      if (![sub, tid, mid, sid].every((v) => typeof v === "string")) return null;
      return { userId: sub as string, tenantId: tid as string, membershipId: mid as string, sessionId: sid as string };
    } catch {
      return null;
    }
  }

  signMfa(c: MfaClaims): Promise<string> {
    return new SignJWT({ tid: c.tenantId, mid: c.membershipId, use: "mfa" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${MFA_TTL_SECONDS}s`)
      .sign(this.config.jwtSecret);
  }

  get mfaTtl(): number {
    return MFA_TTL_SECONDS;
  }

  async verifyMfa(token: string): Promise<MfaClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, { issuer: ISSUER, algorithms: ["HS256"] });
      const { sub, tid, mid, use } = payload as Record<string, unknown>;
      if (use !== "mfa" || ![sub, tid, mid].every((v) => typeof v === "string")) return null;
      return { userId: sub as string, tenantId: tid as string, membershipId: mid as string };
    } catch {
      return null;
    }
  }

  // ── Administrador global (plataforma): audiencia propia, nunca válido como token de tenant ──

  signPlatform(platformUserId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(platformUserId)
      .setIssuer(ISSUER)
      .setAudience(PLATFORM_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${PLATFORM_TTL_SECONDS}s`)
      .sign(this.config.jwtSecret);
  }

  get platformTtl(): number {
    return PLATFORM_TTL_SECONDS;
  }

  async verifyPlatform(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, {
        issuer: ISSUER, audience: PLATFORM_AUDIENCE, algorithms: ["HS256"],
      });
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
