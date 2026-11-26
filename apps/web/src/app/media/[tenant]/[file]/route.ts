import { API_URL } from "@/lib/session";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TENANT = new RegExp(`^${UUID}$`);
const FILE = new RegExp(`^${UUID}\\.(jpg|png|webp|gif)$`);

/** Entrega las fotos que la API guardó en el servidor (sin sesión, como las de una tienda). Solo imágenes con nombre aleatorio. */
export async function GET(_req: Request, ctx: { params: Promise<{ tenant: string; file: string }> }) {
  const { tenant, file } = await ctx.params;
  if (!TENANT.test(tenant) || !FILE.test(file)) return new Response("No encontrado", { status: 404 });
  const res = await fetch(`${API_URL}/api/v1/public/media/${tenant}/${file}`, { cache: "force-cache" }).catch(() => null);
  if (!res?.ok) return new Response("No encontrado", { status: res?.status === 404 ? 404 : 502 });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
