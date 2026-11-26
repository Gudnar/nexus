"use client";

import type { ImportJobSummary, ImportPreview, ImportResult } from "@erp/contracts";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, downloadBase64 } from "@/components/field";
import { btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

type Kind = "PRODUCTS" | "PRICES";
const KIND = { PRODUCTS: "Productos", PRICES: "Precios" } as const;
const STATUS = { PREVIEWED: ["Sin aplicar", "warning"], APPLIED: ["Aplicada", "success"], FAILED: ["Fallida", "danger"] } as const;
const ACTION = { CREATE: "Crear", UPDATE: "Actualizar" } as Record<string, string>;
const MAX_BYTES = 5 * 1024 * 1024;
const SHOWN_ERRORS = 100;

interface List { id: string; name: string; code: string }
interface Props { jobs: ImportJobSummary[]; lists: List[]; canImportProducts: boolean; canImportPrices: boolean; canExport: boolean }

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function ImportManager({ jobs, lists, canImportProducts, canImportPrices, canExport }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const kinds: Kind[] = [...(canImportProducts ? (["PRODUCTS"] as const) : []), ...(canImportPrices ? (["PRICES"] as const) : [])];
  const [kind, setKind] = useState<Kind>(kinds[0] ?? "PRODUCTS");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "confirm" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const canImport = kinds.length > 0;
  const reset = () => { setPreview(null); setResult(null); setError(null); };

  async function download(path: string, label: string) {
    setBusy("download");
    setError(null);
    const r = await bff<{ fileName: string; contentBase64: string }>(path, "GET");
    setBusy(null);
    if (!r.ok) return setError(r.status === 403 ? `No tienes permiso para ${label}.` : errorText(r));
    downloadBase64(r.data.fileName, r.data.contentBase64);
  }

  async function doPreview() {
    if (!file) return setError("Elige un archivo .xlsx.");
    if (!/\.xlsx$/i.test(file.name)) return setError("El archivo debe ser de Excel (.xlsx).");
    if (file.size > MAX_BYTES) return setError("El archivo supera los 5 MB.");
    if (kind === "PRICES" && !listId) return setError("Elige la lista de precios de destino.");
    reset();
    setBusy("preview");
    const contentBase64 = await readBase64(file).catch(() => "");
    if (!contentBase64) { setBusy(null); return setError("No se pudo leer el archivo."); }
    const r = await bff<ImportPreview>("/bff/api/imports/preview", "POST", { kind, fileName: file.name, contentBase64, ...(kind === "PRICES" ? { priceListId: listId } : {}) });
    setBusy(null);
    if (r.ok) setPreview(r.data);
    else setError(errorText(r, "No se pudo analizar el archivo."));
  }

  async function confirm(skipInvalid: boolean) {
    if (!preview) return;
    setBusy("confirm");
    setError(null);
    const r = await bff<ImportResult>(`/bff/api/imports/${preview.jobId}/confirm`, "POST", { skipInvalid });
    setBusy(null);
    if (!r.ok) return setError(errorText(r, "No se pudo aplicar la importación. No se cambió nada."));
    setResult(r.data);
    setPreview(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-base font-semibold text-ink">Importar desde Excel</h2>
          {!canImport ? (
            <p className="text-ink-2">No tienes permiso para importar. Pide acceso de administración del catálogo o de precios.</p>
          ) : (
            <div className="grid gap-4">
              <p className="text-[13px] text-ink-2">1) Descarga la plantilla · 2) Complétala · 3) Súbela y revisa la vista previa · 4) Confirma.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Qué quieres importar">
                  <select className={inputCls} value={kind} onChange={(e) => { setKind(e.target.value as Kind); reset(); }}>
                    {kinds.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
                  </select>
                </Field>
                {kind === "PRICES" && (
                  <Field label="Lista de destino">
                    <select className={inputCls} value={listId} onChange={(e) => { setListId(e.target.value); reset(); }}>
                      {lists.length === 0 && <option value="">No hay listas activas</option>}
                      {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <div>
                <button type="button" className={`${btnSecondary} h-9 px-3`} onClick={() => download(`/bff/api/imports/template/${kind}`, "bajar la plantilla")} disabled={busy !== null}>
                  <Download className="size-4" aria-hidden /> Descargar plantilla de {KIND[kind].toLowerCase()}
                </button>
              </div>
              <Field label="Archivo Excel (.xlsx, hasta 5 MB y 5.000 filas)">
                <input
                  ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="block w-full text-[13px] text-body file:mr-3 file:h-10 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-4 file:text-[13px] file:font-medium hover:file:bg-surface-muted"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
                />
              </Field>
              <div>
                <button className={btnPrimary} onClick={doPreview} disabled={busy !== null || !file}>
                  {busy === "preview" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />} Analizar archivo
                </button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-base font-semibold text-ink">Exportar a Excel</h2>
          <p className="mb-4 text-[13px] text-ink-2">El archivo exportado tiene las mismas columnas que la plantilla: puedes editarlo y volver a importarlo.</p>
          {!canExport ? (
            <p className="text-ink-2">No tienes permiso para exportar.</p>
          ) : (
            <div className="grid gap-3">
              <div><button className={btnSecondary} onClick={() => download("/bff/api/exports/products", "exportar")} disabled={busy !== null}><FileSpreadsheet className="size-4" aria-hidden /> Exportar productos</button></div>
              {lists.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <select className={`${inputCls} w-[240px]`} aria-label="Lista a exportar" value={listId} onChange={(e) => setListId(e.target.value)}>
                    {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
                  </select>
                  <button className={btnSecondary} onClick={() => download(`/bff/api/exports/prices/${listId}`, "exportar")} disabled={busy !== null || !listId}><FileSpreadsheet className="size-4" aria-hidden /> Exportar precios</button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</p>}

      {result && (
        <Card>
          <p role="status" className="text-[14px] text-ink" data-testid="import-result">
            <strong>Importación aplicada.</strong> Creados: {result.created} · Actualizados: {result.updated} · Omitidos: {result.skipped}
          </p>
        </Card>
      )}

      {preview && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-ink">Vista previa · {preview.fileName}</h2>
          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="import-totals">
            {([["Filas", preview.totals.rows], ["Válidas", preview.totals.valid], ["Con errores", preview.totals.errors], ["A crear", preview.totals.create], ["A actualizar", preview.totals.update]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line p-3"><dt className="text-xs text-ink-2">{k}</dt><dd className={`text-lg font-semibold tabular-nums ${k === "Con errores" && v > 0 ? "text-danger" : "text-ink"}`}>{v}</dd></div>
            ))}
          </dl>

          {preview.errors.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-[13px] font-semibold text-danger">Errores a corregir</h3>
              <ul className="max-h-64 overflow-auto rounded-lg border border-line text-[13px]">
                {preview.errors.slice(0, SHOWN_ERRORS).map((e, i) => (
                  <li key={i} className="flex gap-3 border-b border-line-strong/40 px-3 py-2 last:border-0"><span className="w-[72px] shrink-0 font-medium text-ink">Fila {e.row}</span><span className="text-body">{e.message}</span></li>
                ))}
              </ul>
              {preview.errors.length > SHOWN_ERRORS && <p className="mt-1 text-xs text-ink-3">Se muestran los primeros {SHOWN_ERRORS} de {preview.errors.length} errores.</p>}
            </div>
          )}

          {preview.sample.length > 0 && (
            <div className="mb-4 overflow-x-auto">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">Primeras filas válidas</h3>
              <table className="w-full text-left text-[13px]">
                <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Fila</th><th className="font-medium">Acción</th><th className="font-medium">Clave</th><th className="font-medium">Detalle</th></tr></thead>
                <tbody>{preview.sample.map((s) => <tr key={s.row} className="h-9 border-b border-line-strong/40"><td>{s.row}</td><td>{ACTION[s.action] ?? s.action}</td><td className="text-ink-2">{s.key}</td><td>{s.summary}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
            <button className={btnSecondary} onClick={() => { reset(); setFile(null); if (fileRef.current) fileRef.current.value = ""; }} disabled={busy !== null}>Descartar</button>
            {preview.totals.errors > 0 && preview.totals.valid > 0 && (
              <button className={btnSecondary} onClick={() => confirm(true)} disabled={busy !== null}>Aplicar solo las {preview.totals.valid} filas válidas</button>
            )}
            {preview.totals.errors === 0 && preview.totals.valid > 0 && (
              <button className={btnPrimary} onClick={() => confirm(false)} disabled={busy !== null}>
                {busy === "confirm" && <Loader2 className="size-4 animate-spin" aria-hidden />} Confirmar e importar
              </button>
            )}
          </div>
          {preview.totals.errors > 0 && <p className="mt-2 text-right text-xs text-ink-3">Corrige el archivo y vuelve a subirlo, o aplica solo las filas válidas.</p>}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-base font-semibold text-ink">Importaciones recientes</h2>
        {jobs.length === 0 ? (
          <p className="py-4 text-center text-ink-2">Todavía no se importó nada.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Archivo</th><th className="px-3 font-medium">Tipo</th><th className="px-3 font-medium">Filas</th><th className="px-3 font-medium">Errores</th><th className="px-3 font-medium">Estado</th><th className="px-5 font-medium">Fecha</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="h-[44px] border-b border-line-strong/40 text-body">
                    <td className="px-5 font-medium text-ink">{j.fileName}</td><td className="px-3">{KIND[j.kind]}</td>
                    <td className="px-3 tabular-nums">{j.totals.rows}</td><td className="px-3 tabular-nums">{j.totals.errors}</td>
                    <td className="px-3"><StatusBadge tone={STATUS[j.status][1]}>{STATUS[j.status][0]}</StatusBadge></td>
                    <td className="px-5 text-ink-2" suppressHydrationWarning>{new Date(j.appliedAt ?? j.createdAt).toLocaleString("es-BO")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
