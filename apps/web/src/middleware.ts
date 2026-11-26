import { type NextRequest, NextResponse } from "next/server";
import type { TokenResponse } from "@erp/contracts";
import { API_URL, AT_COOKIE, RT_COOKIE, secondsToExpiry, sessionCookie } from "@/lib/session";

/**
 * Protege las rutas de la aplicación. Si el access token venció y hay refresh token, lo
 * renueva aquí (único lugar donde se pueden escribir cookies antes de renderizar).
 * Los refresh son rotativos: se omiten en prefetch para no consumir el token dos veces.
 */
export async function middleware(req: NextRequest) {
  const at = req.cookies.get(AT_COOKIE)?.value;
  if (at && secondsToExpiry(at) > 20) return NextResponse.next();

  const rt = req.cookies.get(RT_COOKIE)?.value;
  const isPrefetch = req.headers.get("next-router-prefetch") === "1" || req.headers.get("purpose") === "prefetch";
  if (!rt || isPrefetch) return toLogin(req);

  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
  }).catch(() => null);
  if (!res?.ok) return toLogin(req);

  const t = (await res.json()) as TokenResponse;
  // Las páginas que se renderizan en esta misma petición deben ver los tokens nuevos.
  const headers = new Headers(req.headers);
  const jar = new Map(req.cookies.getAll().map((c) => [c.name, c.value]));
  jar.set(AT_COOKIE, t.accessToken);
  jar.set(RT_COOKIE, t.refreshToken);
  headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));

  const out = NextResponse.next({ request: { headers } });
  out.cookies.set(AT_COOKIE, t.accessToken, sessionCookie("access", { expiresIn: t.expiresIn }));
  // `remember` no se conserva: la cookie de refresh se renueva como persistente.
  out.cookies.set(RT_COOKIE, t.refreshToken, sessionCookie("refresh", { remember: true }));
  return out;
}

function toLogin(req: NextRequest) {
  // Sin ninguna cookie de sesión es una visita nueva, no una sesión vencida.
  const hadSession = req.cookies.has(AT_COOKIE) || req.cookies.has(RT_COOKIE);
  return NextResponse.redirect(new URL(hadSession ? "/bff/auth/expired" : "/login", req.url));
}

export const config = {
  // Todo excepto las pantallas públicas, la consola de plataforma (su propia sesión), BFF y estáticos.
  matcher: [
    "/((?!login|forgot-password|reset-password|register|verify-email|aceptar-invitacion|plataforma|bff|_next|favicon.ico|.*\\..*).*)",
  ],
};
