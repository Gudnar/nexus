import type { ReactNode } from "react";

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/** Descarga un archivo recibido como { fileName, contentBase64 }. */
export function downloadBase64(fileName: string, contentBase64: string) {
  const bin = atob(contentBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Formatea un decimal recibido como texto (sin ceros de relleno innecesarios). */
export const num = (v: string | number | null | undefined, max = 4) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("es-BO", { minimumFractionDigits: 0, maximumFractionDigits: max });
export const money = (v: string | number, decimals = 2) =>
  Number(v).toLocaleString("es-BO", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
