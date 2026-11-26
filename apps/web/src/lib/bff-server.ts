import type { ProblemDetails, TokenResponse } from "@erp/contracts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, AT_COOKIE, BRANCH_COOKIE, RT_COOKIE, sessionCookie } from "./session";

/** Las rutas BFF solo aceptan JSON del mismo origen (defensa CSRF junto con SameSite=Lax). */
export function checkSameOriginJson(req: Request, requireJson = true): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ code: "FORBIDDEN", title: "Origen no permitido" }, { status: 403 });
  }
  if (requireJson && !req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ code: "VALIDATION", title: "Se esperaba JSON" }, { status: 415 });
  }
  return null;
}

export async function setSessionCookies(t: TokenResponse, remember: boolean): Promise<void> {
  const jar = await cookies();
  jar.set(AT_COOKIE, t.accessToken, sessionCookie("access", { expiresIn: t.expiresIn }));
  jar.set(RT_COOKIE, t.refreshToken, sessionCookie("refresh", { remember }));
  jar.delete(BRANCH_COOKIE); // una sesión nueva empieza con el alcance por defecto
}

/** Llama a la API sin credenciales de usuario (rutas públicas). null si no responde. */
export async function apiPublic(path: string, init: { method?: string; body?: unknown; ip?: string | null; ua?: string | null }) {
  return fetch(`${API_URL}${path}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(init.ua ? { "user-agent": init.ua } : {}),
      // La API ve la IP del servidor web; se reenvía la del cliente para limitar por IP.
      ...(init.ip ? { "x-forwarded-for": init.ip } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  }).catch(() => null);
}

/** Traduce una respuesta de error de la API a un cuerpo mínimo para el navegador. */
export async function problemResponse(res: Response | null): Promise<NextResponse> {
  if (!res) return NextResponse.json({ code: "UNAVAILABLE", title: "Servicio no disponible" }, { status: 503 });
  const p = (await res.json().catch(() => ({ title: "Error" }))) as ProblemDetails;
  return NextResponse.json({ code: p.code, title: p.title, detail: p.detail, errors: p.errors }, { status: res.status });
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
