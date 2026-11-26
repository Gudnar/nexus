"use client";

import type { QuoteDetail, QuoteSummary, SaleDetail } from "@erp/contracts";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { PrintButton } from "@/components/print-button";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const STATUS: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = {
  DRAFT: ["Borrador", "neutral"], SENT: ["Enviada", "info"], ACCEPTED: ["Aceptada", "success"], REJECTED: ["Rechazada", "danger"], CANCELLED: ["Cancelada", "danger"],
};
interface Opt { id: string; name: string; code: string }
interface Wh extends Opt { branchId: string }
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface Props { quotes: QuoteSummary[]; customers: Opt[]; branches: { id: string; name: string }[]; warehouses: Wh[]; status: string; canCreate: boolean; canDiscount: boolean }

export function QuotesManager({ quotes, customers, branches, warehouses, status, canCreate, canDiscount }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const compact = inputCls.replace("w-full ", "");
  return (
    <>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <select aria-label="Estado" className={`${compact} w-[190px]`} value={status} onChange={(e) => router.push(e.target.value ? `/cotizaciones?status=${e.target.value}` : "/cotizaciones")}>
              <option value="">Todas</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {status && <Link href="/cotizaciones" className="text-[13px] text-brand hover:underline">Limpiar</Link>}
          </div>
          {canCreate && <button className={btnPrimary} onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Nueva cotización</button>}
        </div>
        {quotes.length === 0 ? (
          <EmptyState icon={FileText} title={status ? "Sin resultados" : "Aún no hay cotizaciones"} description={status ? "Prueba con otro estado." : "Crea la primera con «Nueva cotización»."} />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Cotización</th><th className="px-3 font-medium">Para</th><th className="px-3 font-medium">Vigente hasta</th><th className="px-3 text-right font-medium">Total</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">{q.code}</td>
                    <td className="px-3">{q.customer?.name ?? <>{q.prospectName} <span className="text-xs text-ink-3">(prospecto)</span></>}</td>
                    <td className="px-3">{q.validUntil} {q.expired && <StatusBadge tone="warning">Vencida</StatusBadge>}</td>
                    <td className="px-3 text-right tabular-nums">{money(q.total)} <span className="text-ink-3">{q.currency}</span></td>
                    <td className="px-3"><StatusBadge tone={STATUS[q.status]![1]}>{STATUS[q.status]![0]}</StatusBadge>{q.convertedSaleId && <span className="ml-1.5 text-xs text-ink-3">→ venta</span>}</td>
                    <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpenId(q.id)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva cotización" size="lg">
        {creating && <QuoteForm customers={customers} branches={branches} canDiscount={canDiscount} onDone={(id) => { setCreating(false); router.refresh(); setOpenId(id); }} onCancel={() => setCreating(false)} />}
      </Modal>
      <Modal open={openId !== null} onClose={() => setOpenId(null)} title="Cotización" size="lg">
        {openId && <QuoteView key={openId} id={openId} warehouses={warehouses} canCreate={canCreate} onChanged={() => router.refresh()} onClose={() => setOpenId(null)} />}
      </Modal>
    </>
  );
}

function QuoteView({ id, warehouses, canCreate, onChanged, onClose }: { id: string; warehouses: Wh[]; canCreate: boolean; onChanged: () => void; onClose: () => void }) {
  const [q, setQ] = useState<QuoteDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converted, setConverted] = useState<SaleDetail | null>(null);
  const [whId, setWhId] = useState("");
  const [hoursV, setHoursV] = useState("48");
  const [reserveWh, setReserveWh] = useState("");
  useEffect(() => { void bff<QuoteDetail>(`/bff/api/sales/quotes/${id}`, "GET").then((r) => (r.ok ? setQ(r.data) : setError(errorText(r)))); }, [id]);

  async function reserve() {
    setBusy("reserve"); setError(null);
    const r = await bff<QuoteDetail>(`/bff/api/sales/quotes/${id}/reserve`, "POST", { warehouseId: reserveWh, hours: Number(hoursV) });
    setBusy(null);
    if (!r.ok) return setError(r.data.code === "INSUFFICIENT_STOCK" ? `No hay stock disponible para reservar. ${errorText(r)}` : errorText(r));
    setQ(r.data); onChanged();
  }

  async function act(action: "send" | "accept" | "reject" | "cancel" | "convert", confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action); setError(null);
    if (action === "convert") {
      const r = await bff<SaleDetail>(`/bff/api/sales/quotes/${id}/convert`, "POST", { warehouseId: whId });
      setBusy(null);
      if (!r.ok) return setError(r.data.code === "BRANCH_MISMATCH" ? "El almacén debe ser de la misma sucursal de la cotización." : errorText(r));
      setConverted(r.data); onChanged();
      void bff<QuoteDetail>(`/bff/api/sales/quotes/${id}`, "GET").then((x) => x.ok && setQ(x.data));
      return;
    }
    const r = await bff<QuoteDetail>(`/bff/api/sales/quotes/${id}/${action}`, "POST");
    setBusy(null);
    if (!r.ok) return setError(errorText(r));
    setQ(r.data); onChanged();
  }

  if (!q) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-ink-2">Cargando…</p>;
  const [label, tone] = STATUS[q.status]!;
  const eligible = warehouses; // el servidor valida que sea de la misma sucursal
  return (
    <div className="grid gap-5" data-testid="quote-detail">
      <div>
        <h3 className="text-lg font-semibold text-ink">{q.code} <StatusBadge tone={tone}>{label}</StatusBadge> {q.expired && <StatusBadge tone="warning">Vencida</StatusBadge>}</h3>
        <p className="mt-1 text-[13px] text-ink-2">{q.customer?.name ?? `${q.prospectName} (prospecto)`} · vigente hasta {q.validUntil}</p>
        {q.note && <p className="mt-1 text-[13px] text-ink-3">{q.note}</p>}
      </div>
      <table className="w-full text-left text-[13px]">
        <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Producto</th><th className="text-right font-medium">Cant.</th><th className="text-right font-medium">P. lista</th><th className="text-right font-medium">Desc.</th><th className="text-right font-medium">Neto</th><th className="text-right font-medium">Impuestos</th><th className="text-right font-medium">Total</th></tr></thead>
        <tbody className="tabular-nums">
          {q.lines.map((l) => (
            <tr key={l.id} className="h-10 border-b border-line-strong/40">
              <td><span className="font-medium text-ink">{l.productName}</span> <span className="text-ink-3">{l.productCode}</span></td>
              <td className="text-right">{num(l.quantity)} {l.unit}</td><td className="text-right">{money(l.listUnitPrice, 4)}</td><td className="text-right">{Number(l.discountPct) > 0 ? `${num(l.discountPct)} %` : "—"}</td>
              <td className="text-right">{money(l.netAmount)}</td><td className="text-right">{money(l.taxAmount)}</td><td className="text-right font-medium text-ink">{money(l.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-right text-[13px] text-ink-2">Total {q.currency}: <strong className="text-[15px] tabular-nums text-ink" data-testid="quote-total">{money(q.total)}</strong></p>

      {q.reservation && (
        <p className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-[13px] text-body" data-testid="quote-reservation">
          Reserva {q.reservation.code}: <strong>{{ ACTIVE: "vigente", RELEASED: "liberada", CONSUMED: "consumida por la venta", EXPIRED: "vencida" }[q.reservation.status]}</strong>
          {q.reservation.status === "ACTIVE" && <span suppressHydrationWarning> · vence {new Date(q.reservation.expiresAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</span>}
        </p>
      )}
      {canCreate && (q.status === "SENT" || q.status === "ACCEPTED") && !q.convertedSaleId && !converted && q.reservation?.status !== "ACTIVE" && (
        <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
          <Field label="Reservar el stock en" hint="Lo apartado no lo puede vender otro, y se libera solo al vencer."><select className={inputCls} value={reserveWh} onChange={(e) => setReserveWh(e.target.value)} aria-label="Almacén de la reserva"><option value="">Elige un almacén…</option>{eligible.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select></Field>
          <Field label="Horas"><input type="number" min={1} max={720} className={inputCls} value={hoursV} onChange={(e) => setHoursV(e.target.value)} aria-label="Horas de reserva" /></Field>
          <button className={btnSecondary} disabled={busy !== null || !reserveWh} onClick={reserve}>{busy === "reserve" && <Loader2 className="size-4 animate-spin" aria-hidden />} Reservar stock</button>
        </div>
      )}
      {q.status === "ACCEPTED" && !q.convertedSaleId && !converted && canCreate && (
        <Field label="Almacén desde el que se despachará" hint="Debe ser de la misma sucursal de la cotización. El stock se valida al confirmar la venta.">
          <select className={inputCls} value={whId} onChange={(e) => setWhId(e.target.value)}>
            <option value="">Elige un almacén…</option>{eligible.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
          </select>
        </Field>
      )}
      {(converted || q.convertedSaleId) && <p role="status" className="rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-[13px] text-body" data-testid="quote-converted">Se convirtió en una venta en borrador, con el precio acordado. <Link href="/ventas?status=DRAFT" className="font-medium text-brand hover:underline">Ir a Ventas →</Link></p>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button className={btnSecondary} onClick={onClose}>Cerrar</button>
        <PrintButton docType="QUOTE" id={id} />
        {canCreate && ["DRAFT", "SENT", "ACCEPTED"].includes(q.status) && !q.convertedSaleId && <button className={btnSecondary} disabled={busy !== null} onClick={() => act("cancel", "¿Cancelar la cotización?")}>Cancelar</button>}
        {canCreate && q.status === "SENT" && <button className={btnSecondary} disabled={busy !== null} onClick={() => act("reject")}>Rechazada</button>}
        {canCreate && q.status === "DRAFT" && <button className={btnPrimary} disabled={busy !== null} onClick={() => act("send")}>{busy === "send" && <Loader2 className="size-4 animate-spin" aria-hidden />} Marcar como enviada</button>}
        {canCreate && q.status === "SENT" && <button className={btnPrimary} disabled={busy !== null} onClick={() => act("accept")}>El cliente aceptó</button>}
        {canCreate && q.status === "ACCEPTED" && !q.convertedSaleId && !converted && <button className={btnPrimary} disabled={busy !== null || !whId} onClick={() => act("convert")}>{busy === "convert" && <Loader2 className="size-4 animate-spin" aria-hidden />} Convertir en venta</button>}
      </div>
    </div>
  );
}

interface FLine { key: number; product: PickedProduct | null; quantity: string; discount: string }
let seq = 0;

function QuoteForm({ customers, branches, canDiscount, onDone, onCancel }: { customers: Opt[]; branches: { id: string; name: string }[]; canDiscount: boolean; onDone: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ branchId: branches[0]?.id ?? "", customerId: "", prospect: "", validUntil: plusDays(15), note: "" });
  const [lines, setLines] = useState<FLine[]>([{ key: ++seq, product: null, quantity: "1", discount: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (key: number, p: Partial<FLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.customerId && !f.prospect.trim()) return setError("Indica el cliente o el nombre del prospecto.");
    if (lines.some((l) => !l.product)) return setError("Elige el producto en todas las líneas.");
    setBusy(true);
    const r = await bff<QuoteDetail>("/bff/api/sales/quotes", "POST", {
      branchId: f.branchId, customerId: f.customerId || null, prospectName: f.prospect.trim() || null, validUntil: f.validUntil, ...(f.note.trim() ? { note: f.note.trim() } : {}),
      lines: lines.map((l) => ({ productId: l.product!.id, quantity: Number(l.quantity), ...(canDiscount && Number(l.discount) > 0 ? { discountPct: Number(l.discount) } : {}) })),
    });
    setBusy(false);
    if (r.ok) return onDone(r.data.id);
    if (r.status === 404) setError("Alguno de los productos no tiene precio vigente. Asígnalo en «Listas de precios».");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sucursal" hint="De ella dependen los precios."><select className={inputCls} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Vigente hasta"><input type="date" className={inputCls} value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} required /></Field>
        <Field label="Cliente"><select className={inputCls} value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">— Prospecto (sin ficha) —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select></Field>
        {!f.customerId && <Field label="Nombre del prospecto"><input className={inputCls} value={f.prospect} onChange={(e) => setF({ ...f, prospect: e.target.value })} maxLength={120} aria-label="Nombre del prospecto" /></Field>}
        <Field label="Nota (opcional)" className="sm:col-span-2"><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} /></Field>
      </div>
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={l.key} className={`grid gap-3 rounded-lg border border-line p-3 ${canDiscount ? "sm:grid-cols-[1fr_110px_110px_36px]" : "sm:grid-cols-[1fr_130px_36px]"} sm:items-end`}>
            <Field label={`Producto ${i + 1}`}><ProductPicker value={l.product} onChange={(p) => patch(l.key, { product: p })} /></Field>
            <Field label={`Cantidad${l.product ? ` (${l.product.unit})` : ""}`}><input type="number" step="any" min="0" className={inputCls} value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} required aria-label={`Cantidad, línea ${i + 1}`} /></Field>
            {canDiscount && <Field label="Desc. %"><input type="number" step="any" min="0" max="100" className={inputCls} value={l.discount} onChange={(e) => patch(l.key, { discount: e.target.value })} /></Field>}
            <button type="button" className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar línea ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
          </div>
        ))}
        <div><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setLines((ls) => [...ls, { key: ++seq, product: null, quantity: "1", discount: "" }])}><Plus className="size-3.5" aria-hidden /> Agregar línea</button></div>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Crear cotización</button>
      </div>
    </form>
  );
}
