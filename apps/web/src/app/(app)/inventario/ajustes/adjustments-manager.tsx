"use client";

import type { AdjustmentSummary, LotBalanceRow } from "@erp/contracts";
import { ClipboardList, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

interface Wh { id: string; code: string; name: string }
interface Line { key: number; product: PickedProduct | null; dir: "IN" | "OUT"; quantity: string; unitCost: string; lotId: string; lotCode: string; expiresOn: string; lots: LotBalanceRow[] }

export function AdjustmentsManager({ adjustments, warehouses }: { adjustments: AdjustmentSummary[]; warehouses: Wh[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Ajustes recientes</h2>
          <button className={btnPrimary} onClick={() => setOpen(true)} disabled={warehouses.length === 0}><Plus className="size-4" aria-hidden /> Nuevo ajuste</button>
        </div>
        {adjustments.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Aún no hay ajustes" description={warehouses.length === 0 ? "Crea primero un almacén en «Almacenes y valoración»." : "Usa «Nuevo ajuste» para cargar el stock inicial o corregir diferencias."} />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Código</th><th className="px-3 font-medium">Fecha</th><th className="px-3 font-medium">Almacén</th><th className="px-3 font-medium">Motivo</th><th className="px-5 font-medium">Detalle</th></tr></thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id} className="border-b border-line-strong/40 align-top text-body hover:bg-surface-muted">
                    <td className="px-5 py-3 font-medium text-ink">{a.code}</td>
                    <td className="px-3 py-3" suppressHydrationWarning>{new Date(a.createdAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3 py-3">{a.warehouse.code}</td>
                    <td className="px-3 py-3">{a.reason}{a.note && <span className="block text-xs text-ink-3">{a.note}</span>}</td>
                    <td className="px-5 py-3 text-xs tabular-nums">
                      {a.lines.map((l, i) => <div key={i}>{l.productCode}{l.lotCode ? ` · ${l.lotCode}` : ""}: <span className={Number(l.quantity) < 0 ? "text-danger" : "text-success"}>{Number(l.quantity) > 0 ? "+" : ""}{num(l.quantity)}</span> @ {money(l.unitCost, 4)}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo ajuste de inventario" size="lg">
        {open && <AdjustmentForm warehouses={warehouses} onDone={() => { setOpen(false); router.refresh(); }} onCancel={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

let seq = 0;
const blank = (): Line => ({ key: ++seq, product: null, dir: "IN", quantity: "", unitCost: "", lotId: "", lotCode: "", expiresOn: "", lots: [] });

function AdjustmentForm({ warehouses, onDone, onCancel }: { warehouses: Wh[]; onDone: () => void; onCancel: () => void }) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  // Lotes disponibles para las líneas de salida (selección manual opcional).
  useEffect(() => {
    for (const l of lines) {
      if (l.product && l.dir === "OUT" && l.lots.length === 0 && l.product.trackLots) {
        void bff<LotBalanceRow[]>(`/bff/api/inventory/stock/lots?${new URLSearchParams({ productId: l.product.id, warehouseId })}`, "GET").then((r) => r.ok && patch(l.key, { lots: r.data }));
      }
    }
  }, [lines.map((l) => `${l.product?.id}:${l.dir}`).join("|"), warehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (lines.some((l) => !l.product)) return setError("Elige el producto en todas las líneas.");
    setBusy(true);
    const body = {
      warehouseId, reason,
      lines: lines.map((l) => {
        const q = Number(l.quantity);
        return l.dir === "IN"
          ? { productId: l.product!.id, quantity: q, unitCost: Number(l.unitCost), ...(l.lotCode.trim() || l.expiresOn ? { lot: { ...(l.lotCode.trim() ? { code: l.lotCode.trim() } : {}), ...(l.expiresOn ? { expiresOn: l.expiresOn } : {}) } } : {}) }
          : { productId: l.product!.id, quantity: -q, ...(l.lotId ? { lotId: l.lotId } : {}) };
      }),
    };
    const r = await bff("/bff/api/inventory/adjustments", "POST", body);
    setBusy(false);
    if (r.ok) return onDone();
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa los datos: cantidades distintas de cero y costos sin negativos.");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Almacén"><select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
        <Field label="Motivo"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Carga inicial, merma, conteo físico…" required minLength={3} maxLength={120} /></Field>
      </div>

      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-3 rounded-lg border border-line p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1"><ProductPicker value={l.product} onChange={(p) => patch(l.key, { product: p, lots: [], lotId: "" })} goodsOnly /></div>
              <button type="button" className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar línea ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
            </div>
            {l.product && (
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Operación">
                  <select className={inputCls} value={l.dir} onChange={(e) => patch(l.key, { dir: e.target.value as "IN" | "OUT", lotId: "" })} aria-label={`Operación, línea ${i + 1}`}>
                    <option value="IN">Sumar stock</option><option value="OUT">Descontar stock</option>
                  </select>
                </Field>
                <Field label={`Cantidad (${l.product.unit})`}><input type="number" step="any" min="0" className={inputCls} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} required aria-label={`Cantidad, línea ${i + 1}`} /></Field>
                {l.dir === "IN" ? (
                  <>
                    <Field label="Costo unitario"><input type="number" step="any" min="0" className={inputCls} value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} required aria-label={`Costo, línea ${i + 1}`} /></Field>
                    {l.product.trackLots && <Field label="Código de lote (opcional)"><input className={inputCls} value={l.lotCode} onChange={(e) => patch(l.key, { lotCode: e.target.value })} maxLength={40} /></Field>}
                    {l.product.trackExpiry && <Field label="Vencimiento"><input type="date" className={inputCls} value={l.expiresOn} onChange={(e) => patch(l.key, { expiresOn: e.target.value })} required /></Field>}
                  </>
                ) : l.product.trackLots ? (
                  <Field label="Lote" hint="Automático según el método de valoración.">
                    <select className={inputCls} value={l.lotId} onChange={(e) => patch(l.key, { lotId: e.target.value })}>
                      <option value="">Automático</option>
                      {l.lots.map((x) => <option key={x.lotId} value={x.lotId}>{x.lotCode} · disp. {num(x.availableQty)}{x.expiresOn ? ` · vence ${x.expiresOn}` : ""}</option>)}
                    </select>
                  </Field>
                ) : null}
              </div>
            )}
          </div>
        ))}
        <div><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="size-3.5" aria-hidden /> Agregar línea</button></div>
      </div>

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Aplicar ajuste</button>
      </div>
    </form>
  );
}
