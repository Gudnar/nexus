/** Llamadas JSON desde el navegador al BFF (mismo origen; los tokens viajan en cookies HttpOnly). */
export interface ApiResult<T = Record<string, any>> {
  ok: boolean;
  status: number;
  data: T;
}

export async function bff<T = Record<string, any>>(
  url: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      // POST/PATCH siempre llevan JSON (aunque sea vacío); GET y DELETE no llevan cuerpo.
      headers: method === "GET" || method === "DELETE" ? undefined : { "content-type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    const data = (text ? JSON.parse(text) : {}) as T;
    // 401 = sesión vencida, salvo que sea «contraseña actual incorrecta» (esa es una respuesta de la operación, no de la sesión).
    if (res.status === 401 && url.startsWith("/bff/api/") && (data as { code?: string }).code !== "INVALID_CREDENTIALS") {
      window.location.href = "/bff/auth/expired";
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { code: "NETWORK" } as T };
  }
}

/** Mensaje legible para un error de la API (con la lista de motivos si la política falla). */
export function errorText(r: ApiResult, fallback = "No se pudo completar la operación."): string {
  const d = r.data as { code?: string; errors?: unknown; detail?: string; title?: string };
  if (r.status === 0) return "No se pudo conectar. Revisa tu conexión.";
  if (r.status === 429) return d.detail ?? "Demasiados intentos. Espera unos minutos.";
  if (r.status === 503) return "El servicio no está disponible. Inténtalo en unos minutos.";
  // La API puede devolver la lista de motivos concretos (contraseña débil, tramos de precio inválidos…).
  if (Array.isArray(d.errors) && d.errors.length && d.errors.every((e) => typeof e === "string")) return (d.errors as string[]).join(" ");
  return d.detail ?? fallback;
}
