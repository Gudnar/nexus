import { createHash } from "node:crypto";

/**
 * Cliente mínimo de Cloudinary. Las direcciones base se pueden cambiar por entorno
 * (CLOUDINARY_API_BASE / CLOUDINARY_RES_BASE) para probar contra un servidor local sin salir a Internet.
 */
export const apiBase = () => (process.env.CLOUDINARY_API_BASE ?? "https://api.cloudinary.com").replace(/\/+$/, "");
export const resBase = () => (process.env.CLOUDINARY_RES_BASE ?? "https://res.cloudinary.com").replace(/\/+$/, "");

/** Firma de Cloudinary: SHA-1 de los parámetros ordenados («a=1&b=2») seguidos del API secret. */
export function signParams(params: Record<string, string | number>, secret: string): string {
  const base = Object.keys(params).filter((k) => params[k] !== "" && params[k] !== undefined).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha1").update(base + secret).digest("hex");
}

export interface CloudCreds { cloudName: string; apiKey: string; apiSecret: string }

export const uploadUrl = (cloudName: string) => `${apiBase()}/v1_1/${cloudName}/image/upload`;

/** Dirección permitida para una foto de esta nube: https://res.cloudinary.com/<nube>/... */
export const isCloudUrl = (url: string, cloudName: string) => url.startsWith(`${resBase()}/${cloudName}/`);

/** Miniatura cuadrada de 96 px (transformación de Cloudinary en la propia dirección). */
export function thumbOf(url: string): string {
  return url.includes("/upload/") ? url.replace("/upload/", "/upload/c_fill,w_96,h_96,q_auto,f_auto/") : url;
}

const basic = (c: CloudCreds) => "Basic " + Buffer.from(`${c.apiKey}:${c.apiSecret}`).toString("base64");

/** Comprueba cloud name, API key y secreto contra Cloudinary. */
export async function ping(c: CloudCreds, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchFn(`${apiBase()}/v1_1/${c.cloudName}/ping`, { headers: { authorization: basic(c) }, signal: AbortSignal.timeout(8000) });
    if (res.ok) return { ok: true, message: "Conexión correcta con Cloudinary." };
    if (res.status === 401 || res.status === 403) return { ok: false, message: "Cloudinary rechazó las credenciales: revisa la API key y el API secret." };
    if (res.status === 404) return { ok: false, message: "No existe una nube con ese nombre en Cloudinary." };
    return { ok: false, message: `Cloudinary respondió ${res.status}.` };
  } catch {
    return { ok: false, message: "No se pudo contactar a Cloudinary. Revisa la conexión a Internet del servidor." };
  }
}

/** Borra una imagen de Cloudinary (mejor esfuerzo: si falla, la foto igual se quita del producto). */
export async function destroy(c: CloudCreds, publicId: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signParams({ public_id: publicId, timestamp }, c.apiSecret);
    const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: c.apiKey, signature });
    const res = await fetchFn(`${apiBase()}/v1_1/${c.cloudName}/image/destroy`, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}
