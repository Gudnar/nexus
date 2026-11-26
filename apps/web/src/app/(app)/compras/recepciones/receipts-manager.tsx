"use client";

import type { GoodsReceiptSummary } from "@erp/contracts";
import { Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { MissingSetup } from "@/components/missing-setup";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

interface Opt { id: string; code: string; name: string }

export function ReceiptsManager({ receipts, suppliers, warehouses, canReceive }: { receipts: GoodsReceiptSummary[]; suppliers: Opt[]; warehouses: Opt[]; canReceive: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<GoodsReceiptSummary | null>(null);

  return (
    <>
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Recepciones recientes</h2>
          {canReceive && <button className={btnPrimary} onClick={() => setCreating(true)} disabled={suppliers.length === 0 || warehouses.length === 0}><Plus className="size-4" aria-hidden /> Recepción directa</button>}
        </div>
        {canReceive && <MissingSetup suppliers={suppliers.length} warehouses={warehouses.length} />}
        {receipts.length === 0 ? (
          <EmptyState icon={PackageCheck} title="Aún no hay recepciones" description="Se crean al recibir una orden de compra, o con «Recepción directa» si no hubo orden." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Recepción</th><th className="px-3 font-medium">Fecha</th><th className="px-3 font-medium">Proveedor</th><th className="px-3 font-medium">Orden</th><th className="px-3 font-medium">Detalle</th><th className="px-3 text-right font-medium">Total</th><th className="px-3 font-medium">Estado</th>{canReceive && <th className="px-5" />}</tr></thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className="border-b border-line-strong/40 align-top text-body hover:bg-surface-muted">
                    <td className="px-5 py-3 font-medium text-ink">{r.code}{r.supplierRef && <span className="block text-xs font-normal text-ink-3">{r.supplierRef}</span>}</td>
                    <td className="px-3 py-3" suppressHydrationWarning>{new Date(r.createdAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3 py-3">{r.supplier.name}</td><td className="px-3 py-3 text-ink-2">{r.order?.code ?? "Directa"}</td>
                    <td className="px-3 py-3 text-xs tabular-nums">{r.lines.map((l, i) => <div key={i}>{l.productCode} · {l.lotCode}: {num(l.quantity)} @ {money(l.unitCost, 4)}</div>)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{money(r.total)}</td>
                    <td className="px-3 py-3"><StatusBadge tone={r.status === "POSTED" ? "success" : "danger"}>{r.status === "POSTED" ? "Vigente" : "Anulada"}</StatusBadge>{r.voidReason && <span className="mt-1 block text-xs text-ink-3">{r.voidReason}</span>}</td>
                    {canReceive && <td className="px-5 py-3 text-right">{r.status === "POSTED" && <button className={`${btnSecondary} h-8 px-3`} onClick={() => setVoiding(r)}>Anular</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Recepción directa (sin orden)" size="lg">
        {creating && <DirectForm suppliers={suppliers} warehouses={warehouses} onDone={() => { setCreating(false); router.refresh(); }} onCancel={() => setCreating(false)} />}
      </Modal>
      <Modal open={voiding !== null} onClose={() => setVoiding(null)} title="Anular recepción">
        {voiding && <VoidForm receipt={voiding} onDone={() => { setVoiding(null); router.refresh(); }} onCancel={() => setVoiding(null)} />}
      </Modal>
    </>
  );
}

function VoidForm({ receipt, onDone, onCancel }: { receipt: GoodsReceiptSummary; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff(`/bff/api/purchasing/receipts/${receipt.id}/void`, "POST", { reason });
    setBusy(false);
    if (r.ok) return onDone();
    setError(r.data.code === "INSUFFICIENT_STOCK" ? "No se puede anular: parte de lo recibido ya se usó. Corrígelo con un ajuste o una devolución." : errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-[13px] text-ink-2">Se sacará del inventario lo recibido en {receipt.code} (total {money(receipt.total)}) y, si venía de una orden, lo pendiente se restituye.</p>
      <Field label="Motivo"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} autoFocus /></Field>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Anular recepción</button>
      </div>
    </form>
  );
}

interface DLine { key: number; product: PickedProduct | null; quantity: string; unitCost: string; lotCode: string; expiresOn: string }
let seq = 0;
const blank = (): DLine => ({ key: ++seq, product: null, quantity: "", unitCost: "", lotCode: "", expiresOn: "" });

function DirectForm({ suppliers, warehouses, onDone, onCancel }: { suppliers: Opt[]; warehouses: Opt[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ supplierId: suppliers[0]?.id ?? "", warehouseId: warehouses[0]?.id ?? "", supplierRef: "" });
  const [lines, setLines] = useState<DLine[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: number, p: Partial<DLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (lines.some((l) => !l.product)) return setError("Elige el producto en todas las líneas.");
    setBusy(true);
    const r = await bff("/bff/api/purchasing/receipts", "POST", {
      supplierId: f.supplierId, warehouseId: f.warehouseId, ...(f.supplierRef.trim() ? { supplierRef: f.supplierRef.trim() } : {}),
      lines: lines.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity), unitCost: Number(l.unitCost), ...(l.lotCode.trim() || l.expiresOn ? { lot: { ...(l.lotCode.trim() ? { code: l.lotCode.trim() } : {}), ...(l.expiresOn ? { expiresOn: l.expiresOn } : {}) } } : {}) })),
    });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Proveedor"><select className={inputCls} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Almacén"><select className={inputCls} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
        <Field label="Guía / factura (opcional)"><input className={inputCls} value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} maxLength={60} /></Field>
      </div>
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-3 rounded-lg border border-line p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1"><ProductPicker value={l.product} onChange={(p) => patch(l.key, { product: p })} goodsOnly /></div>
              <button type="button" className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar línea ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
            </div>
            {l.product && (
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label={`Cantidad (${l.product.unit})`}><input type="number" step="any" min="0" className={inputCls} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} required aria-label={`Cantidad, línea ${i + 1}`} /></Field>
                <Field label="Costo unitario"><input type="number" step="any" min="0" className={inputCls} value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} required aria-label={`Costo, línea ${i + 1}`} /></Field>
                {l.product.trackLots && <Field label="Lote (opcional)"><input className={inputCls} value={l.lotCode} onChange={(e) => patch(l.key, { lotCode: e.target.value })} maxLength={40} /></Field>}
                {l.product.trackExpiry && <Field label="Vencimiento"><input type="date" className={inputCls} value={l.expiresOn} onChange={(e) => patch(l.key, { expiresOn: e.target.value })} required /></Field>}
              </div>
            )}
          </div>
        ))}
        <div><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="size-3.5" aria-hidden /> Agregar línea</button></div>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Registrar recepción</button>
      </div>
    </form>
  );
}
