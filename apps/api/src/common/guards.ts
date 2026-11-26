import {
  type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AccessScheduleService } from "../access/access-schedule.service";
import { TokenService } from "../auth/token.service";
import { DB, type Db } from "../db";
import { type AppRequest, PERMISSIONS_KEY, PUBLIC_KEY } from "./decorators";
import { RequestContext } from "./request-context";

const unauthorized = () => new UnauthorizedException({ code: "UNAUTHORIZED", message: "Autenticación requerida" });

/** Valida el JWT y que la sesión siga vigente (no revocada ni expirada). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Db,
    @Inject(AccessScheduleService) private readonly schedules: AccessScheduleService,
  ) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [host.getHandler(), host.getClass()])) return true;

    const req = host.switchToHttp().getRequest<AppRequest>();
    const header = req.headers["authorization"];
    const value = Array.isArray(header) ? header[0] : header;
    const token = value?.startsWith("Bearer ") ? value.slice(7).trim() : undefined;
    if (!token) throw unauthorized();

    const claims = await this.tokens.verify(token);
    if (!claims) throw unauthorized();

    const session = await this.db.session.findFirst({
      where: { id: claims.sessionId, userId: claims.userId, tenantId: claims.tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) throw unauthorized();
    await this.schedules.assertAllowed(claims.tenantId, claims.membershipId);

    req.ctx = new RequestContext(this.db, claims, req.headers);
    return true;
  }
}

/** Autorización por permisos (RBAC dinámico) verificada en backend. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      host.getHandler(), host.getClass(),
    ]);
    if (!required?.length) return true;
    const ctx = host.switchToHttp().getRequest<AppRequest>().ctx;
    if (!ctx) throw unauthorized();
    const granted = await ctx.permissions();
    if (!required.every((c) => granted.has(c))) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "Permiso insuficiente" });
    }
    return true;
  }
}
