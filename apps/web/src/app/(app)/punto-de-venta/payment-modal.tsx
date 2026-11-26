"use client";

import type { CashSessionSummary, PaymentMethod } from "@erp/contracts";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { fmt, METHODS, parseNum } from "./pos-helpers";

export interface PayRow { method: PaymentMethod; amount: string; reference: string; received: string }
export interface PayResult { payments: { method: PaymentMethod; amount: number; reference?: string; cashSessionId?: string }[]; dueDate?: string }

const compact = `${inputCls} h-9`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cobro de la venta: una o varias formas de pago (efectivo, QR, transferencia, tarjeta, cheque), con vuelto en efectivo,
 * caja desde la que se cobra y, si el cliente tiene crédito, saldo pendiente con su fecha límite.
 */
export function PaymentModal({
  total, hasCustomer, isCredit, dueDate, sessions, onConfirm, onCancel, busy, error,
}: { total: number; hasCustomer: boolean; isCredit: boolean; dueDate: string; sessions: CashSessionSummary[]; onConfirm: (r: PayResult) => void; onCancel: () => void; busy: boolean; error: string | null }) {
  const [rows, setRows] = useState<PayRow[]>(isCredit ? [] : [{ method: "CASH", amount: total.toFixed(2), reference: "", received: "" }]);
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const paid = round2(rows.reduce((s, r) => s + (parseNum(r.amount) || 0), 0));
  const remaining = round2(total - paid);
  const hasCash = rows.some((r) => r.method === "CASH" && (parseNum(r.amount) || 0) > 0);
  const noCashbox = hasCash && sessions.length === 0;
  const change = useMemo(() => {
    const cash = rows.filter((r) => r.method === "CASH");
    const got = cash.reduce((s, r) => s + (parseNum(r.received) || 0), 0);
    const due = cash.reduce((s, r) => s + (parseNum(r.amount) || 0), 0);
    return got > due ? round2(got - due) : 0;
  }, [rows]);

  const set = (i: number, patch: Partial<PayRow>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const quick = (m: PaymentMethod) => setRows([{ method: m, amount: total.toFixed(2), reference: "", received: "" }]);
  const addRow = () => setRows((l) => [...l, { method: l.some((r) => r.method === "CASH") ? "QR" : "CASH", amount: remaining > 0 ? remaining.toFixed(2) : "", reference: "", received: "" }]);

  function confirm() {
    setLocalError(null);
    for (const r of rows) {
      const a = parseNum(r.amount);
      if (a === null || Number.isNaN(a) || a <= 0) return setLocalError("Cada forma de pago necesita un importe mayor que cero.");
    }
    if (paid > total + 0.001) return setLocalError("Lo cobrado supera el total de la venta.");
    if (remaining > 0.001 && !(isCredit && hasCustomer)) return setLocalError(hasCustomer ? `Faltan Bs ${fmt(remaining)}: cobra el total o marca la venta como a crédito.` : `Faltan Bs ${fmt(remaining)} por cobrar.`);
    if (remaining > 0.001 && isCredit && !hasCustomer) return setLocalError("Para dejar saldo a crédito elige un cliente.");
    if (noCashbox) return setLocalError("Para cobrar en efectivo necesitas una caja abierta.");
    onConfirm({
      payments: rows.map((r) => ({ method: r.method, amount: round2(parseNum(r.amount) || 0), ...(r.reference.trim() ? { reference: r.reference.trim() } : {}), ...(r.method === "CASH" && sessionId ? { cashSessionId: sessionId } : {}) })),
      ...(remaining > 0.001 ? { dueDate } : {}),
    });
  }

  return (
    <div className="grid gap-4 text-[13px]" data-testid="payment-modal">
      <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-muted p-3 text-center">
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">Total</p><p className="text-[22px] font-[650] tabular-nums text-ink" data-testid="pay-total">Bs {fmt(total)}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">Cobrado</p><p className="text-[22px] font-[650] tabular-nums text-success" data-testid="pay-paid">Bs {fmt(paid)}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{remaining > 0.001 ? (isCredit ? "A crédito" : "Falta") : change > 0 ? "Vuelto" : "Saldo"}</p>
          <p className={`text-[22px] font-[650] tabular-nums ${remaining > 0.001 ? "text-danger" : change > 0 ? "text-brand" : "text-ink"}`} data-testid="pay-rest">Bs {fmt(remaining > 0.001 ? remaining : change)}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-2">Cobro rápido:</span>
        {(["CASH", "QR", "TRANSFER", "CARD"] as PaymentMethod[]).map((m) => <button key={m} type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => quick(m)}>Todo {m === "QR" ? "QR" : METHODS[m]!.toLowerCase()}</button>)}
      </div>

      {sessions.length > 0 ? (
        <label className="grid gap-1 text-xs font-medium text-ink-2">Caja desde la que se cobra
          <select aria-label="Caja" className={compact} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.register.name} · turno {s.code}</option>)}
          </select>
        </label>
      ) : (
        <p className={`flex items-start gap-2 rounded-lg px-3 py-2 ${hasCash ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`} data-testid="no-cashbox">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>No tienes una caja abierta. Los cobros en efectivo necesitan una. <Link href="/cajas" className="font-semibold underline">Abrir caja</Link> (el QR, la transferencia y la tarjeta se registran igual).</span>
        </p>
      )}

      <div className="grid gap-2" data-testid="pay-rows">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-[150px_120px_1fr_auto] sm:items-center">
            <select aria-label={`Forma de pago ${i + 1}`} className={compact} value={r.method} onChange={(e) => set(i, { method: e.target.value as PaymentMethod })}>
              {Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input aria-label={`Importe ${i + 1}`} inputMode="decimal" className={`${compact} text-right tabular-nums`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} />
            {r.method === "CASH"
              ? <input aria-label={`Efectivo recibido ${i + 1}`} inputMode="decimal" className={`${compact} text-right tabular-nums`} placeholder="Efectivo recibido (para el vuelto)" value={r.received} onChange={(e) => set(i, { received: e.target.value })} />
              : <input aria-label={`Referencia ${i + 1}`} className={compact} placeholder="Referencia o nro. de operación (opcional)" value={r.reference} onChange={(e) => set(i, { reference: e.target.value })} />}
            <button type="button" className="rounded-md p-2 text-ink-3 hover:bg-neutral-soft hover:text-danger" aria-label={`Quitar forma de pago ${i + 1}`} onClick={() => setRows((l) => l.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
          </div>
        ))}
        {rows.length === 0 && <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-center text-ink-2">Sin cobro: toda la venta queda <strong>a crédito</strong>{hasCustomer ? "" : " (necesita un cliente)"}.</p>}
        <button type="button" className="flex w-fit items-center gap-1 text-xs font-medium text-brand hover:underline" onClick={addRow}><Plus className="size-3.5" aria-hidden />Agregar forma de pago</button>
      </div>

      {remaining > 0.001 && isCredit && <p className="rounded-lg bg-warning-soft px-3 py-2 text-warning" data-testid="credit-note">Quedan <strong>Bs {fmt(remaining)}</strong> a crédito, con fecha límite de pago el <strong>{dueDate.split("-").reverse().join("/")}</strong>.</p>}

      {(localError || error) && <p role="alert" data-testid="pay-error" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{localError ?? error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>Volver</button>
        <button type="button" className={btnPrimary} onClick={confirm} disabled={busy} data-testid="confirm-payment">{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Confirmar venta</button>
      </div>
    </div>
  );
}
