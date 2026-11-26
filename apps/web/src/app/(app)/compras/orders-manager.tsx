"use client";

import { PrintButton } from "@/components/print-button";
import type { PurchaseOrderDetail, PurchaseOrderSummary } from "@erp/contracts";
import { Loader2, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { MissingSetup } from "@/components/missing-setup";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const STATUS: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = {
  DRAFT: ["Borrador", "neutral"], ISSUED: ["Emitida", "info"], PARTIALLY_RECEIVED: ["Recibida parcial", "warning"], RECEIVED: ["Recibida", "success"], CANCELLED: ["Cancelada", "danger"],
};
interface Opt { id: string; code: string; name: string }
interface Props { orders: PurchaseOrderSummary[]; suppliers: Opt[]; warehouses: Opt[]; status: string; canManage: boolean; canReceive: boolean }

export function OrdersManager({ orders, suppliers, warehouses, status, canManage, canReceive }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const compact = inputCls.replace("w-full ", "");
  const refresh = () => router.refresh();

  return (
    <>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <select aria-label="Estado" className={`${compact} w-[200px]`} value={status} onChange={(e) => router.push(e.target.value ? `/compras?status=${e.target.value}` : "/compras")}>
              <option value="">Todos los estados</option>
              {Object.entries(STATUS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {status && <Link href="/compras" className="text-[13px] text-brand hover:underline">Limpiar</Link>}
          </div>
          {canManage && <button className={btnPrimary} onClick={() => setCreating(true)} disabled={suppliers.length === 0 || warehouses.length === 0}><Plus className="size-4" aria-hidden /> Nueva orden</button>}
        </div>
        {canManage && <MissingSetup suppliers={suppliers.length} warehouses={warehouses.length} />}
        {orders.length === 0 ? (
          <EmptyState icon={ShoppingBag} title={status ? "Sin resultados" : "Aún no hay órdenes de compra"} description={status ? "Prueba con otro estado." : "Crea la primera con «Nueva orden»."} />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Orden</th><th className="px-3 font-medium">Proveedor</th><th className="px-3 font-medium">Destino</th><th className="px-3 font-medium">Esperada</th><th className="px-3 text-right font-medium">Total</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">{o.code}</td>
                    <td className="px-3">{o.supplier.name}</td><td className="px-3">{o.warehouse.code}</td>
                    <td className="px-3 text-ink-2">{o.expectedOn ?? "—"}</td>
                    <td className="px-3 text-right tabular-nums">{money(o.total)} <span className="text-ink-3">{o.currency}</span></td>
                    <td className="px-3"><StatusBadge tone={STATUS[o.status]![1]}>{STATUS[o.status]![0]}</StatusBadge></td>
                    <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpenId(o.id)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva orden de compra" size="lg">
        {creating && <OrderForm order={null} suppliers={suppliers} warehouses={warehouses} onDone={(id) => { setCreating(false); refresh(); if (id) setOpenId(id); }} onCancel={() => setCreating(false)} />}
      </Modal>
      <Modal open={openId !== null} onClose={() => setOpenId(null)} title="Orden de compra" size="lg">
        {openId && <OrderDetail key={openId} id={openId} suppliers={suppliers} warehouses={warehouses} canManage={canManage} canReceive={canReceive} onChanged={refresh} onClose={() => setOpenId(null)} />}
      </Modal>
    </>
  );
}

// ───────────── Detalle y acciones ─────────────

function OrderDetail({ id, suppliers, warehouses, canManage, canReceive, onChanged, onClose }: {
  id: string; suppliers: Opt[]; warehouses: Opt[]; canManage: boolean; canReceive: boolean; onChanged: () => void; onClose: () => void;
}) {
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "receive">("view");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const r = await bff<PurchaseOrderDetail>(`/bff/api/purchasing/orders/${id}`, "GET");
    if (r.ok) setOrder(r.data); else setError(errorText(r));
  };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: "issue" | "cancel" | "close", confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action); setError(null);
    const r = await bff<PurchaseOrderDetail>(`/bff/api/purchasing/orders/${id}/${action}`, "POST");
    setBusy(null);
    if (!r.ok) return setError(errorText(r));
    setOrder(r.data); onChanged();
  }

  if (!order) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-ink-2">Cargando…</p>;
  const [label, tone] = STATUS[order.status]!;
  const canReceiveNow = canReceive && (order.status === "ISSUED" || order.status === "PARTIALLY_RECEIVED");

  if (mode === "edit") {
    return <OrderForm order={order} suppliers={suppliers} warehouses={warehouses} onDone={() => { setMode("view"); void load(); onChanged(); }} onCancel={() => setMode("view")} />;
  }
  if (mode === "receive") {
    return <ReceiveForm order={order} onDone={() => { setMode("view"); void load(); onChanged(); }} onCancel={() => setMode("view")} />;
  }

  return (
    <div className="grid gap-5" data-testid="order-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">{order.code} <StatusBadge tone={tone}>{label}</StatusBadge></h3>
          <p className="mt-1 text-[13px] text-ink-2">{order.supplier.name} → {order.warehouse.name} ({order.warehouse.code}){order.expectedOn ? ` · esperada ${order.expectedOn}` : ""}</p>
          {order.note && <p className="mt-1 text-[13px] text-ink-3">{order.note}</p>}
        </div>
        <p className="text-right text-[13px] text-ink-2">Total<span className="block text-lg font-semibold tabular-nums text-ink">{money(order.total)} {order.currency}</span></p>
      </div>

      <table className="w-full text-left text-[13px]">
        <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Producto</th><th className="text-right font-medium">Pedido</th><th className="text-right font-medium">Recibido</th><th className="text-right font-medium">Pendiente</th><th className="text-right font-medium">Costo unit.</th></tr></thead>
        <tbody className="tabular-nums">
          {order.lines.map((l) => (
            <tr key={l.id} className="h-10 border-b border-line-strong/40">
              <td><span className="font-medium text-ink">{l.productName}</span> <span className="text-ink-3">{l.productCode}</span></td>
              <td className="text-right">{num(l.quantity)} {l.unit}</td><td className="text-right">{num(l.receivedQty)}</td>
              <td className={`text-right ${Number(l.pendingQty) > 0 ? "font-medium text-ink" : "text-ink-3"}`}>{num(l.pendingQty)}</td><td className="text-right">{money(l.unitCost, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {order.receipts.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Recepciones</h4>
          <ul className="grid gap-1 text-[13px]">{order.receipts.map((r) => <li key={r.id}>{r.code} · {new Date(r.createdAt).toLocaleDateString("es-BO")} {r.status === "VOIDED" && <span className="text-danger">(anulada)</span>}</li>)}</ul>
        </div>
      )}

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button className={btnSecondary} onClick={onClose}>Cerrar</button>
        {order.status !== "DRAFT" && <PrintButton docType="PURCHASE_ORDER" id={id} />}
        {canManage && order.status === "DRAFT" && <button className={btnSecondary} onClick={() => setMode("edit")}>Editar</button>}
        {canManage && (order.status === "DRAFT" || order.status === "ISSUED") && <button className={btnSecondary} onClick={() => act("cancel", `¿Cancelar la orden ${order.code}?`)} disabled={busy !== null}>Cancelar orden</button>}
        {canManage && order.status === "PARTIALLY_RECEIVED" && <button className={btnSecondary} onClick={() => act("close", "¿Dar por terminada la orden? Lo pendiente ya no se esperará.")} disabled={busy !== null}>Cerrar orden</button>}
        {canManage && order.status === "DRAFT" && <button className={btnPrimary} onClick={() => act("issue")} disabled={busy !== null}>{busy === "issue" && <Loader2 className="size-4 animate-spin" aria-hidden />} Emitir</button>}
        {canReceiveNow && <button className={btnPrimary} onClick={() => setMode("receive")}>Recibir mercadería</button>}
      </div>
    </div>
  );
}

// ───────────── Recepción contra la orden ─────────────

interface RecvLine { lineId: string; quantity: string; lotCode: string; expiresOn: string }

function ReceiveForm({ order, onDone, onCancel }: { order: PurchaseOrderDetail; onDone: () => void; onCancel: () => void }) {
  const pendingLines = order.lines.filter((l) => Number(l.pendingQty) > 0);
  const [rows, setRows] = useState<RecvLine[]>(pendingLines.map((l) => ({ lineId: l.id, quantity: String(Number(l.pendingQty)), lotCode: "", expiresOn: "" })));
  const [supplierRef, setSupplierRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, p: Partial<RecvLine>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const lines = rows.map((r, i) => ({ r, l: pendingLines[i]! })).filter(({ r }) => Number(r.quantity) > 0).map(({ r, l }) => ({
      orderLineId: l.id, quantity: Number(r.quantity),
      ...(r.lotCode.trim() || r.expiresOn ? { lot: { ...(r.lotCode.trim() ? { code: r.lotCode.trim() } : {}), ...(r.expiresOn ? { expiresOn: r.expiresOn } : {}) } } : {}),
    }));
    if (lines.length === 0) return setError("Indica al menos una cantidad recibida.");
    setBusy(true);
    const r = await bff("/bff/api/purchasing/receipts", "POST", { orderId: order.id, ...(supplierRef.trim() ? { supplierRef: supplierRef.trim() } : {}), lines });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div>
        <h3 className="text-lg font-semibold text-ink">Recibir · {order.code}</h3>
        <p className="mt-1 text-[13px] text-ink-2">Indica lo que llegó. El costo es el de la orden. Si llegó menos, la orden queda parcialmente recibida.</p>
      </div>
      <Field label="Guía de remisión / factura del proveedor (opcional)"><input className={inputCls} value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} maxLength={60} /></Field>
      <div className="grid gap-3">
        {pendingLines.map((l, i) => (
          <div key={l.id} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_130px_150px_150px] sm:items-end">
            <div><span className="font-medium text-ink">{l.productName}</span><span className="block text-xs text-ink-3">{l.productCode} · pendiente {num(l.pendingQty)} {l.unit}</span></div>
            <Field label="Recibido"><input type="number" step="any" min="0" max={Number(l.pendingQty)} className={inputCls} value={rows[i]!.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-label={`Recibido, ${l.productCode}`} /></Field>
            {l.trackLots ? <Field label="Lote (opcional)"><input className={inputCls} value={rows[i]!.lotCode} onChange={(e) => set(i, { lotCode: e.target.value })} maxLength={40} aria-label={`Lote, ${l.productCode}`} /></Field> : <span />}
            {l.trackExpiry ? <Field label="Vencimiento"><input type="date" className={inputCls} value={rows[i]!.expiresOn} onChange={(e) => set(i, { expiresOn: e.target.value })} required={Number(rows[i]!.quantity) > 0} aria-label={`Vencimiento, ${l.productCode}`} /></Field> : <span />}
          </div>
        ))}
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Volver</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Registrar recepción</button>
      </div>
    </form>
  );
}

// ───────────── Alta / edición de la orden ─────────────

interface FLine { key: number; product: PickedProduct | null; quantity: string; unitCost: string }
let seq = 0;

function OrderForm({ order, suppliers, warehouses, onDone, onCancel }: {
  order: PurchaseOrderDetail | null; suppliers: Opt[]; warehouses: Opt[]; onDone: (id?: string) => void; onCancel: () => void;
}) {
  const [f, setF] = useState({ supplierId: order?.supplier.id ?? suppliers[0]?.id ?? "", warehouseId: order?.warehouse.id ?? warehouses[0]?.id ?? "", expectedOn: order?.expectedOn ?? "", note: order?.note ?? "" });
  const [lines, setLines] = useState<FLine[]>(
    order ? order.lines.map((l) => ({ key: ++seq, product: { id: l.productId, code: l.productCode, name: l.productName, unit: l.unit, trackLots: l.trackLots, trackExpiry: l.trackExpiry, kind: "GOODS", decimals: 6 }, quantity: String(Number(l.quantity)), unitCost: String(Number(l.unitCost)) })) : [{ key: ++seq, product: null, quantity: "", unitCost: "" }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: number, p: Partial<FLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (lines.some((l) => !l.product)) return setError("Elige el producto en todas las líneas.");
    setBusy(true);
    const body = {
      supplierId: f.supplierId, warehouseId: f.warehouseId, expectedOn: f.expectedOn || null, note: f.note || null,
      lines: lines.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
    };
    const r = order ? await bff(`/bff/api/purchasing/orders/${order.id}`, "PATCH", body) : await bff("/bff/api/purchasing/orders", "POST", body);
    setBusy(false);
    if (r.ok) return onDone(order ? undefined : String(r.data.id));
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa los datos: cantidades mayores que cero y costos sin negativos.");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Proveedor"><select className={inputCls} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></Field>
        <Field label="Almacén de destino"><select className={inputCls} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })} required>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
        <Field label="Fecha esperada"><input type="date" className={inputCls} value={f.expectedOn} onChange={(e) => setF({ ...f, expectedOn: e.target.value })} /></Field>
        <Field label="Nota"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} /></Field>
      </div>
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_120px_130px_36px] sm:items-end">
            <Field label={`Producto ${i + 1}`}><ProductPicker value={l.product} onChange={(p) => patch(l.key, { product: p })} goodsOnly /></Field>
            <Field label={`Cantidad${l.product ? ` (${l.product.unit})` : ""}`}><input type="number" step="any" min="0" className={inputCls} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} required aria-label={`Cantidad, línea ${i + 1}`} /></Field>
            <Field label="Costo unitario"><input type="number" step="any" min="0" className={inputCls} value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} required aria-label={`Costo, línea ${i + 1}`} /></Field>
            <button type="button" className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar línea ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setLines((ls) => [...ls, { key: ++seq, product: null, quantity: "", unitCost: "" }])}><Plus className="size-3.5" aria-hidden /> Agregar línea</button>
          <p className="text-[13px] text-ink-2">Total: <strong className="tabular-nums text-ink">{money(total)}</strong></p>
        </div>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {order ? "Guardar cambios" : "Crear borrador"}</button>
      </div>
    </form>
  );
}
