"use client";

import type { ReservationView } from "@erp/contracts";
import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const STATUS: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = {
  ACTIVE: ["Vigente", "info"], RELEASED: ["Liberada", "neutral"], CONSUMED: ["Consumida", "success"], EXPIRED: ["Vencida", "warning"],
};
interface Wh { id: string; code: string; name: string }

export function ReservationsManager({ reservations, warehouses, canReserve }: { reservations: ReservationView[]; warehouses: Wh[]; canReserve: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function release(r: ReservationView) {
    if (!window.confirm(`¿Liberar la reserva ${r.code}? Lo apartado volverá a estar disponible.`)) return;
    setError(null);
    const res = await bff(`/bff/api/inventory/reservations/${r.id}/release`, "POST");
    if (!res.ok) return setError(errorText(res));
    router.refresh();
  }

  return (
    <>
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Reservas</h2>
          {canReserve && <button className={btnPrimary} onClick={() => setCreating(true)} disabled={warehouses.length === 0}><Plus className="size-4" aria-hidden /> Nueva reserva</button>}
        </div>
        {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
        {reservations.length === 0 ? (
          <EmptyState icon={Lock} title="Aún no hay reservas" description="Se crean desde aquí o con «Reservar stock» en una cotización enviada o aceptada." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Reserva</th><th className="px-3 font-medium">Almacén</th><th className="px-3 font-medium">Detalle</th><th className="px-3 font-medium">Vence</th><th className="px-3 font-medium">Estado</th>{canReserve && <th className="px-5" />}</tr></thead>
              <tbody>
                {reservations.map((r) => (
                  <tr key={r.id} className="border-b border-line-strong/40 align-top text-body hover:bg-surface-muted">
                    <td className="px-5 py-3 font-medium text-ink">{r.code}{r.sourceType === "QUOTE" && <span className="block text-xs font-normal text-ink-3">de cotización</span>}{r.note && r.sourceType !== "QUOTE" && <span className="block text-xs font-normal text-ink-3">{r.note}</span>}</td>
                    <td className="px-3 py-3">{r.warehouse.code}</td>
                    <td className="px-3 py-3 text-xs tabular-nums">{r.lines.map((l, i) => <div key={i}>{l.productCode} · {l.lotCode}: {num(l.quantity)}</div>)}</td>
                    <td className="px-3 py-3" suppressHydrationWarning>{new Date(r.expiresAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3 py-3"><StatusBadge tone={STATUS[r.status]![1]}>{STATUS[r.status]![0]}</StatusBadge></td>
                    {canReserve && <td className="px-5 py-3 text-right">{r.status === "ACTIVE" && <button className={`${btnSecondary} h-8 px-3`} onClick={() => release(r)}>Liberar</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva reserva" size="lg">
        {creating && <ReservationForm warehouses={warehouses} onDone={() => { setCreating(false); router.refresh(); }} onCancel={() => setCreating(false)} />}
      </Modal>
    </>
  );
}

interface FLine { key: number; product: PickedProduct | null; quantity: string }
let seq = 0;

function ReservationForm({ warehouses, onDone, onCancel }: { warehouses: Wh[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ warehouseId: warehouses[0]?.id ?? "", hours: "48", note: "" });
  const [lines, setLines] = useState<FLine[]>([{ key: ++seq, product: null, quantity: "1" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: number, p: Partial<FLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (lines.some((l) => !l.product)) return setError("Elige el producto en todas las líneas.");
    setBusy(true);
    const r = await bff("/bff/api/inventory/reservations", "POST", { warehouseId: f.warehouseId, hours: Number(f.hours), ...(f.note.trim() ? { note: f.note.trim() } : {}), lines: lines.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity) })) });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Almacén"><select className={inputCls} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
        <Field label="Vigencia (horas)" hint="Al vencer se libera sola."><input type="number" min={1} max={720} className={inputCls} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} aria-label="Horas de reserva" /></Field>
        <Field label="Nota (opcional)"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></Field>
      </div>
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_140px_36px] sm:items-end">
            <Field label={`Producto ${i + 1}`}><ProductPicker value={l.product} onChange={(p) => patch(l.key, { product: p })} goodsOnly /></Field>
            <Field label={`Cantidad${l.product ? ` (${l.product.unit})` : ""}`}><input type="number" step="any" min="0" className={inputCls} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} required aria-label={`Cantidad, línea ${i + 1}`} /></Field>
            <button type="button" className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar línea ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
          </div>
        ))}
        <div><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setLines((ls) => [...ls, { key: ++seq, product: null, quantity: "1" }])}><Plus className="size-3.5" aria-hidden /> Agregar línea</button></div>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Reservar</button>
      </div>
    </form>
  );
}
