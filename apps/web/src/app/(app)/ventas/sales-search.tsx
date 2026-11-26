"use client";

import type { SaleSearchResult, SaleSearchRow } from "@erp/contracts";
import { Ban, Download, Eye, FileText, Loader2, RefreshCw, Search, SearchX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { money } from "@/components/field";
import { Modal } from "@/components/modal";
import { PrintButton } from "@/components/print-button";
import { btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { SaleDetailView } from "./sale-detail";
import { SaleView, type Can } from "./sales-manager";

const STATUS: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = { DRAFT: ["Borrador", "neutral"], CONFIRMED: ["Finalizada", "success"], CANCELLED: ["Anulada", "neutral"] };
const PAY: Record<string, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = { UNPAID: ["Sin cobrar", "danger"], PARTIAL: ["Cobro parcial", "warning"], PAID: ["Cobrada", "success"] };
const CHANNEL: Record<string, string> = { POS: "Mostrador", ECOMMERCE: "Tienda online", MESSAGING: "Mensajería" };

interface Filters { code: string; dateFrom: string; dateTo: string; customerId: string; taxId: string; branchId: string; sellerId: string; status: string; paymentStatus: string; channel: string; onlyDebtors: boolean }
const EMPTY: Filters = { code: "", dateFrom: "", dateTo: "", customerId: "", taxId: "", branchId: "", sellerId: "", status: "", paymentStatus: "", channel: "", onlyDebtors: false };
const PAGE = 50;

const label = "grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2";
const field = `${inputCls} h-10 font-normal normal-case tracking-normal`;

export function SalesSearch({
  customers, branches, sellers, can, initialStatus,
}: { customers: { id: string; name: string }[]; branches: { id: string; name: string }[]; sellers: { id: string; name: string }[]; can: Can; initialStatus: string }) {
  const [f, setF] = useState<Filters>({ ...EMPTY, status: initialStatus });
  const [applied, setApplied] = useState<Filters | null>(null);
  const [result, setResult] = useState<SaleSearchResult | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Qué se está viendo: el detalle (solo lectura), la gestión (cobrar, devolver, editar) o directamente la anulación. */
  const [view, setView] = useState<{ id: string; mode: "detail" | "manage" | "void" } | null>(null);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((s) => ({ ...s, [k]: v }));

  const qs = (x: Filters, p: number, size = PAGE) => {
    const q = new URLSearchParams({ page: String(p), pageSize: String(size) });
    for (const [k, v] of Object.entries(x)) if (v !== "" && v !== false) q.set(k, String(v));
    return q.toString();
  };

  const run = useCallback(async (x: Filters, p: number) => {
    setLoading(true); setError(null);
    const r = await bff<SaleSearchResult>(`/bff/api/sales/search?${qs(x, p)}`, "GET");
    setLoading(false);
    if (!r.ok) return setError(errorText(r, "No se pudo buscar."));
    setApplied(x); setPage(p); setResult(r.data);
  }, []);

  // Si llegas con un estado en el enlace (p. ej. «Ir a Ventas → borradores»), la búsqueda se hace sola.
  const first = useRef(true);
  useEffect(() => { if (first.current && initialStatus) void run({ ...EMPTY, status: initialStatus }, 1); first.current = false; }, [initialStatus, run]);

  const submit = (e: FormEvent) => { e.preventDefault(); void run(f, 1); };
  const clear = () => { setF(EMPTY); setApplied(null); setResult(null); setError(null); };

  async function exportDebtors() {
    if (!applied) return;
    setExporting(true); setError(null);
    const r = await bff<SaleSearchResult>(`/bff/api/sales/search?${qs({ ...applied, onlyDebtors: true }, 1, 5000)}`, "GET");
    setExporting(false);
    if (!r.ok) return setError(errorText(r));
    const head = ["Documento", "Fecha", "Cliente", "NIT/CI", "Sucursal", "Vendedor", "Total", "Pagado", "Saldo", "Vencimiento", "Días de atraso"];
    const esc = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = r.data.items.map((i) => [i.code, new Date(i.date).toLocaleDateString("es-BO"), i.customer?.name ?? "Consumidor final", i.customer?.taxId, i.branch.name, i.seller, i.total, i.paid, i.balance, i.dueDate, i.overdueDays].map(esc).join(";"));
    const blob = new Blob(["﻿" + [head.map(esc).join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `deudores-${new Date().toLocaleDateString("sv")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const total = result?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * PAGE + 1;
  const to = Math.min(page * PAGE, total);

  return (
    <div className="grid gap-4">
      <Card>
        <form onSubmit={submit} className="grid gap-4" role="search" aria-label="Filtros de ventas" data-testid="sales-filters">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr_1fr]">
            <label className={label}>Nro. documento<input aria-label="Nro. documento" className={field} value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="Ej: 100" /></label>
            <label className={label}>Fecha desde<input aria-label="Fecha desde" type="date" className={field} value={f.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} /></label>
            <label className={label}>Fecha hasta<input aria-label="Fecha hasta" type="date" className={field} value={f.dateTo} onChange={(e) => set("dateTo", e.target.value)} /></label>
            <label className={label}>Cliente
              <select aria-label="Cliente" className={field} value={f.customerId} onChange={(e) => set("customerId", e.target.value)}><option value="">— Todos —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <label className={label}>NIT / CI<input aria-label="NIT / CI" className={field} value={f.taxId} onChange={(e) => set("taxId", e.target.value)} placeholder="NIT" /></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr]">
            <label className={label}>Sucursal
              <select aria-label="Sucursal" className={field} value={f.branchId} onChange={(e) => set("branchId", e.target.value)}><option value="">— Todas —</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </label>
            <label className={label}>Vendedor
              <select aria-label="Vendedor" className={field} value={f.sellerId} onChange={(e) => set("sellerId", e.target.value)}><option value="">— Todos —</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <label className={label}>Estado
              <select aria-label="Estado" className={field} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="">Todos</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className={label}>Cobro
              <select aria-label="Cobro" className={field} value={f.paymentStatus} onChange={(e) => set("paymentStatus", e.target.value)}><option value="">Todos</option>{Object.entries(PAY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className={label}>Canal
              <select aria-label="Canal" className={field} value={f.channel} onChange={(e) => set("channel", e.target.value)}><option value="">Todos</option>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2">
              <input type="checkbox" aria-label="Solo deudores" className="size-4 accent-brand" checked={f.onlyDebtors} onChange={(e) => set("onlyDebtors", e.target.checked)} />
              Saldo pendiente — solo deudores
            </label>
            <button className={btnPrimary} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}Buscar</button>
            <button type="button" className={`${btnSecondary} px-3`} onClick={clear} aria-label="Limpiar filtros" title="Limpiar filtros"><X className="size-4" aria-hidden /></button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4" data-testid="sales-summary">
          <Stat label="Clientes con saldo" value={result ? String(result.summary.customersWithBalance) : "—"} testid="sum-customers" />
          <Stat label="Saldo total pendiente" value={result ? `Bs ${money(result.summary.totalOutstanding)}` : "Bs —"} tone="brand" testid="sum-outstanding" />
          <Stat label="Ventas pendientes" value={result ? String(result.summary.pendingSales) : "—"} testid="sum-pending" />
          <button className={`${btnSecondary} ml-auto`} onClick={exportDebtors} disabled={!result || result.summary.pendingSales === 0 || exporting} data-testid="export-debtors">
            {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}Exportar deudores
          </button>
        </div>
      </Card>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{error}</p>}

      <Card className="!p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold text-ink">Resultados</h2>
          <div className="flex items-center gap-3">
            {result && <span className="text-[13px] text-ink-2" data-testid="sales-count">{result.total} registro(s)</span>}
            <button className={`${btnSecondary} h-9 px-3`} onClick={() => applied && void run(applied, page)} disabled={!applied || loading} aria-label="Actualizar resultados" title="Actualizar"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden /></button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-testid="sales-results">
            <thead>
              <tr className="h-[42px] bg-surface-muted text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                <th className="px-5">Acciones</th><th className="px-3">Nro. doc.</th><th className="px-3">Fecha</th><th className="px-3">Cliente</th><th className="px-3">NIT / CI</th>
                <th className="px-3">Vendedor</th><th className="px-3 text-right">Total (Bs.)</th><th className="px-3 text-right">Pagado (Bs.)</th><th className="px-3 text-right">Saldo (Bs.)</th><th className="px-5">Estado</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {result?.items.map((s) => <Row key={s.id} s={s} can={can} onView={(mode) => setView({ id: s.id, mode })} />)}
            </tbody>
          </table>
        </div>
        {!result && (
          <div className="grid place-items-center gap-2 px-4 py-12 text-center text-ink-2" data-testid="sales-empty">
            <Search className="size-9 text-ink-3" aria-hidden />
            <p>Use los filtros y presione <strong>Buscar</strong> para ver resultados.</p>
          </div>
        )}
        {result && result.items.length === 0 && (
          <div className="grid place-items-center gap-2 px-4 py-12 text-center text-ink-2" data-testid="sales-none">
            <SearchX className="size-9 text-ink-3" aria-hidden />
            <p className="font-medium text-ink">Sin resultados</p><p>Prueba con otros filtros.</p>
          </div>
        )}
        {result && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-ink-2">
            <span data-testid="sales-range">Mostrando {from}–{to} de {total}</span>
            <span className="flex gap-2">
              <button className={`${btnSecondary} h-8 px-3`} disabled={page <= 1 || loading} onClick={() => applied && void run(applied, page - 1)}>Anterior</button>
              <button className={`${btnSecondary} h-8 px-3`} disabled={to >= total || loading} onClick={() => applied && void run(applied, page + 1)}>Siguiente</button>
            </span>
          </div>
        )}
      </Card>

      {/* Una sola ventana: pasar del detalle a gestionar no cierra y reabre el diálogo. */}
      <Modal open={view !== null} onClose={() => setView(null)} title={view?.mode === "detail" ? "Detalle de la venta" : view?.mode === "void" ? "Anular venta" : "Venta"} size="lg">
        {view?.mode === "detail" && <SaleDetailView key={view.id} id={view.id} onClose={() => setView(null)} onManage={() => setView({ id: view.id, mode: "manage" })} />}
        {view && view.mode !== "detail" && <SaleView key={`${view.id}-${view.mode}`} id={view.id} can={can} startMode={view.mode === "void" ? "void" : "view"} onChanged={() => applied && void run(applied, page)} onClose={() => setView(null)} />}
      </Modal>
    </div>
  );
}

function Stat({ label: l, value, tone, testid }: { label: string; value: string; tone?: "brand"; testid: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{l}</p>
      <p data-testid={testid} className={`mt-1 text-[24px] font-[650] tabular-nums ${tone === "brand" ? "text-brand" : "text-ink"}`}>{value}</p>
    </div>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
const iconBtn = "grid size-8 place-items-center rounded-md border border-line-strong bg-surface text-ink-2 hover:bg-surface-muted";

function Row({ s, can, onView }: { s: SaleSearchRow; can: Can; onView: (mode: "detail" | "manage" | "void") => void }) {
  const owes = s.status === "CONFIRMED" && Number(s.balance) > 0;
  const cancelled = s.status === "CANCELLED";
  const code = s.code ?? "Borrador";
  const muted = cancelled ? "text-ink-3 line-through" : "";
  return (
    <tr className={`h-[50px] border-b border-line-strong/40 hover:bg-surface-muted ${cancelled ? "bg-surface-muted/50 text-ink-3" : "text-body"}`} data-testid={`sale-${s.code ?? s.id}`}>
      <td className="px-5">
        <span className="flex items-center gap-1.5">
          <button className="grid size-8 place-items-center rounded-md bg-brand text-white hover:bg-brand-hover" onClick={() => onView("detail")} aria-label={`Ver detalle ${code}`} title="Ver detalle"><Eye className="size-4" aria-hidden /></button>
          {s.status === "CONFIRMED" && <PrintButton docType="SALE_RECEIPT" id={s.id} label={`Imprimir recibo ${code}`} iconOnly className={iconBtn} />}
          {!cancelled && <button className={iconBtn} onClick={() => onView("manage")} aria-label={`Gestionar ${code}`} title={s.status === "DRAFT" ? "Continuar, cobrar o descartar" : "Cobrar, devolver o editar"}><FileText className="size-4" aria-hidden /></button>}
          {s.status === "CONFIRMED" && (can.void || can.requestVoid) && <button className="grid size-8 place-items-center rounded-md bg-danger text-white hover:opacity-90" onClick={() => onView("void")} aria-label={`Anular ${code}`} title={can.void ? "Anular venta" : "Pedir la anulación"}><Ban className="size-4" aria-hidden /></button>}
        </span>
      </td>
      <td className={`px-3 font-mono text-xs font-semibold ${cancelled ? muted : "text-ink"}`}>{s.code ?? <span className="font-sans font-normal text-ink-3">Borrador</span>}</td>
      <td className={`px-3 ${cancelled ? muted : "text-ink-2"}`} suppressHydrationWarning>{fmtDate(s.date)}</td>
      <td className={`px-3 font-sans font-bold uppercase ${cancelled ? muted : "text-ink"}`}>{s.customer?.name ?? <span className="font-normal normal-case text-ink-3">Consumidor final</span>}</td>
      <td className={`px-3 ${cancelled ? muted : "text-ink-2"}`}>{s.customer?.taxId ?? "—"}</td>
      <td className={`px-3 font-sans uppercase ${cancelled ? muted : "text-ink-2"}`}>{s.seller ?? "—"}</td>
      <td className={`px-3 text-right font-semibold ${cancelled ? muted : "text-ink"}`}>{money(s.total)}</td>
      <td className={`px-3 text-right ${cancelled ? muted : "text-success"}`}>{money(s.paid)}</td>
      <td className={`px-3 text-right ${cancelled ? muted : owes ? "font-semibold text-danger" : "text-success"}`}>{money(owes ? s.balance : 0)}{owes && s.overdueDays > 0 && <span className="block text-[11px] font-normal">Vencida hace {s.overdueDays} d</span>}</td>
      <td className="px-5 font-sans">
        <span className="flex flex-wrap gap-1">
          <StatusBadge tone={STATUS[s.status]![1]}>{STATUS[s.status]![0]}</StatusBadge>
          {owes && <StatusBadge tone={PAY[s.paymentStatus]![1]}>{PAY[s.paymentStatus]![0]}</StatusBadge>}
        </span>
      </td>
    </tr>
  );
}
