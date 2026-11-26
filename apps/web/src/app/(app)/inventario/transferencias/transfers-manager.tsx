"use client";

import type { TransferSummary } from "@erp/contracts";
import { ArrowLeftRight, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const STATUS: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = {
  DRAFT: ["Borrador", "neutral"], IN_TRANSIT: ["En tránsito", "warning"], RECEIVED: ["Recibida", "success"], CANCELLED: ["Cancelada", "danger"],
};
interface Wh { id: string; code: string; name: string }

export function TransfersManager({ transfers, warehouses, canTransfer }: { transfers: TransferSummary[]; warehouses: Wh[]; canTransfer: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<TransferSummary | null>(null);
  const refresh = () => router.refresh();

  return (
    <>
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Transferencias</h2>
          {canTransfer && <button className={btnPrimary} onClick={() => setCreating(true)} disabled={warehouses.length < 2}><Plus className="size-4" aria-hidden /> Nueva transferencia</button>}
        </div>
        {canTransfer && warehouses.length < 2 && <p className="mb-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-body">Para transferir necesitas al menos dos almacenes activos. Créalos en «Almacenes y valoración».</p>}
        {transfers.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="Aún no hay transferencias" description="Crea una con «Nueva transferencia»; se despacha desde el origen y se recibe en el destino." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Código</th><th className="px-3 font-medium">Origen → Destino</th><th className="px-3 font-medium">Productos</th><th className="px-3 font-medium">Fecha</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">{t.code}</td>
                    <td className="px-3">{t.from.code} → {t.to.code}</td>
                    <td className="px-3 text-ink-2">{t.lines.length} producto(s)</td>
                    <td className="px-3 text-ink-2" suppressHydrationWarning>{new Date(t.createdAt).toLocaleDateString("es-BO")}</td>
                    <td className="px-3"><StatusBadge tone={STATUS[t.status]![1]}>{STATUS[t.status]![0]}</StatusBadge></td>
                    <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpen(t)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva transferencia" size="lg">
        {creating && <TransferForm warehouses={warehouses} onDone={(t) => { setCreating(false); refresh(); setOpen(t); }} onCancel={() => setCreating(false)} />}
      </Modal>
      <Modal open={open !== null} onClose={() => setOpen(null)} title="Transferencia" size="lg">
        {open && <TransferDetail key={open.id + open.status} initial={open} canTransfer={canTransfer} onChanged={(t) => { setOpen(t); refresh(); }} onClose={() => setOpen(null)} />}
      </Modal>
    </>
  );
}

function TransferDetail({ initial, canTransfer, onChanged, onClose }: { initial: TransferSummary; canTransfer: boolean; onChanged: (t: TransferSummary) => void; onClose: () => void }) {
  const t = initial;
  const [receiving, setReceiving] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(t.lines.map((l) => [l.id, String(Number(l.quantity))])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shortfall = t.lines.some((l) => Number(qty[l.id] ?? l.quantity) < Number(l.quantity));

  async function act(action: "dispatch" | "cancel" | "receive") {
    setBusy(action); setError(null);
    const body = action === "receive" ? { lines: t.lines.map((l) => ({ lineId: l.id, receivedQty: Number(qty[l.id] ?? l.quantity) })), ...(note.trim() ? { note: note.trim() } : {}) } : undefined;
    const r = await bff<TransferSummary>(`/bff/api/inventory/transfers/${t.id}/${action}`, "POST", body);
    setBusy(null);
    if (!r.ok) return setError(r.data.code === "INSUFFICIENT_STOCK" ? errorText(r) : errorText(r));
    onChanged(r.data);
  }

  const [label, tone] = STATUS[t.status]!;
  return (
    <div className="grid gap-5" data-testid="transfer-detail">
      <div>
        <h3 className="text-lg font-semibold text-ink">{t.code} <StatusBadge tone={tone}>{label}</StatusBadge></h3>
        <p className="mt-1 text-[13px] text-ink-2">{t.from.name} ({t.from.code}) → {t.to.name} ({t.to.code})</p>
        {t.note && <p className="mt-1 text-[13px] text-ink-3">{t.note}</p>}
      </div>
      <table className="w-full text-left text-[13px]">
        <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Producto</th><th className="text-right font-medium">Cantidad</th><th className="text-right font-medium">Recibido</th><th className="font-medium">Lotes</th></tr></thead>
        <tbody className="tabular-nums">
          {t.lines.map((l) => (
            <tr key={l.id} className="border-b border-line-strong/40 align-top">
              <td className="py-2"><span className="font-medium text-ink">{l.productName}</span> <span className="text-ink-3">{l.productCode}</span></td>
              <td className="py-2 text-right">{receiving ? (
                <span>{num(l.quantity)} {l.unit}</span>
              ) : <span>{num(l.quantity)} {l.unit}</span>}</td>
              <td className="py-2 text-right">{receiving ? (
                <input type="number" step="any" min="0" max={Number(l.quantity)} className={`${inputCls} h-8 w-24 text-right`} value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={`Recibido, ${l.productCode}`} />
              ) : num(l.receivedQty)}</td>
              <td className="py-2 pl-3 text-xs">{l.lots.length === 0 ? <span className="text-ink-3">Se asignan al despachar</span> : l.lots.map((x, i) => <div key={i}>{x.lotCode}: {num(x.quantity)} @ {money(x.unitCost, 4)}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {receiving && shortfall && <Field label="Motivo de la diferencia (obligatorio)" hint="Lo que no llegó se da de baja como pérdida en tránsito."><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button className={btnSecondary} onClick={receiving ? () => setReceiving(false) : onClose}>{receiving ? "Volver" : "Cerrar"}</button>
        {canTransfer && (t.status === "DRAFT" || t.status === "IN_TRANSIT") && !receiving && <button className={btnSecondary} disabled={busy !== null} onClick={() => { if (window.confirm(t.status === "IN_TRANSIT" ? "¿Cancelar? La mercadería en tránsito volverá al origen." : "¿Cancelar la transferencia?")) void act("cancel"); }}>Cancelar transferencia</button>}
        {canTransfer && t.status === "DRAFT" && <button className={btnPrimary} disabled={busy !== null} onClick={() => act("dispatch")}>{busy === "dispatch" && <Loader2 className="size-4 animate-spin" aria-hidden />} Despachar</button>}
        {canTransfer && t.status === "IN_TRANSIT" && !receiving && <button className={btnPrimary} onClick={() => setReceiving(true)}>Recibir</button>}
        {canTransfer && receiving && <button className={btnPrimary} disabled={busy !== null} onClick={() => act("receive")}>{busy === "receive" && <Loader2 className="size-4 animate-spin" aria-hidden />} Confirmar recepción</button>}
      </div>
    </div>
  );
}

interface FLine { key: number; product: PickedProduct | null; quantity: string }
let seq = 0;

function TransferForm({ warehouses, onDone, onCancel }: { warehouses: Wh[]; onDone: (t: TransferSummary) => void; onCancel: () => void }) {
  const [f, setF] = useState({ from: warehouses[0]?.id ?? "", to: warehouses[1]?.id ?? "", note: "" });
  const [lines, setLines] = useState<FLine[]>([{ key: ++seq, product: null, quantity: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: number, p: Partial<FLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.from === f.to) return setError("El origen y el destino deben ser distintos.");
    if (lines.some((l) => !l.product)) return setError("Elige el producto en todas las líneas.");
    setBusy(true);
    const r = await bff<TransferSummary>("/bff/api/inventory/transfers", "POST", { fromWarehouseId: f.from, toWarehouseId: f.to, ...(f.note.trim() ? { note: f.note.trim() } : {}), lines: lines.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity) })) });
    setBusy(false);
    if (r.ok) return onDone(r.data);
    setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Almacén de origen"><select className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
        <Field label="Almacén de destino"><select className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
        <Field label="Nota (opcional)" className="sm:col-span-2"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} /></Field>
      </div>
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_140px_36px] sm:items-end">
            <Field label={`Producto ${i + 1}`}><ProductPicker value={l.product} onChange={(p) => patch(l.key, { product: p })} goodsOnly /></Field>
            <Field label={`Cantidad${l.product ? ` (${l.product.unit})` : ""}`}><input type="number" step="any" min="0" className={inputCls} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} required aria-label={`Cantidad, línea ${i + 1}`} /></Field>
            <button type="button" className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar línea ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
          </div>
        ))}
        <div><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setLines((ls) => [...ls, { key: ++seq, product: null, quantity: "" }])}><Plus className="size-3.5" aria-hidden /> Agregar línea</button></div>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Crear borrador</button>
      </div>
    </form>
  );
}
