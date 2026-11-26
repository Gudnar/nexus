"use client";

import type { PaymentMethod, SaleDetail, SaleSummary } from "@erp/contracts";
import { Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const STATUS: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = { DRAFT: ["Borrador", "neutral"], CONFIRMED: ["Confirmada", "success"], CANCELLED: ["Anulada", "danger"] };
const PAY: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = { UNPAID: ["Sin cobrar", "danger"], PARTIAL: ["Cobro parcial", "warning"], PAID: ["Cobrada", "success"] };
const METHODS: Record<PaymentMethod, string> = { CASH: "Efectivo", TRANSFER: "Transferencia", QR: "QR", CARD: "Tarjeta", CHEQUE: "Cheque" };
interface Opt { id: string; name: string; code: string }
export interface Can { create: boolean; confirm: boolean; collect: boolean; void: boolean; requestVoid: boolean; discount: boolean; return: boolean; override: boolean }

export function SalesManager({ sales, customers, warehouses, status, can }: { sales: SaleSummary[]; customers: Opt[]; warehouses: Opt[]; status: string; can: Can }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const compact = inputCls.replace("w-full ", "");
  return (
    <>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <select aria-label="Estado" className={`${compact} w-[190px]`} value={status} onChange={(e) => router.push(e.target.value ? `/ventas?status=${e.target.value}` : "/ventas")}>
              <option value="">Todas</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {status && <Link href="/ventas" className="text-[13px] text-brand hover:underline">Limpiar</Link>}
          </div>
          {can.create && <button className={btnPrimary} onClick={() => setCreating(true)} disabled={warehouses.length === 0}><Plus className="size-4" aria-hidden /> Nueva venta</button>}
        </div>
        {can.create && warehouses.length === 0 && <p className="mb-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-body">Para vender necesitas un almacén activo en tu sucursal. Se crea en Inventario → «Almacenes y valoración».</p>}
        {sales.length === 0 ? (
          <EmptyState icon={ShoppingCart} title={status ? "Sin resultados" : "Aún no hay ventas"} description={status ? "Prueba con otro estado." : "Crea la primera con «Nueva venta»."} />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Venta</th><th className="px-3 font-medium">Fecha</th><th className="px-3 font-medium">Cliente</th><th className="px-3 text-right font-medium">Total</th><th className="px-3 font-medium">Cobro</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">{s.code ?? <span className="font-normal text-ink-3">Borrador</span>}</td>
                    <td className="px-3 text-ink-2" suppressHydrationWarning>{new Date(s.confirmedAt ?? s.createdAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3">{s.customer?.name ?? <span className="text-ink-3">Consumidor final</span>}</td>
                    <td className="px-3 text-right tabular-nums">{money(s.total)} <span className="text-ink-3">{s.currency}</span></td>
                    <td className="px-3">{s.status === "CONFIRMED" ? <StatusBadge tone={PAY[s.paymentStatus]![1]}>{PAY[s.paymentStatus]![0]}</StatusBadge> : "—"}</td>
                    <td className="px-3"><StatusBadge tone={STATUS[s.status]![1]}>{STATUS[s.status]![0]}</StatusBadge></td>
                    <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpenId(s.id)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva venta" size="lg">
        {creating && <SaleForm customers={customers} warehouses={warehouses} canDiscount={can.discount} canOverride={can.override} onDone={(id) => { setCreating(false); router.refresh(); setOpenId(id); }} onCancel={() => setCreating(false)} />}
      </Modal>
      <Modal open={openId !== null} onClose={() => setOpenId(null)} title="Venta" size="lg">
        {openId && <SaleView key={openId} id={openId} can={can} onChanged={() => router.refresh()} onClose={() => setOpenId(null)} />}
      </Modal>
    </>
  );
}

// ───────────── Detalle y acciones ─────────────

export function SaleView({ id, can, onChanged, onClose, startMode = "view" }: { id: string; can: Can; onChanged: () => void; onClose: () => void; startMode?: "view" | "void" }) {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [mode, setMode] = useState<"view" | "confirm" | "collect" | "void" | "return">(startMode);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { const r = await bff<SaleDetail>(`/bff/api/sales/orders/${id}`, "GET"); if (r.ok) setSale(r.data); else setError(errorText(r)); };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (s: SaleDetail) => { setSale(s); setMode("view"); onChanged(); };

  async function discard() {
    if (!window.confirm("¿Descartar este borrador?")) return;
    setBusy("discard"); setError(null);
    const r = await bff<SaleDetail>(`/bff/api/sales/orders/${id}/discard`, "POST");
    setBusy(null);
    if (r.ok) done(r.data); else setError(errorText(r));
  }

  if (!sale) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-ink-2">Cargando…</p>;
  const [label, tone] = STATUS[sale.status]!;

  if (mode === "confirm") return <ConfirmForm sale={sale} onDone={done} onCancel={() => setMode("view")} />;
  if (mode === "collect") return <CollectForm sale={sale} onDone={done} onCancel={() => setMode("view")} />;
  if (mode === "void") return <VoidForm sale={sale} canExecute={can.void} onDone={done} onCancel={() => setMode("view")} />;
  if (mode === "return") return <ReturnForm sale={sale} onDone={done} onCancel={() => setMode("view")} />;
  const canReturnMore = sale.status === "CONFIRMED" && sale.lines.some((l) => Number(l.quantity) - Number(l.returnedQty ?? 0) > 0);

  return (
    <div className="grid gap-5" data-testid="sale-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">{sale.code ?? "Borrador"} <StatusBadge tone={tone}>{label}</StatusBadge> {sale.status === "CONFIRMED" && <StatusBadge tone={PAY[sale.paymentStatus]![1]}>{PAY[sale.paymentStatus]![0]}</StatusBadge>}</h3>
          <p className="mt-1 text-[13px] text-ink-2">{sale.customer ? `${sale.customer.name} (${sale.customer.code})` : "Consumidor final"} · {sale.warehouse.name}{sale.quote ? ` · desde ${sale.quote.code}` : ""}</p>
          {sale.note && <p className="mt-1 text-[13px] text-ink-3">{sale.note}</p>}
          {sale.cancelReason && sale.status === "CANCELLED" && <p className="mt-1 text-[13px] text-danger">Motivo: {sale.cancelReason}</p>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Producto</th><th className="text-right font-medium">Cant.</th><th className="text-right font-medium">P. lista</th><th className="text-right font-medium">Desc.</th><th className="text-right font-medium">Neto</th><th className="text-right font-medium">Impuestos</th><th className="text-right font-medium">Total</th></tr></thead>
          <tbody className="tabular-nums">
            {sale.lines.map((l) => (
              <tr key={l.id} className="h-11 border-b border-line-strong/40 align-top">
                <td className="py-2"><span className="font-medium text-ink">{l.productName}</span> <span className="text-ink-3">{l.productCode}</span>
                  {l.lots.length > 0 && <span className="block text-xs text-ink-3">Lotes: {l.lots.map((x) => `${x.lotCode} (${num(x.quantity)})`).join(", ")}</span>}</td>
                <td className="py-2 text-right">{num(l.quantity)} {l.unit}{Number(l.returnedQty ?? 0) > 0 && <span className="block text-xs text-warning">devuelto {num(l.returnedQty)}</span>}</td>
                <td className="py-2 text-right">{money(l.listUnitPrice, 4)}{l.appliedUnitPrice !== null && <span className="block text-xs text-warning" title={l.overrideReason ?? ""}>aplicado {money(l.appliedUnitPrice, 4)} · {l.overrideReason}</span>}</td>
                <td className="py-2 text-right">{Number(l.discountPct) > 0 ? `${num(l.discountPct)} %` : "—"}</td>
                <td className="py-2 text-right">{money(l.netAmount)}</td>
                <td className="py-2 text-right">{money(l.taxAmount)}{l.taxes.some((t) => t.exempt) && <span className="block text-xs text-warning">exento: {l.taxes.find((t) => t.exempt)?.exemptionReason}</span>}</td>
                <td className="py-2 text-right font-medium text-ink">{money(l.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid w-full max-w-[340px] grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[13px] tabular-nums">
        <dt className="text-ink-2">Neto</dt><dd className="text-right">{money(sale.netTotal)}</dd>
        <dt className="text-ink-2">Impuestos</dt><dd className="text-right">{money(sale.taxTotal)}</dd>
        {Number(sale.discountTotal) > 0 && <><dt className="text-ink-2">Descuentos otorgados</dt><dd className="text-right">{money(sale.discountTotal)}</dd></>}
        <dt className="border-t border-line pt-1.5 font-semibold text-ink">Total {sale.currency}</dt><dd className="border-t border-line pt-1.5 text-right text-[15px] font-semibold text-ink" data-testid="sale-total">{money(sale.total)}</dd>
        {Number(sale.returnedTotal) > 0 && <><dt className="text-ink-2">Devuelto</dt><dd className="text-right" data-testid="sale-returned">−{money(sale.returnedTotal)}</dd></>}
        {Number(sale.refundedTotal) > 0 && <><dt className="text-ink-2">Reintegrado</dt><dd className="text-right">{money(sale.refundedTotal)}</dd></>}
        {sale.status === "CONFIRMED" && <><dt className="text-ink-2">Cobrado</dt><dd className="text-right">{money(sale.paidTotal)}</dd><dt className="text-ink-2">Saldo</dt><dd className={`text-right font-medium ${Number(sale.balance) > 0 ? "text-warning" : ""}`} data-testid="sale-balance">{money(sale.balance)}</dd></>}
      </dl>

      {sale.payments.length > 0 && (
        <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Cobros</h4>
          <ul className="grid gap-1 text-[13px]">{sale.payments.map((p) => <li key={p.id}>{METHODS[p.method]} · {money(p.amount)}{p.reference ? ` · ${p.reference}` : ""} <span className="text-ink-3" suppressHydrationWarning>· {new Date(p.receivedAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</span></li>)}</ul>
        </div>
      )}

      {sale.returns.length > 0 && (
        <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Devoluciones</h4>
          <ul className="grid gap-1 text-[13px]" data-testid="sale-returns">{sale.returns.map((r) => <li key={r.id}>{r.code} · {money(r.total)}{Number(r.refundTotal) > 0 ? ` (reintegrado ${money(r.refundTotal)})` : ""} · {r.reason}</li>)}</ul>
        </div>
      )}

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button className={btnSecondary} onClick={onClose}>Cerrar</button>
        {sale.status !== "DRAFT" && <PrintButton docType="SALE_RECEIPT" id={sale.id} label="Imprimir recibo" />}
        {sale.status === "DRAFT" && can.create && <button className={btnSecondary} onClick={discard} disabled={busy !== null}>Descartar</button>}
        {sale.status === "DRAFT" && can.create && <Link href={`/punto-de-venta?venta=${sale.id}`} className={btnSecondary}>Editar en el punto de venta</Link>}
        {sale.status === "DRAFT" && can.confirm && <button className={btnPrimary} onClick={() => setMode("confirm")}>Confirmar y cobrar</button>}
        {sale.status === "CONFIRMED" && can.collect && Number(sale.balance) > 0 && <button className={btnPrimary} onClick={() => setMode("collect")}>Registrar cobro</button>}
        {canReturnMore && can.return && <button className={btnSecondary} onClick={() => setMode("return")}>Registrar devolución</button>}
        {sale.status === "CONFIRMED" && (can.void || can.requestVoid) && <button className={btnSecondary} onClick={() => setMode("void")}>{can.void ? "Anular venta" : "Pedir anulación"}</button>}
      </div>
    </div>
  );
}

interface PayRow { key: number; method: PaymentMethod; amount: string; reference: string }
let seq = 0;

function PaymentRows({ rows, setRows, total }: { rows: PayRow[]; setRows: (r: PayRow[]) => void; total: number }) {
  const paid = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const patch = (key: number, p: Partial<PayRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  return (
    <div className="grid gap-2">
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-[150px_1fr_1fr_36px] items-end gap-2">
          <select className={inputCls} value={r.method} onChange={(e) => patch(r.key, { method: e.target.value as PaymentMethod })} aria-label={`Método, cobro ${i + 1}`}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input type="number" step="any" min="0" className={inputCls} value={r.amount} onChange={(e) => patch(r.key, { amount: e.target.value })} placeholder="Importe" aria-label={`Importe, cobro ${i + 1}`} />
          <input className={inputCls} value={r.reference} onChange={(e) => patch(r.key, { reference: e.target.value })} placeholder="Referencia (opcional)" aria-label={`Referencia, cobro ${i + 1}`} maxLength={80} />
          <button type="button" className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Quitar cobro ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setRows([...rows, { key: ++seq, method: "CASH", amount: "", reference: "" }])}><Plus className="size-3.5" aria-hidden /> Agregar cobro</button>
        <p className="text-[13px] text-ink-2">Cobrado: <strong className="tabular-nums text-ink">{money(paid)}</strong> · {total - paid > 0.000001 ? <span className="text-warning">queda a crédito {money(total - paid)}</span> : "completo"}</p>
      </div>
    </div>
  );
}

function ConfirmForm({ sale, onDone, onCancel }: { sale: SaleDetail; onDone: (s: SaleDetail) => void; onCancel: () => void }) {
  const total = Number(sale.total);
  const [rows, setRows] = useState<PayRow[]>([{ key: ++seq, method: "CASH", amount: String(total), reference: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const payments = rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount), ...(r.reference.trim() ? { reference: r.reference.trim() } : {}) }));
    const r = await bff<SaleDetail>(`/bff/api/sales/orders/${sale.id}/confirm`, "POST", { payments });
    setBusy(false);
    if (r.ok) return onDone(r.data);
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-5">
      <div>
        <h3 className="text-lg font-semibold text-ink">Confirmar venta</h3>
        <p className="mt-1 text-[13px] text-ink-2">Total estimado <strong className="tabular-nums text-ink">{money(sale.total)} {sale.currency}</strong>. Se vuelve a calcular con el precio vigente, se descuenta el stock y se asigna el número de venta. Lo que no cobres ahora queda a crédito (requiere cliente).</p>
      </div>
      <PaymentRows rows={rows} setRows={setRows} total={total} />
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Volver</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Confirmar venta</button>
      </div>
    </form>
  );
}

function CollectForm({ sale, onDone, onCancel }: { sale: SaleDetail; onDone: (s: SaleDetail) => void; onCancel: () => void }) {
  const [f, setF] = useState({ method: "CASH" as PaymentMethod, amount: String(Number(sale.balance)), reference: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff<SaleDetail>(`/bff/api/sales/orders/${sale.id}/payments`, "POST", { method: f.method, amount: Number(f.amount), ...(f.reference.trim() ? { reference: f.reference.trim() } : {}) });
    setBusy(false);
    if (r.ok) return onDone(r.data);
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <h3 className="text-lg font-semibold text-ink">Registrar cobro · {sale.code}</h3>
      <p className="text-[13px] text-ink-2">Saldo pendiente: <strong className="tabular-nums text-ink">{money(sale.balance)}</strong></p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Método"><select className={inputCls} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Importe"><input type="number" step="any" min="0" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required aria-label="Importe del cobro" /></Field>
        <Field label="Referencia"><input className={inputCls} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} /></Field>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Volver</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Registrar cobro</button>
      </div>
    </form>
  );
}

function VoidForm({ sale, canExecute, onDone, onCancel }: { sale: SaleDetail; canExecute: boolean; onDone: (s: SaleDetail) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  async function requestApproval() {
    const a = await bff<{ code: string }>("/bff/api/approvals/requests", "POST", { eventType: "SALE_VOID", subjectId: sale.id, reason });
    setBusy(false);
    if (a.ok) return setRequested(a.data.code);
    setError(errorText(a));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    if (!canExecute) return requestApproval();
    const r = await bff<SaleDetail>(`/bff/api/sales/orders/${sale.id}/void`, "POST", { reason });
    if (r.ok) { setBusy(false); return onDone(r.data); }
    if (r.data.code === "APPROVAL_REQUIRED") return requestApproval(); // esta venta exige aprobación: se pide en lugar de ejecutar
    setBusy(false);
    setError(r.data.code === "HAS_PAYMENTS" ? "La venta tiene cobros registrados: hay que devolver el dinero antes de anularla." : errorText(r));
  }
  if (requested) {
    return (
      <div className="grid gap-4" data-testid="void-requested">
        <h3 className="text-lg font-semibold text-ink">Aprobación solicitada</h3>
        <p className="text-[13px] text-ink-2">Anular {sale.code} necesita la autorización de otra persona. Pediste la aprobación <strong>{requested}</strong>: se te avisará cuando la decidan y, si la aprueban, la venta se anula sola.</p>
        <div className="flex justify-end"><button className={btnSecondary} onClick={onCancel}>Entendido</button></div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <h3 className="text-lg font-semibold text-ink">{canExecute ? "Anular" : "Pedir la anulación de"} {sale.code}</h3>
      <p className="text-[13px] text-ink-2">El stock vuelve a su lote y costo originales. La venta no se borra: queda anulada con el motivo y tu usuario.</p>
      <Field label="Motivo"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} autoFocus /></Field>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Volver</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {canExecute ? "Anular venta" : "Pedir anulación"}</button>
      </div>
    </form>
  );
}

// ───────────── Nueva venta ─────────────

interface FLine { key: number; product: PickedProduct | null; quantity: string; discount: string; price: string; reason: string }
let lseq = 0;

function SaleForm({ customers, warehouses, canDiscount, canOverride, onDone, onCancel }: { customers: Opt[]; warehouses: Opt[]; canDiscount: boolean; canOverride: boolean; onDone: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ warehouseId: warehouses[0]?.id ?? "", customerId: "", note: "" });
  const [lines, setLines] = useState<FLine[]>([{ key: ++lseq, product: null, quantity: "1", discount: "", price: "", reason: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: number, p: Partial<FLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (lines.some((l) => !l.product)) return setError("Elige el producto en todas las líneas.");
    setBusy(true);
    const r = await bff<SaleDetail>("/bff/api/sales/orders", "POST", {
      warehouseId: f.warehouseId, customerId: f.customerId || null, ...(f.note.trim() ? { note: f.note.trim() } : {}),
      lines: lines.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity), ...(canDiscount && Number(l.discount) > 0 ? { discountPct: Number(l.discount) } : {}), ...(canOverride && l.price.trim() !== "" ? { unitPrice: Number(l.price), overrideReason: l.reason.trim() } : {}) })),
    });
    setBusy(false);
    if (r.ok) return onDone(r.data.id);
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa los datos: un precio cambiado a mano necesita su motivo (mínimo 3 letras).");
    else if (r.status === 404) setError("Alguno de los productos no tiene precio vigente. Asígnalo en «Listas de precios».");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Almacén"><select className={inputCls} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
        <Field label="Cliente"><select className={inputCls} value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Consumidor final</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select></Field>
        <Field label="Nota (opcional)"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} /></Field>
      </div>
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={l.key} className={`grid gap-3 rounded-lg border border-line p-3 ${canDiscount ? "sm:grid-cols-[1fr_110px_110px_36px]" : "sm:grid-cols-[1fr_130px_36px]"} sm:items-end`}>
            <Field label={`Producto ${i + 1}`}><ProductPicker value={l.product} onChange={(p) => patch(l.key, { product: p })} /></Field>
            <Field label={`Cantidad${l.product ? ` (${l.product.unit})` : ""}`}><input type="number" step="any" min="0" className={inputCls} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} required aria-label={`Cantidad, línea ${i + 1}`} /></Field>
            {canDiscount && <Field label="Desc. %"><input type="number" step="any" min="0" max="100" className={inputCls} value={l.discount} onChange={(e) => patch(l.key, { discount: e.target.value })} aria-label={`Descuento, línea ${i + 1}`} /></Field>}
            <button type="button" className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar línea ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
            {canOverride && l.product && (
              <div className="grid gap-3 sm:col-span-full sm:grid-cols-[150px_1fr]">
                <Field label="Precio unitario distinto (opcional)"><input type="number" step="any" min="0" className={inputCls} value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} aria-label={`Precio, línea ${i + 1}`} /></Field>
                {l.price.trim() !== "" && <Field label="Motivo del cambio de precio"><input className={inputCls} value={l.reason} onChange={(e) => patch(l.key, { reason: e.target.value })} required minLength={3} maxLength={200} aria-label={`Motivo del precio, línea ${i + 1}`} /></Field>}
              </div>
            )}
          </div>
        ))}
        <div><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setLines((ls) => [...ls, { key: ++lseq, product: null, quantity: "1", discount: "", price: "", reason: "" }])}><Plus className="size-3.5" aria-hidden /> Agregar línea</button></div>
      </div>
      <p className="text-[13px] text-ink-2">El precio y los impuestos se calculan al guardar el borrador, con la lista de precios vigente. Después podrás confirmar y cobrar.</p>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Crear borrador</button>
      </div>
    </form>
  );
}

// ───────────── Devolución ─────────────

function ReturnForm({ sale, onDone, onCancel }: { sale: SaleDetail; onDone: (s: SaleDetail) => void; onCancel: () => void }) {
  const open = sale.lines.filter((l) => Number(l.quantity) - Number(l.returnedQty ?? 0) > 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const lines = open.filter((l) => Number(qty[l.id] ?? 0) > 0).map((l) => ({ saleLineId: l.id, quantity: Number(qty[l.id]) }));
    if (lines.length === 0) return setError("Indica la cantidad a devolver en al menos una línea.");
    setBusy(true);
    const r = await bff(`/bff/api/sales/orders/${sale.id}/returns`, "POST", { reason, lines, refund: { method } });
    if (!r.ok) { setBusy(false); return setError(errorText(r)); }
    const again = await bff<SaleDetail>(`/bff/api/sales/orders/${sale.id}`, "GET");
    setBusy(false);
    if (again.ok) onDone(again.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div>
        <h3 className="text-lg font-semibold text-ink">Devolución · {sale.code}</h3>
        <p className="mt-1 text-[13px] text-ink-2">Lo devuelto vuelve al inventario en su lote y a su costo original, y reduce lo que el cliente debe. Si ya había pagado de más, se le reintegra la diferencia.</p>
      </div>
      <table className="w-full text-left text-[13px]">
        <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Producto</th><th className="text-right font-medium">Vendido</th><th className="text-right font-medium">Ya devuelto</th><th className="text-right font-medium">A devolver</th></tr></thead>
        <tbody className="tabular-nums">
          {open.map((l) => (
            <tr key={l.id} className="h-11 border-b border-line-strong/40">
              <td><span className="font-medium text-ink">{l.productName}</span> <span className="text-ink-3">{l.productCode}</span></td>
              <td className="text-right">{num(l.quantity)} {l.unit}</td><td className="text-right">{num(l.returnedQty ?? "0")}</td>
              <td className="text-right"><input type="number" step="any" min="0" max={Number(l.quantity) - Number(l.returnedQty ?? 0)} className={`${inputCls} h-8 w-24 text-right`} value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={`Devolver, ${l.productCode}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <Field label="Motivo de la devolución"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} /></Field>
        <Field label="Reintegro (si corresponde)" hint="Cómo se devuelve el dinero."><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Volver</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Registrar devolución</button>
      </div>
    </form>
  );
}
