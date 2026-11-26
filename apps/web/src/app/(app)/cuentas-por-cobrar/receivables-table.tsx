"use client";

import type { PaymentMethod, ReceivableRow, ReceivablesReport } from "@erp/contracts";
import { HandCoins, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, money } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const METHODS: Record<PaymentMethod, string> = { CASH: "Efectivo", TRANSFER: "Transferencia", QR: "QR", CARD: "Tarjeta", CHEQUE: "Cheque" };

export function ReceivablesTable({ report, canCollect }: { report: ReceivablesReport; canCollect: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null);
  return (
    <>
      <Card>
        {report.customers.length === 0 ? (
          <EmptyState icon={HandCoins} title="Nadie te debe nada" description="Las ventas confirmadas a crédito aparecen aquí hasta que se cobran." />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Cliente</th><th className="px-3 text-right font-medium">Por vencer</th><th className="px-3 text-right font-medium">1-30</th><th className="px-3 text-right font-medium">31-60</th><th className="px-3 text-right font-medium">61-90</th><th className="px-3 text-right font-medium">+90</th><th className="px-3 text-right font-medium">Total</th><th className="px-3 font-medium">Límite</th><th className="px-5" /></tr></thead>
              <tbody className="tabular-nums">
                {report.customers.map((c) => (
                  <tr key={c.customerId} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5 font-sans"><span className="font-medium text-ink">{c.name}</span><span className="block text-xs text-ink-3">{c.code} · {c.documents} documento(s)</span></td>
                    {(["current", "d1_30", "d31_60", "d61_90", "d90plus"] as const).map((k) => <td key={k} className={`px-3 text-right ${k !== "current" && Number(c.buckets[k]) > 0 ? "text-warning" : "text-ink-3"}`}>{Number(c.buckets[k]) > 0 ? money(c.buckets[k]) : "—"}</td>)}
                    <td className="px-3 text-right font-medium text-ink">{money(c.outstanding)}</td>
                    <td className="px-3 text-xs font-sans text-ink-2">{c.creditLimit ? (Number(c.outstanding) > Number(c.creditLimit) ? <StatusBadge tone="danger">Excedido</StatusBadge> : money(c.creditLimit)) : "—"}</td>
                    <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setOpen({ id: c.customerId, name: c.name })}>Ver documentos</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open ? `Documentos por cobrar · ${open.name}` : "Documentos"} size="lg">
        {open && <Documents customerId={open.id} canCollect={canCollect} onChanged={() => router.refresh()} onClose={() => setOpen(null)} />}
      </Modal>
    </>
  );
}

function Documents({ customerId, canCollect, onChanged, onClose }: { customerId: string; canCollect: boolean; onChanged: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<ReceivableRow[] | null>(null);
  const [paying, setPaying] = useState<ReceivableRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => bff<ReceivableRow[]>(`/bff/api/finance/receivables/customers/${customerId}`, "GET").then((r) => (r.ok ? setRows(r.data) : setError(errorText(r))));
  useState(() => { void load(); });
  if (paying) return <CollectForm row={paying} onDone={() => { setPaying(null); void load(); onChanged(); }} onCancel={() => setPaying(null)} />;
  if (!rows) return error ? <p role="alert" className="text-danger">{error}</p> : <p className="text-ink-2">Cargando…</p>;
  return (
    <div className="grid gap-4" data-testid="receivable-docs">
      {rows.length === 0 ? <p className="text-ink-2">Este cliente ya no debe nada.</p> : (
        <table className="w-full text-left text-[13px] tabular-nums">
          <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Venta</th><th className="font-medium">Vence</th><th className="text-right font-medium">Atraso</th><th className="text-right font-medium">Total</th><th className="text-right font-medium">Saldo</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.saleId} className="h-10 border-b border-line-strong/40">
                <td className="font-sans font-medium text-ink">{r.code}</td><td>{r.dueDate}</td>
                <td className={`text-right ${r.daysOverdue > 0 ? "text-warning" : "text-ink-3"}`}>{r.daysOverdue > 0 ? `${r.daysOverdue} días` : "Al día"}</td>
                <td className="text-right">{money(r.total)}</td><td className="text-right font-medium text-ink">{money(r.balance)}</td>
                <td className="pl-3 text-right">{canCollect && <button className={`${btnSecondary} h-8 px-3`} onClick={() => setPaying(r)} aria-label={`Cobrar ${r.code}`}>Cobrar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex justify-end border-t border-line pt-4"><button className={btnSecondary} onClick={onClose}>Cerrar</button></div>
    </div>
  );
}

function CollectForm({ row, onDone, onCancel }: { row: ReceivableRow; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ method: "CASH" as PaymentMethod, amount: String(Number(row.balance)), reference: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff(`/bff/api/sales/orders/${row.saleId}/payments`, "POST", { method: f.method, amount: Number(f.amount), ...(f.reference.trim() ? { reference: f.reference.trim() } : {}) });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <h3 className="text-lg font-semibold text-ink">Cobrar {row.code}</h3>
      <p className="text-[13px] text-ink-2">Saldo pendiente: <strong className="tabular-nums text-ink">{money(row.balance)}</strong>. El efectivo entra a tu turno de caja.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Método"><select className={inputCls} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })} aria-label="Método de cobro">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
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
