"use client";

import type { PayableRow, PayablesReport, PaymentMethod, SupplierPaymentView } from "@erp/contracts";
import { Loader2, Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, money } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const METHODS: Record<PaymentMethod, string> = { CASH: "Efectivo", TRANSFER: "Transferencia", QR: "QR", CARD: "Tarjeta", CHEQUE: "Cheque" };

export function PayablesTable({ report, payments, canPay }: { report: PayablesReport; payments: SupplierPaymentView[]; canPay: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ id: string; name: string; outstanding: string } | null>(null);
  return (
    <div className="grid gap-6">
      <Card>
        {report.suppliers.length === 0 ? (
          <EmptyState icon={Receipt} title="No debes nada a tus proveedores" description="Cada recepción de mercadería genera una deuda con vencimiento según el plazo del proveedor." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Proveedor</th><th className="px-3 text-right font-medium">Por vencer</th><th className="px-3 text-right font-medium">1-30</th><th className="px-3 text-right font-medium">31-60</th><th className="px-3 text-right font-medium">61-90</th><th className="px-3 text-right font-medium">+90</th><th className="px-3 text-right font-medium">Total</th><th className="px-5" /></tr></thead>
              <tbody className="tabular-nums">
                {report.suppliers.map((s) => (
                  <tr key={s.supplierId} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5 font-sans"><span className="font-medium text-ink">{s.name}</span><span className="block text-xs text-ink-3">{s.code} · {s.documents} documento(s)</span></td>
                    {(["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const).map((k) => <td key={k} className={`px-3 text-right ${k !== "current" && Number(s.buckets[k]) > 0 ? "text-warning" : "text-ink-3"}`}>{Number(s.buckets[k]) > 0 ? money(s.buckets[k]) : "—"}</td>)}
                    <td className="px-3 text-right font-medium text-ink">{money(s.outstanding)}</td>
                    <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpen({ id: s.supplierId, name: s.name, outstanding: s.outstanding })}>Ver y pagar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-ink">Pagos recientes</h2>
        {payments.length === 0 ? <p className="text-[13px] text-ink-2">Aún no hay pagos a proveedores.</p> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-9 border-y border-line text-ink-2"><th className="px-5 font-medium">Pago</th><th className="px-3 font-medium">Fecha</th><th className="px-3 font-medium">Proveedor</th><th className="px-3 font-medium">Medio</th><th className="px-3 text-right font-medium">Importe</th><th className="px-5 font-medium">Aplicado a</th></tr></thead>
              <tbody className="tabular-nums">
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-line-strong/40 align-top">
                    <td className="px-5 py-2 font-sans font-medium text-ink">{p.code}{p.reference && <span className="block text-xs font-normal text-ink-3">{p.reference}</span>}</td>
                    <td className="px-3 py-2" suppressHydrationWarning>{new Date(p.paidAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-3 py-2 font-sans">{p.supplier.name}</td><td className="px-3 py-2 font-sans">{METHODS[p.method]}</td>
                    <td className="px-3 py-2 text-right">{money(p.amount)}</td>
                    <td className="px-5 py-2 text-xs font-sans text-ink-2">{p.allocations.map((a) => `${a.receiptCode}: ${money(a.amount)}`).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open ? `Deuda con ${open.name}` : "Deuda"} size="lg">
        {open && <Documents supplierId={open.id} outstanding={open.outstanding} canPay={canPay} onChanged={() => router.refresh()} onClose={() => setOpen(null)} />}
      </Modal>
    </div>
  );
}

function Documents({ supplierId, outstanding, canPay, onChanged, onClose }: { supplierId: string; outstanding: string; canPay: boolean; onChanged: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<PayableRow[] | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => bff<PayableRow[]>(`/bff/api/finance/payables/suppliers/${supplierId}`, "GET").then((r) => (r.ok ? setRows(r.data) : setError(errorText(r))));
  useState(() => { void load(); });
  if (paying) return <PayForm supplierId={supplierId} outstanding={outstanding} onDone={() => { setPaying(false); void load(); onChanged(); }} onCancel={() => setPaying(false)} />;
  if (!rows) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-ink-2">Cargando…</p>;
  const open = rows.filter((r) => r.status === "OPEN");
  return (
    <div className="grid gap-4" data-testid="payable-docs">
      <table className="w-full text-left text-[13px] tabular-nums">
        <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Recepción</th><th className="font-medium">Vence</th><th className="text-right font-medium">Total</th><th className="text-right font-medium">Pagado</th><th className="text-right font-medium">Saldo</th><th className="font-medium">Estado</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="h-10 border-b border-line-strong/40">
              <td className="font-sans font-medium text-ink">{r.receiptCode}{r.orderCode && <span className="ml-1 text-xs font-normal text-ink-3">({r.orderCode})</span>}</td>
              <td className={r.daysOverdue > 0 ? "text-warning" : ""}>{r.dueDate}{r.daysOverdue > 0 && <span className="ml-1 text-xs">({r.daysOverdue} d)</span>}</td>
              <td className="text-right">{money(r.total)}</td><td className="text-right">{money(r.paid)}</td><td className="text-right font-medium text-ink">{money(r.balance)}</td>
              <td className="font-sans"><StatusBadge tone={r.status === "PAID" ? "success" : r.status === "VOID" ? "neutral" : "warning"}>{{ OPEN: "Pendiente", PAID: "Pagada", VOID: "Anulada" }[r.status]}</StatusBadge></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button className={btnSecondary} onClick={onClose}>Cerrar</button>
        {canPay && open.length > 0 && <button className={btnPrimary} onClick={() => setPaying(true)}>Registrar pago</button>}
      </div>
    </div>
  );
}

function PayForm({ supplierId, outstanding, onDone, onCancel }: { supplierId: string; outstanding: string; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ method: "TRANSFER" as PaymentMethod, amount: "", reference: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff("/bff/api/finance/supplier-payments", "POST", { supplierId, method: f.method, amount: Number(f.amount), ...(f.reference.trim() ? { reference: f.reference.trim() } : {}) });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <h3 className="text-lg font-semibold text-ink">Registrar pago</h3>
      <p className="text-[13px] text-ink-2">Se debe en total <strong className="tabular-nums text-ink">{money(outstanding)}</strong>. El pago se aplica primero a lo que vence antes. Si es en efectivo, sale de tu turno de caja.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Medio"><select className={inputCls} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })} aria-label="Medio de pago">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Importe"><input type="number" step="any" min="0" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required aria-label="Importe del pago" /></Field>
        <Field label="Referencia"><input className={inputCls} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} /></Field>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Volver</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Registrar pago</button>
      </div>
    </form>
  );
}
