"use client";

import type { SaleDetail } from "@erp/contracts";
import { Banknote, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { money } from "@/components/field";
import { PrintButton } from "@/components/print-button";
import { btnSecondary, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const METHODS: Record<string, string> = { CASH: "EFECTIVO", TRANSFER: "TRANSFERENCIA", QR: "QR", CARD: "TARJETA", CHEQUE: "CHEQUE" };
const STATE: Record<string, [string, "success" | "danger" | "neutral"]> = { CONFIRMED: ["ACTIVA", "success"], CANCELLED: ["ANULADA", "danger"], DRAFT: ["BORRADOR", "neutral"] };

const dt = (iso: string) => new Date(iso).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const d = (iso: string) => new Date(iso).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Detalle de solo lectura de una venta: datos del documento, productos con su categoría y pagos con quién cobró. */
export function SaleDetailView({ id, onClose, onManage }: { id: string; onClose: () => void; onManage?: () => void }) {
  const [s, setS] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void bff<SaleDetail>(`/bff/api/sales/orders/${id}`, "GET").then((r) => (r.ok ? setS(r.data) : setError(errorText(r)))); }, [id]);

  if (!s) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-ink-2">Cargando…</p>;
  const [stateLabel, tone] = STATE[s.status]!;
  const date = s.confirmedAt ?? s.createdAt;
  const credit = Number(s.balance) > 0 || (s.dueDate !== null && s.dueDate > date.slice(0, 10));
  const payers = [...new Set(s.payments.map((p) => p.by).filter(Boolean))];
  const unit = (l: SaleDetail["lines"][number]) => (l.appliedUnitPrice ? Number(l.appliedUnitPrice) : Number(l.listUnitPrice)) * (1 - Number(l.discountPct) / 100);
  const th = "px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-2";
  const row = (label: string, value: React.ReactNode, strong = false) => (
    <div className="grid grid-cols-[130px_1fr] gap-3 border-b border-line-strong/40 py-1.5 text-[13px]"><dt className="font-semibold text-ink">{label}:</dt><dd className={strong ? "font-semibold text-ink" : "text-body"}>{value}</dd></div>
  );

  return (
    <div className="grid gap-5" data-testid="sale-detail">
      <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 flex items-center gap-3 text-[18px] font-[650] text-ink">Doc. #{s.code ?? "borrador"} <StatusBadge tone={tone}>{stateLabel}</StatusBadge></h3>
          <dl>
            {row("Fecha", dt(date))}
            {row("Cliente", s.customer?.name ?? "Consumidor final")}
            {row("NIT/CI", s.billingTaxId || s.customer?.taxId || "—")}
            {s.billingName && s.billingName !== s.customer?.name && row("Nombre comprobante", s.billingName)}
            {row("Código cliente", s.customer?.code ?? "—")}
            {row("Teléfono", s.customer?.phone ?? "—")}
          </dl>
        </div>
        <dl className="md:pt-9">
          {row("Sucursal", s.branchName ?? "—")}
          {row("Vendedor", s.seller ?? "—")}
          {row("Cobrador(es)", payers.length ? payers.join(", ") : "—")}
          {row("Total", `Bs ${money(s.total)}`, true)}
          {row("Pagado", `Bs ${money(s.paidTotal)}`)}
          {row("Saldo", <span className={Number(s.balance) > 0 ? "font-semibold text-danger" : "text-success"}>Bs {money(s.balance)}</span>)}
          {row("Tipo venta", credit ? "CRÉDITO" : "NORMAL")}
          {row("Impuestos", s.withTax ? "Con impuestos (CF)" : "Sin impuestos (SF)")}
        </dl>
      </div>
      {s.note && <p className="rounded-lg bg-surface-muted px-3 py-2 text-[13px] text-body"><strong className="text-ink">Glosa:</strong> {s.note}</p>}
      {s.status === "CANCELLED" && s.cancelReason && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger"><strong>Motivo de anulación:</strong> {s.cancelReason}</p>}

      <section>
        <h4 className="mb-2 flex items-center gap-2 text-[16px] font-[650] text-ink"><Package className="size-5 text-ink-2" aria-hidden />Productos ({s.lines.length})</h4>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[13px]" data-testid="detail-lines">
            <thead className="bg-surface-muted"><tr><th className={th}>#</th><th className={th}>Código</th><th className={th}>Producto</th><th className={th}>Categoría</th><th className={`${th} text-right`}>Cant.</th><th className={`${th} text-right`}>Precio</th><th className={`${th} text-right`}>Total</th></tr></thead>
            <tbody className="tabular-nums">
              {s.lines.map((l, i) => (
                <tr key={l.id} className="border-t border-line-strong/40">
                  <td className="px-2.5 py-1.5 text-ink-3">{i + 1}</td><td className="px-2.5 py-1.5 font-mono text-xs">{l.productCode}</td>
                  <td className="px-2.5 py-1.5 font-sans font-medium text-ink">{l.productName}</td><td className="px-2.5 py-1.5 font-sans text-xs uppercase text-ink-2">{l.category ?? "—"}</td>
                  <td className="px-2.5 py-1.5 text-right">{Number(l.quantity)} <span className="text-ink-3">{l.unit}</span></td>
                  <td className="px-2.5 py-1.5 text-right">Bs {money(unit(l))}{Number(l.discountPct) > 0 && <span className="block text-[11px] text-ink-3">−{Number(l.discountPct)}%</span>}</td>
                  <td className="px-2.5 py-1.5 text-right font-semibold text-ink">Bs {money(l.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="tabular-nums text-[12px] text-ink-2">
              {s.withTax && Number(s.taxTotal) > 0 && <><tr className="border-t border-line"><td colSpan={6} className="px-2.5 pt-2 text-right">Neto</td><td className="px-2.5 pt-2 text-right">Bs {money(s.netTotal)}</td></tr><tr><td colSpan={6} className="px-2.5 text-right">Impuestos</td><td className="px-2.5 text-right">Bs {money(s.taxTotal)}</td></tr></>}
              <tr className={s.withTax && Number(s.taxTotal) > 0 ? "" : "border-t border-line"}><td colSpan={6} className="px-2.5 py-2 text-right font-semibold text-ink">Total</td><td className="px-2.5 py-2 text-right text-[14px] font-semibold text-ink">Bs {money(s.total)}</td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section>
        <h4 className="mb-2 flex items-center gap-2 text-[16px] font-[650] text-ink"><Banknote className="size-5 text-ink-2" aria-hidden />Pagos ({s.payments.length})</h4>
        {s.payments.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-[13px] text-ink-2">Sin pagos registrados{s.status === "CONFIRMED" ? ": toda la venta está a crédito." : "."}</p> : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[13px]" data-testid="detail-payments">
              <thead className="bg-surface-muted"><tr><th className={th}>#</th><th className={th}>Tipo</th><th className={`${th} text-right`}>Monto</th><th className={th}>Fecha</th><th className={th}>Comprobante</th><th className={th}>Cobrador</th></tr></thead>
              <tbody className="tabular-nums">
                {s.payments.map((p, i) => (
                  <tr key={p.id} className="border-t border-line-strong/40">
                    <td className="px-2.5 py-1.5 text-ink-3">{i + 1}</td><td className="px-2.5 py-1.5 font-sans">{METHODS[p.method] ?? p.method}</td>
                    <td className="px-2.5 py-1.5 text-right">Bs {money(p.amount)}</td><td className="px-2.5 py-1.5">{d(p.receivedAt)}</td>
                    <td className="px-2.5 py-1.5 font-sans text-ink-2">{p.reference ?? ""}</td><td className="px-2.5 py-1.5 font-sans">{p.by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {s.returns.length > 0 && (
        <section>
          <h4 className="mb-2 text-[16px] font-[650] text-ink">Devoluciones ({s.returns.length})</h4>
          <ul className="grid gap-1 text-[13px] text-body">{s.returns.map((r) => <li key={r.id} className="rounded-lg bg-surface-muted px-3 py-1.5">{r.code} · {d(r.createdAt)} · Bs {money(r.total)} — {r.reason}</li>)}</ul>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {s.status !== "DRAFT" && <PrintButton docType="SALE_RECEIPT" id={s.id} label="Imprimir recibo" />}
        {onManage && <button className={btnSecondary} onClick={onManage}>Cobrar, devolver o editar</button>}
        <button className={btnSecondary} onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}
