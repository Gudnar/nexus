"use client";

import type { CashSessionSummary, SaleDetail, SaleSearchResult, SaleSearchRow } from "@erp/contracts";
import { Ban, CheckCircle2, Eraser, Eye, Loader2, RefreshCw, Search, Wallet } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { money } from "@/components/field";
import { Modal } from "@/components/modal";
import { PrintButton } from "@/components/print-button";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { PaymentModal, type PayResult } from "../punto-de-venta/payment-modal";
import { SaleDetailView } from "../ventas/sale-detail";

const label = "grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2";
const field = `${inputCls} h-10 font-normal normal-case tracking-normal`;
const iconBtn = "grid size-8 place-items-center rounded-md border border-line-strong bg-surface text-ink-2 hover:bg-surface-muted";
const day = (iso: string) => new Date(iso).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
const hour = (iso: string) => new Date(iso).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const plusDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Módulo del cajero: lista las ventas guardadas desde el punto de venta y las cobra con una o varias formas de pago. */
export function PendingSales({ branches, sessions, today, canDiscard }: { branches: { id: string; name: string }[]; sessions: CashSessionSummary[]; today: string; canDiscard: boolean }) {
  const [f, setF] = useState({ dateFrom: "", dateTo: "", branchId: "", customer: "" });
  const [items, setItems] = useState<SaleSearchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [charging, setCharging] = useState<string | null>(null);
  const [done, setDone] = useState<SaleDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async (q = f) => {
    setLoading(true); setError(null);
    const p = new URLSearchParams({ status: "DRAFT", pageSize: "500" });
    if (q.dateFrom) p.set("dateFrom", q.dateFrom);
    if (q.dateTo) p.set("dateTo", q.dateTo);
    if (q.branchId) p.set("branchId", q.branchId);
    const r = await bff<SaleSearchResult>(`/bff/api/sales/search?${p}`, "GET");
    setLoading(false);
    if (!r.ok) return setError(errorText(r));
    setItems(r.data.items);
  }, [f]);
  useEffect(() => { void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = f.customer.trim().toLowerCase();
  const shown = (items ?? []).filter((s) => !needle || (s.customer?.name ?? "consumidor final").toLowerCase().includes(needle));

  async function discard(s: SaleSearchRow) {
    if (!window.confirm(`¿Descartar la venta de Bs ${money(s.total)}? No deja rastro en stock ni en cobros.`)) return;
    const r = await bff(`/bff/api/sales/orders/${s.id}/discard`, "POST");
    if (!r.ok) return setError(errorText(r));
    setNotice("Venta descartada."); void run();
  }

  const search = (e: FormEvent) => { e.preventDefault(); setNotice(null); void run(); };
  const clear = () => { const e = { dateFrom: "", dateTo: "", branchId: "", customer: "" }; setF(e); setNotice(null); void run(e); };

  return (
    <div className="grid gap-5" data-testid="pending-sales">
      <Card>
        <form onSubmit={search} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr_auto]" data-testid="pending-filters">
          <label className={label}>Fecha desde<input type="date" aria-label="Fecha desde" className={field} value={f.dateFrom} onChange={(e) => setF({ ...f, dateFrom: e.target.value })} /></label>
          <label className={label}>Fecha hasta<input type="date" aria-label="Fecha hasta" className={field} value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })} /></label>
          <label className={label}>Sucursal
            <select aria-label="Sucursal" className={field} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">Todas</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          <label className={label}>Cliente<input aria-label="Cliente" className={field} placeholder="Nombre del cliente" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></label>
          <div className="flex items-end gap-2">
            <button className={`${btnPrimary} h-10`}><Search className="size-4" aria-hidden />Buscar</button>
            <button type="button" className={`${btnSecondary} h-10 px-3`} onClick={clear} aria-label="Limpiar filtros" title="Limpiar filtros"><Eraser className="size-4" aria-hidden /></button>
          </div>
        </form>
      </Card>

      {notice && <p role="status" className="rounded-lg bg-success-soft px-4 py-2.5 text-[13px] text-success">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{error}</p>}

      <Card className="p-0">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">Ventas guardadas</h2>
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-ink-2" data-testid="pending-count">{shown.length} pendiente(s)</span>
            <button className={`${btnSecondary} h-9 px-3`} onClick={() => void run()} disabled={loading} aria-label="Actualizar" title="Actualizar"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden /></button>
          </div>
        </div>
        {items !== null && shown.length === 0 ? (
          <div className="px-5 pb-6"><EmptyState icon={Wallet} title="No hay ventas pendientes de cobro" description="Cuando el punto de venta guarde una venta, aparecerá aquí." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]" data-testid="pending-results">
              <thead><tr className="h-[42px] border-y border-line bg-surface-muted text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                <th className="px-5">#</th><th className="px-3">Fecha</th><th className="px-3">Hora</th><th className="px-3">Cliente</th><th className="px-3">Vendedor</th><th className="px-3">Sucursal</th><th className="px-3 text-right">Total (Bs)</th><th className="px-3">Estado</th><th className="px-5">Acciones</th>
              </tr></thead>
              <tbody className="tabular-nums">
                {shown.map((s, i) => (
                  <tr key={s.id} className="h-[50px] border-b border-line-strong/40 text-body hover:bg-surface-muted" data-testid={`pending-${s.id}`}>
                    <td className="px-5 text-ink-3">{i + 1}</td>
                    <td className="px-3" suppressHydrationWarning>{day(s.date)}</td>
                    <td className="px-3" suppressHydrationWarning>{hour(s.date)}</td>
                    <td className="px-3 font-sans font-semibold uppercase text-ink">{s.customer?.name ?? <span className="font-normal normal-case text-ink-3">Consumidor final</span>}</td>
                    <td className="px-3 font-sans uppercase text-ink-2">{s.seller ?? "—"}</td>
                    <td className="px-3 font-sans text-ink-2">{s.branch.name}</td>
                    <td className="px-3 text-right font-semibold text-ink">{money(s.total)}</td>
                    <td className="px-3 font-sans"><StatusBadge tone="warning">Guardado</StatusBadge></td>
                    <td className="px-5">
                      <span className="flex items-center gap-1.5">
                        <button className="grid size-8 place-items-center rounded-md bg-brand text-white hover:bg-brand-hover" onClick={() => setDetailId(s.id)} aria-label="Ver detalle" title="Ver detalle"><Eye className="size-4" aria-hidden /></button>
                        <button className="inline-flex h-8 items-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white hover:opacity-90" onClick={() => { setNotice(null); setCharging(s.id); }} data-testid={`charge-${s.id}`}><Wallet className="size-4" aria-hidden />Cobrar</button>
                        {canDiscard && <button className="grid size-8 place-items-center rounded-md bg-danger text-white hover:opacity-90" onClick={() => void discard(s)} aria-label="Descartar venta" title="Descartar venta"><Ban className="size-4" aria-hidden /></button>}
                      </span>
                    </td>
                  </tr>
                ))}
                {items === null && <tr><td colSpan={9} className="px-5 py-10 text-center text-ink-3"><Loader2 className="mx-auto size-5 animate-spin" aria-hidden /></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={detailId !== null} onClose={() => setDetailId(null)} title="Detalle de la venta" size="lg">
        {detailId && <SaleDetailView key={detailId} id={detailId} onClose={() => setDetailId(null)} />}
      </Modal>
      <Modal open={charging !== null} onClose={() => setCharging(null)} title="Cobrar venta pendiente" size="lg">
        {charging && <ChargeSale key={charging} id={charging} sessions={sessions} today={today} onCancel={() => setCharging(null)} onDone={(sale) => { setCharging(null); setDone(sale); void run(); }} />}
      </Modal>
      <Modal open={done !== null} onClose={() => setDone(null)} title="Venta cobrada" size="md">
        {done && (
          <div className="grid gap-4 text-center" data-testid="charge-done">
            <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
            <p className="text-[15px] text-ink">Venta <strong>{done.code}</strong> cobrada por <strong>Bs {money(done.total)}</strong>{Number(done.balance) > 0 ? <> · quedan <strong className="text-danger">Bs {money(done.balance)}</strong> a crédito</> : null}.</p>
            <div className="flex justify-center gap-2"><PrintButton docType="SALE_RECEIPT" id={done.id} label="Imprimir recibo" /><button className={btnPrimary} onClick={() => setDone(null)}>Listo</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Carga la venta guardada y la cobra: resumen de lo vendido, crédito opcional y las formas de pago. */
function ChargeSale({ id, sessions, today, onCancel, onDone }: { id: string; sessions: CashSessionSummary[]; today: string; onCancel: () => void; onDone: (s: SaleDetail) => void }) {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [credit, setCredit] = useState(false);
  const [dueDate, setDueDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void bff<SaleDetail>(`/bff/api/sales/orders/${id}`, "GET").then((r) => {
      if (!r.ok) return setLoadError(errorText(r));
      if (r.data.status !== "DRAFT") return setLoadError("Esta venta ya no está pendiente: alguien más la cobró o la descartó.");
      setSale(r.data); if (r.data.dueDate) setDueDate(r.data.dueDate);
    });
  }, [id]);

  async function confirm(r: PayResult) {
    if (!sale) return;
    setBusy(true); setError(null);
    const c = await bff<SaleDetail>(`/bff/api/sales/orders/${sale.id}/confirm`, "POST", { payments: r.payments, ...(r.dueDate ? { dueDate: r.dueDate } : {}) });
    setBusy(false);
    if (!c.ok) return setError(errorText(c, "No se pudo cobrar la venta."));
    onDone(c.data);
  }

  if (loadError) return <div className="grid gap-3"><p role="alert" className="text-danger">{loadError}</p><div className="flex justify-end"><button className={btnSecondary} onClick={onCancel}>Cerrar</button></div></div>;
  if (!sale) return <p className="text-ink-2">Cargando…</p>;
  const branchSessions = sessions.filter((s) => s.branchId === sale.branchId && s.status === "OPEN");
  return (
    <div className="grid gap-4" data-testid="charge-sale">
      <div className="rounded-lg border border-line px-3 py-2 text-[13px]">
        <p className="font-semibold text-ink">{sale.customer?.name ?? "Consumidor final"} <span className="font-normal text-ink-2">· {sale.lines.length} producto(s) · {sale.withTax ? "Con impuestos (CF)" : "Sin impuestos (SF)"}</span></p>
        <ul className="mt-1 grid gap-0.5 text-ink-2">{sale.lines.slice(0, 6).map((l) => <li key={l.id}>{Number(l.quantity)} {l.unit} · {l.productName}</li>)}{sale.lines.length > 6 && <li>… y {sale.lines.length - 6} más</li>}</ul>
      </div>
      {sale.customer ? (
        <label className="flex flex-wrap items-center gap-3 text-[13px] text-body">
          <span className="flex items-center gap-2"><input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} data-testid="charge-credit" /> Venta a crédito (permite saldo pendiente)</span>
          {credit && <input type="date" aria-label="Fecha límite de pago" className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px]" value={dueDate} min={today} onChange={(e) => setDueDate(e.target.value || plusDays(today, 0))} />}
        </label>
      ) : null}
      <PaymentModal key={String(credit)} total={Number(sale.total)} hasCustomer={!!sale.customer} isCredit={credit} dueDate={dueDate} sessions={branchSessions} onConfirm={confirm} onCancel={onCancel} busy={busy} error={error} />
    </div>
  );
}
