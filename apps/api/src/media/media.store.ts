import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Carpeta donde el servidor guarda los archivos subidos (UPLOADS_DIR; por defecto «uploads» junto a la API). */
export const uploadsDir = () => resolve(process.env.UPLOADS_DIR ?? join(process.cwd(), "uploads"));

export const MAX_UPLOAD_BYTES = 5_000_000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const FILE_RE = new RegExp(`^${UUID}\\.(jpg|png|webp|gif)$`);
export const TENANT_RE = new RegExp(`^${UUID}$`);

export type ImageKind = { ext: "jpg" | "png" | "webp" | "gif"; mime: string };
export const MIME: Record<ImageKind["ext"], string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

/** Tipo real de la imagen según sus primeros bytes (no se confía en el nombre ni en lo que diga el navegador). SVG queda fuera a propósito. */
export function sniffImage(b: Buffer): ImageKind | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: MIME.jpg };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: MIME.png };
  if (b.length > 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a")) return { ext: "gif", mime: MIME.gif };
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", mime: MIME.webp };
  return null;
}

const pathOf = (tenantId: string, file: string) => join(uploadsDir(), tenantId, file);

export async function saveFile(tenantId: string, file: string, data: Buffer): Promise<void> {
  await mkdir(join(uploadsDir(), tenantId), { recursive: true });
  await writeFile(pathOf(tenantId, file), data, { flag: "wx" });
}
export async function readStored(tenantId: string, file: string): Promise<Buffer | null> {
  if (!TENANT_RE.test(tenantId) || !FILE_RE.test(file)) return null;
  try { return await readFile(pathOf(tenantId, file)); } catch { return null; }
}
export async function removeStored(tenantId: string, file: string): Promise<void> {
  if (!TENANT_RE.test(tenantId) || !FILE_RE.test(file)) return;
  await unlink(pathOf(tenantId, file)).catch(() => undefined);
}
