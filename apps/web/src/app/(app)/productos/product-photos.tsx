"use client";

import type { ImageStorageInfo, ImageUploadSignature, ProductImageView } from "@erp/contracts";
import { ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { bff, errorText } from "@/lib/client-api";

const MAX = 6;
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Fotos del producto. El navegador las sube directo a Cloudinary con una firma que da el servidor
 * (así el API secret nunca sale del servidor) y después se registran en el producto.
 */
export function ProductPhotos({ productId, canManage }: { productId: string; canManage: boolean }) {
  const [images, setImages] = useState<ProductImageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; setup?: boolean } | null>(null);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState<ImageStorageInfo["mode"] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await bff<ProductImageView[]>(`/bff/api/catalog/products/${productId}/images`, "GET");
    if (r.ok) setImages(r.data);
    setLoading(false);
  }, [productId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void bff<ImageStorageInfo>("/bff/api/catalog/image-storage", "GET").then((r) => setMode(r.ok ? r.data.mode : "SERVER")); }, []);

  const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result).split(",")[1] ?? "");
    rd.onerror = () => reject(new Error("No se pudo leer el archivo."));
    rd.readAsDataURL(file);
  });

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    setMsg(null);
    for (const file of list) {
      if (!ACCEPT.includes(file.type)) return setMsg({ ok: false, text: `«${file.name}» no es una imagen JPG, PNG, WebP o GIF.` });
      if (file.size > 5_000_000) return setMsg({ ok: false, text: `«${file.name}» pesa más de 5 MB.` });
    }
    let count = images.length;
    let m = mode;
    if (!m) { const r = await bff<ImageStorageInfo>("/bff/api/catalog/image-storage", "GET"); m = r.ok ? r.data.mode : "SERVER"; setMode(m); }
    for (const file of list) {
      if (count >= MAX) return setMsg({ ok: false, text: `Un producto admite hasta ${MAX} fotos.` });
      setBusy(file.name);
      if (m === "SERVER") {
        // Sin Cloudinary: la foto se guarda en el servidor de NEXUS.
        try {
          const reg = await bff(`/bff/api/catalog/products/${productId}/images/upload`, "POST", { fileName: file.name, contentBase64: await toBase64(file) });
          if (!reg.ok) { setBusy(null); return setMsg({ ok: false, text: errorText(reg) }); }
        } catch (e) { setBusy(null); return setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo subir la foto." }); }
        count++;
        continue;
      }
      const sig = await bff<ImageUploadSignature>(`/bff/api/catalog/products/${productId}/images/signature`, "POST");
      if (!sig.ok) {
        setBusy(null);
        return setMsg({ ok: false, text: errorText(sig), setup: (sig.data as { code?: string }).code === "INTEGRATION_NOT_READY" });
      }
      const s = sig.data;
      const form = new FormData();
      form.set("file", file); form.set("api_key", s.apiKey); form.set("timestamp", String(s.timestamp)); form.set("signature", s.signature); form.set("folder", s.folder);
      let uploaded: { secure_url?: string; public_id?: string; bytes?: number; width?: number; height?: number; error?: { message?: string } } | null = null;
      try {
        const res = await fetch(s.uploadUrl, { method: "POST", body: form });
        uploaded = await res.json();
        if (!res.ok) throw new Error(uploaded?.error?.message ?? "Cloudinary rechazó la imagen.");
      } catch (e) {
        setBusy(null);
        return setMsg({ ok: false, text: e instanceof Error && e.message !== "Failed to fetch" ? e.message : "No se pudo subir la imagen a Cloudinary. Revisa tu conexión." });
      }
      const reg = await bff(`/bff/api/catalog/products/${productId}/images`, "POST", { url: uploaded!.secure_url, publicId: uploaded!.public_id, bytes: uploaded!.bytes, width: uploaded!.width, height: uploaded!.height });
      if (!reg.ok) { setBusy(null); return setMsg({ ok: false, text: errorText(reg) }); }
      count++;
    }
    setBusy(null);
    setMsg({ ok: true, text: list.length > 1 ? `${list.length} fotos subidas.` : "Foto subida." });
    await load();
  }

  async function makePrimary(id: string) {
    const r = await bff<ProductImageView[]>(`/bff/api/catalog/products/${productId}/images/${id}/primary`, "POST");
    if (r.ok) setImages(r.data); else setMsg({ ok: false, text: errorText(r) });
  }
  async function remove(id: string) {
    if (!window.confirm("¿Quitar esta foto? También se borra de Cloudinary.")) return;
    const r = await bff(`/bff/api/catalog/products/${productId}/images/${id}`, "DELETE");
    if (!r.ok) return setMsg({ ok: false, text: errorText(r) });
    await load();
  }

  return (
    <fieldset className="grid gap-3" data-testid="product-photos">
      <legend className="mb-1 text-[13px] font-semibold text-ink">Fotos del producto <span className="font-normal text-ink-3">({images.length} de {MAX})</span></legend>
      {loading ? <p className="text-xs text-ink-3">Cargando…</p> : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6" data-testid="photo-list">
          {images.map((img) => (
            <li key={img.id} className={`group relative overflow-hidden rounded-lg border ${img.isPrimary ? "border-brand ring-2 ring-brand/30" : "border-line"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumbUrl} alt="Foto del producto" className="aspect-square w-full bg-neutral-soft object-cover" loading="lazy" />
              {img.isPrimary && <span className="absolute left-1 top-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">Principal</span>}
              {canManage && (
                <span className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent p-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  {!img.isPrimary ? <button type="button" onClick={() => makePrimary(img.id)} className="rounded bg-white/90 p-1 text-ink hover:bg-white" aria-label="Hacer principal" title="Hacer principal"><Star className="size-3.5" /></button> : <span />}
                  <button type="button" onClick={() => remove(img.id)} className="rounded bg-white/90 p-1 text-danger hover:bg-white" aria-label="Quitar foto" title="Quitar foto"><Trash2 className="size-3.5" /></button>
                </span>
              )}
            </li>
          ))}
          {canManage && images.length < MAX && (
            <li>
              <button type="button" onClick={() => input.current?.click()} disabled={busy !== null}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files); }}
                className={`grid aspect-square w-full place-items-center rounded-lg border-2 border-dashed text-center text-[11px] text-ink-2 hover:border-brand hover:text-brand ${drag ? "border-brand bg-brand-soft" : "border-line-strong"}`} aria-label="Subir foto">
                {busy ? <span className="grid gap-1 px-1"><Loader2 className="mx-auto size-5 animate-spin" aria-hidden />Subiendo…</span> : <span className="grid gap-1 px-1"><ImagePlus className="mx-auto size-5" aria-hidden />Subir foto</span>}
              </button>
            </li>
          )}
        </ul>
      )}
      <input ref={input} type="file" accept={ACCEPT.join(",")} multiple className="sr-only" aria-label="Elegir fotos" data-testid="photo-input"
        onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
      {msg && (
        <p role={msg.ok ? "status" : "alert"} data-testid="photo-msg" className={`rounded-lg px-3 py-2 text-[13px] ${msg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
          {msg.text} {msg.setup && <Link href="/configuracion/integraciones" className="font-medium underline">Ir a Integraciones</Link>}
        </p>
      )}
      {mode === "SERVER" && canManage && <p className="text-xs text-ink-3" data-testid="photo-mode">Las fotos se guardan en el servidor de NEXUS porque Cloudinary no está activo. Puedes conectarlo en <Link href="/configuracion/integraciones" className="font-medium text-brand hover:underline">Configuración → Integraciones</Link> para guardarlas en la nube.</p>}
      {mode === "CLOUDINARY" && canManage && <p className="text-xs text-ink-3" data-testid="photo-mode">Las fotos nuevas se guardan en Cloudinary.</p>}
      {images.length === 0 && !loading && !msg && <p className="text-xs text-ink-3">JPG, PNG, WebP o GIF de hasta 5 MB. La primera foto es la principal y se ve en listados y ventas.</p>}
    </fieldset>
  );
}
