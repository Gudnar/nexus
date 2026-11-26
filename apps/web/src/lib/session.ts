export const AT_COOKIE = "erp_at";
export const RT_COOKIE = "erp_rt";
export const BRANCH_COOKIE = "erp_branch";
/** Sesión del administrador global (consola de plataforma): cookie y audiencia separadas. */
export const PT_COOKIE = "erp_pt";

export const API_URL = process.env.API_URL ?? "http://127.0.0.1:4300";

const REFRESH_DAYS = Number(process.env.REFRESH_COOKIE_DAYS ?? 30);

export const isProd = process.env.NODE_ENV === "production";

/** Opciones de las cookies de sesión: HttpOnly, SameSite=Lax y Secure en producción. */
export function sessionCookie(kind: "access" | "refresh", opts: { expiresIn?: number; remember?: boolean }) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    ...(kind === "access"
      ? { maxAge: opts.expiresIn }
      : opts.remember === false
        ? {} // cookie de sesión: se borra al cerrar el navegador
        : { maxAge: REFRESH_DAYS * 86400 }),
  };
}

/** Segundos hasta que expira un JWT (sin verificar la firma: la verifica la API). */
export function secondsToExpiry(jwt: string): number {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return Number(payload.exp) - Math.floor(Date.now() / 1000);
  } catch {
    return -1;
  }
}
