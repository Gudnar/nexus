import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { RequestContext } from "./request-context";

export const PUBLIC_KEY = "erp:public";
export const PERMISSIONS_KEY = "erp:permissions";

/** Ruta sin autenticación (login, refresh, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Exige TODOS los permisos indicados; se verifican en backend en cada petición. */
export const RequirePermission = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);

export interface AppRequest {
  ctx?: RequestContext;
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Inyecta el `RequestContext` de la petición autenticada. */
export const Ctx = createParamDecorator((_data: unknown, host: ExecutionContext): RequestContext => {
  const ctx = host.switchToHttp().getRequest<AppRequest>().ctx;
  if (!ctx) throw new Error("RequestContext no disponible en una ruta pública");
  return ctx;
});
