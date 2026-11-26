"use client";

import type { CountDetail, CountSummary } from "@erp/contracts";
import { ClipboardCheck, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const STATUS: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = {
  OPEN: ["Abierto", "info"], SUBMITTED: ["Enviado a revisión", "warning"], APPLIED: ["Aplicado", "success"], CANCELLED: ["Cancelado", "danger"],
};
interface Wh { id: string; code: string; name: string }

export function CountsManager({ counts, warehouses, canCount, canApprove }: { counts: CountSummary[]; warehouses: Wh[]; canCount: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Conteos físicos</h2>
          {canCount && <button className={btnPrimary} onClick={() => setCreating(true)} disabled={warehouses.length === 0}><Plus className="size-4" aria-hidden /> Nuevo conteo</button>}
        </div>
        {counts.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Aún no hay conteos" description="Abre uno con «Nuevo conteo»: se toma una foto de lo que el sistema dice que hay y tú registras lo que realmente hay." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Código</th><th className="px-3 font-medium">Almacén</th><th className="px-3 font-medium">Avance</th><th className="px-3 font-medium">Con diferencia</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">{c.code}</td><td className="px-3">{c.warehouse.code}</td>
                    <td className="px-3 tabular-nums">{c.totals.counted}/{c.totals.lines}</td><td className="px-3 tabular-nums">{c.totals.withDifference}</td>
                    <td className="px-3"><StatusBadge tone={STATUS[c.status]![1]}>{STATUS[c.status]![0]}</StatusBadge></td>
                    <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpenId(c.id)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo conteo físico">
        {creating && <NewCount warehouses={warehouses} onDone={(id) => { setCreating(false); router.refresh(); setOpenId(id); }} onCancel={() => setCreating(false)} />}
      </Modal>
      <Modal open={openId !== null} onClose={() => setOpenId(null)} title="Conteo físico" size="lg">
        {openId && <CountView key={openId} id={openId} canCount={canCount} canApprove={canApprove} onChanged={() => router.refresh()} onClose={() => setOpenId(null)} />}
      </Modal>
    </>
  );
}

function NewCount({ warehouses, onDone, onCancel }: { warehouses: Wh[]; onDone: (id: string) => void; onCancel: () => void }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff<CountDetail>("/bff/api/inventory/counts", "POST", { warehouseId, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (r.ok) return onDone(r.data.id);
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Almacén"><select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
      <Field label="Nota (opcional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Conteo mensual, inventario general…" /></Field>
      <p className="text-[13px] text-ink-2">Se tomará una foto de las existencias por lote. Lo que se venda o reciba mientras cuentas no se pierde: la diferencia se calcula contra la foto.</p>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Abrir conteo</button>
      </div>
    </form>
  );
}

function CountView({ id, canCount, canApprove, onChanged, onClose }: { id: string; canCount: boolean; canApprove: boolean; onChanged: () => void; onClose: () => void }) {
  const [c, setC] = useState<CountDetail | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = (d: CountDetail) => { setC(d); setVals(Object.fromEntries(d.lines.map((l) => [l.id, l.countedQty === null ? "" : String(Number(l.countedQty))]))); };
  useEffect(() => { void bff<CountDetail>(`/bff/api/inventory/counts/${id}`, "GET").then((r) => (r.ok ? adopt(r.data) : setError(errorText(r)))); }, [id]);

  async function call(path: string, method: "POST" | "PUT", body?: unknown) {
    setError(null);
    const r = await bff<CountDetail>(`/bff/api/inventory/counts/${id}${path}`, method, body);
    if (!r.ok) { setError(r.data.code === "INSUFFICIENT_STOCK" ? `No se puede aplicar: ${errorText(r)}` : errorText(r)); return null; }
    adopt(r.data); onChanged();
    return r.data;
  }
  const save = async () => {
    setBusy("save");
    await call("/lines", "PUT", { lines: c!.lines.map((l) => ({ lineId: l.id, countedQty: vals[l.id] === "" ? null : Number(vals[l.id]) })) });
    setBusy(null);
  };
  const run = async (path: string, key: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    if (c!.status === "OPEN" && key === "submit") { await save(); }
    await call(path, "POST");
    setBusy(null);
  };

  if (!c) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-ink-2">Cargando…</p>;
  const [label, tone] = STATUS[c.status]!;
  const editable = c.status === "OPEN" && canCount;
  const liveDiff = (l: CountDetail["lines"][number]) => (vals[l.id] === "" || vals[l.id] === undefined ? null : Number(vals[l.id]) - Number(l.expectedQty));

  return (
    <div className="grid gap-5" data-testid="count-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">{c.code} <StatusBadge tone={tone}>{label}</StatusBadge></h3>
          <p className="mt-1 text-[13px] text-ink-2">{c.warehouse.name} ({c.warehouse.code}){c.note ? ` · ${c.note}` : ""}</p>
        </div>
        <p className="text-right text-[13px] text-ink-2">Diferencia neta<span className={`block text-lg font-semibold tabular-nums ${Number(c.differenceValue) < 0 ? "text-danger" : "text-ink"}`} data-testid="count-diff-value">{money(c.differenceValue)}</span></p>
      </div>
      <div className="max-h-[52vh] overflow-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0 bg-surface"><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Producto</th><th className="font-medium">Lote</th><th className="text-right font-medium">Sistema</th><th className="text-right font-medium">Contado</th><th className="text-right font-medium">Diferencia</th></tr></thead>
          <tbody className="tabular-nums">
            {c.lines.map((l) => {
              const d = editable ? liveDiff(l) : l.difference === null ? null : Number(l.difference);
              return (
                <tr key={l.id} className="h-11 border-b border-line-strong/40">
                  <td><span className="font-medium text-ink">{l.productName}</span> <span className="text-ink-3">{l.productCode}</span></td>
                  <td className="text-ink-2">{l.lotCode}{l.expiresOn ? <span className="block text-xs text-ink-3">vence {l.expiresOn}</span> : null}</td>
                  <td className="text-right">{num(l.expectedQty)} {l.unit}</td>
                  <td className="text-right">{editable ? <input type="number" step="any" min="0" className={`${inputCls} h-8 w-24 text-right`} value={vals[l.id] ?? ""} onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })} aria-label={`Contado, ${l.productCode} ${l.lotCode}`} /> : l.countedQty === null ? "—" : num(l.countedQty)}</td>
                  <td className={`text-right font-medium ${d === null || d === 0 ? "text-ink-3" : d < 0 ? "text-danger" : "text-success"}`}>{d === null ? "—" : d > 0 ? `+${num(d)}` : num(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button className={btnSecondary} onClick={onClose}>Cerrar</button>
        {canCount && (c.status === "OPEN" || c.status === "SUBMITTED") && <button className={btnSecondary} disabled={busy !== null} onClick={() => run("/cancel", "cancel", "¿Cancelar el conteo?")}>Cancelar conteo</button>}
        {editable && <button className={btnSecondary} disabled={busy !== null} onClick={save}>{busy === "save" && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar avance</button>}
        {editable && <button className={btnPrimary} disabled={busy !== null} onClick={() => run("/submit", "submit")}>{busy === "submit" && <Loader2 className="size-4 animate-spin" aria-hidden />} Enviar a revisión</button>}
        {canApprove && c.status === "SUBMITTED" && <button className={btnSecondary} disabled={busy !== null} onClick={() => run("/reopen", "reopen")}>Devolver para recontar</button>}
        {canApprove && c.status === "SUBMITTED" && <button className={btnPrimary} disabled={busy !== null} onClick={() => run("/apply", "apply", "¿Aplicar las diferencias al inventario? Se registrarán como ajustes y no se pueden borrar.")}>{busy === "apply" && <Loader2 className="size-4 animate-spin" aria-hidden />} Aprobar y aplicar</button>}
      </div>
    </div>
  );
}
