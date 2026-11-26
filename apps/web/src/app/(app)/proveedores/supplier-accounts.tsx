"use client";

import type { BankAccountView, SupplierHistoryEntry, SupplierSummary } from "@erp/contracts";
import { History, Landmark, Loader2, Pencil, Plus, Star } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { PrintButton } from "@/components/print-button";
import { btnPrimary, btnSecondary, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const TYPES: Record<string, string> = { CHECKING: "Cuenta corriente", SAVINGS: "Caja de ahorro" };
const KIND: Record<string, string> = {
  BANK_ACCOUNT_ADDED: "Cuenta agregada", BANK_ACCOUNT_CHANGED: "Cuenta modificada", BANK_ACCOUNT_DEACTIVATED: "Cuenta desactivada",
  BANK_ACCOUNT_REACTIVATED: "Cuenta reactivada", CONTACT_CHANGED: "Contacto modificado",
};
const when = (iso: string) => new Date(iso).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Cuentas bancarias del proveedor (con boleta de depósito para ticket) e historial de cambios de cuentas y contacto. */
export function SupplierAccounts({ supplier, canManage, onClose }: { supplier: SupplierSummary; canManage: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"accounts" | "history">("accounts");
  const [accounts, setAccounts] = useState<BankAccountView[] | null>(null);
  const [history, setHistory] = useState<SupplierHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BankAccountView | "new" | null>(null);
  const [voucher, setVoucher] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, h] = await Promise.all([
      bff<BankAccountView[]>(`/bff/api/purchasing/suppliers/${supplier.id}/bank-accounts`, "GET"),
      bff<SupplierHistoryEntry[]>(`/bff/api/purchasing/suppliers/${supplier.id}/history`, "GET"),
    ]);
    if (a.ok) setAccounts(a.data); else setError(errorText(a));
    if (h.ok) setHistory(h.data);
  }, [supplier.id]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(a: BankAccountView) {
    const r = await bff(`/bff/api/purchasing/suppliers/${supplier.id}/bank-accounts/${a.id}`, "PATCH", { status: a.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
    if (!r.ok) return setError(errorText(r));
    setError(null); await load();
  }
  async function makeDefault(a: BankAccountView) {
    const r = await bff(`/bff/api/purchasing/suppliers/${supplier.id}/bank-accounts/${a.id}`, "PATCH", { isDefault: true });
    if (!r.ok) return setError(errorText(r));
    setError(null); await load();
  }

  const tabBtn = (id: "accounts" | "history", label: string, icon: React.ReactNode) => (
    <button type="button" onClick={() => setTab(id)} data-testid={`tab-${id}`} className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] font-medium ${tab === id ? "border-brand text-brand" : "border-transparent text-ink-2 hover:text-ink"}`}>{icon}{label}</button>
  );

  return (
    <div className="grid gap-4" data-testid="supplier-accounts">
      <div className="text-[13px] text-ink-2">
        {supplier.contactName ? <>Contacto: <strong className="text-ink">{supplier.contactName}</strong>{supplier.contactRole ? ` · ${supplier.contactRole}` : ""}{supplier.phone ? ` · ${supplier.phone}` : ""}</> : "Sin contacto registrado."}
      </div>
      <div className="flex gap-1 border-b border-line">{tabBtn("accounts", "Cuentas bancarias", <Landmark className="size-4" aria-hidden />)}{tabBtn("history", "Historial", <History className="size-4" aria-hidden />)}</div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}

      {tab === "accounts" && (
        <div className="grid gap-3">
          {accounts === null ? <p className="text-ink-2">Cargando…</p> : accounts.length === 0 && form === null && <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-[13px] text-ink-2">Este proveedor no tiene cuentas bancarias registradas.</p>}
          {accounts?.map((a) => (
            <div key={a.id} className={`rounded-lg border px-3 py-3 ${a.status === "ACTIVE" ? "border-line-strong" : "border-line bg-surface-muted text-ink-3"}`} data-testid={`account-${a.accountNumber}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">{a.bankName} · <span className="font-mono">{a.accountNumber}</span>
                    {a.isDefault && a.status === "ACTIVE" && <StatusBadge tone="info">Principal</StatusBadge>}{a.status !== "ACTIVE" && <StatusBadge tone="neutral">Inactiva</StatusBadge>}</div>
                  <div className="text-[13px] text-ink-2">{TYPES[a.accountType]} · {a.currency} · Titular: {a.holderName}{a.holderTaxId ? ` (${a.holderTaxId})` : ""}</div>
                  {a.notes && <div className="text-xs text-ink-3">{a.notes}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.status === "ACTIVE" && <button className={`${btnPrimary} h-8 px-3`} onClick={() => setVoucher(voucher === a.id ? null : a.id)} data-testid={`voucher-${a.accountNumber}`}>Boleta de depósito</button>}
                  {canManage && <>
                    <button className={`${btnSecondary} h-8 px-3`} onClick={() => setForm(a)} aria-label={`Editar cuenta ${a.accountNumber}`}><Pencil className="size-4" aria-hidden /></button>
                    {a.status === "ACTIVE" && !a.isDefault && <button className={`${btnSecondary} h-8 px-3`} onClick={() => void makeDefault(a)} title="Marcar como principal"><Star className="size-4" aria-hidden /></button>}
                    <button className={`${btnSecondary} h-8 px-3`} onClick={() => void toggle(a)}>{a.status === "ACTIVE" ? "Desactivar" : "Reactivar"}</button>
                  </>}
                </div>
              </div>
              {voucher === a.id && <VoucherPanel account={a} />}
            </div>
          ))}
          {canManage && form === null && <div><button className={btnSecondary} onClick={() => setForm("new")} data-testid="add-account"><Plus className="size-4" aria-hidden /> Agregar cuenta</button></div>}
          {form !== null && <AccountForm supplierId={supplier.id} account={form === "new" ? null : form} onCancel={() => setForm(null)} onDone={() => { setForm(null); void load(); }} />}
        </div>
      )}

      {tab === "history" && (
        <div data-testid="supplier-history">
          {history === null ? <p className="text-ink-2">Cargando…</p> : history.length === 0 ? <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-[13px] text-ink-2">Aún no hay cambios registrados.</p> : (
            <ol className="grid gap-2">
              {history.map((h) => (
                <li key={h.id} className="rounded-lg border border-line px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge tone={h.kind.includes("DEACTIVATED") ? "danger" : h.kind.includes("ADDED") ? "success" : "info"}>{KIND[h.kind] ?? h.kind}</StatusBadge><span className="text-xs text-ink-3">{when(h.createdAt)}{h.actor ? ` · ${h.actor}` : ""}</span></div>
                  <p className="mt-1 text-body">{h.summary}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="flex justify-end border-t border-line pt-3"><button className={btnSecondary} onClick={onClose}>Cerrar</button></div>
    </div>
  );
}

function VoucherPanel({ account }: { account: BankAccountView }) {
  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const n = Number(amount.replace(",", "."));
  const valid = amount.trim() === "" || (Number.isFinite(n) && n > 0);
  return (
    <div className="mt-3 grid gap-3 rounded-lg bg-surface-muted p-3 sm:grid-cols-[160px_1fr] sm:items-end" data-testid="voucher-panel">
      <Field label={`Monto (${account.currency})`} hint="Vacío = se deja para llenar a mano."><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="voucher-amount" /></Field>
      <Field label="Concepto"><input className={inputCls} value={concept} onChange={(e) => setConcept(e.target.value)} maxLength={120} placeholder="Ej.: Pago factura 123" data-testid="voucher-concept" /></Field>
      <span className={`sm:col-span-2 ${valid ? "" : "pointer-events-none opacity-50"}`}>
        <PrintButton docType="SUPPLIER_DEPOSIT" id={account.id} label="Imprimir boleta" params={{ ...(amount.trim() && valid ? { amount: n } : {}), ...(concept.trim() ? { concept: concept.trim() } : {}) }} />
      </span>
    </div>
  );
}

function AccountForm({ supplierId, account, onDone, onCancel }: { supplierId: string; account: BankAccountView | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    bankName: account?.bankName ?? "", accountNumber: account?.accountNumber ?? "", accountType: account?.accountType ?? "CHECKING", currency: account?.currency ?? "BOB",
    holderName: account?.holderName ?? "", holderTaxId: account?.holderTaxId ?? "", notes: account?.notes ?? "", isDefault: account?.isDefault ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const body = { ...f, holderTaxId: f.holderTaxId, notes: f.notes };
    const r = account
      ? await bff(`/bff/api/purchasing/suppliers/${supplierId}/bank-accounts/${account.id}`, "PATCH", body)
      : await bff(`/bff/api/purchasing/suppliers/${supplierId}/bank-accounts`, "POST", body);
    setBusy(false);
    if (r.ok) return onDone();
    setError(r.status === 400 && r.data.code === "VALIDATION" ? "Revisa los datos: banco y titular (mín. 2 letras) y un número de cuenta válido (mín. 4 caracteres)." : errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-line-strong p-3" data-testid="account-form">
      <h4 className="text-[14px] font-semibold text-ink">{account ? "Modificar cuenta" : "Nueva cuenta bancaria"}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Banco"><input className={inputCls} value={f.bankName} onChange={(e) => set("bankName", e.target.value)} required maxLength={80} data-testid="acc-bank" /></Field>
        <Field label="Número de cuenta"><input className={inputCls} value={f.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} required maxLength={40} data-testid="acc-number" /></Field>
        <Field label="Tipo"><select className={inputCls} value={f.accountType} onChange={(e) => set("accountType", e.target.value as "CHECKING" | "SAVINGS")}><option value="CHECKING">Cuenta corriente</option><option value="SAVINGS">Caja de ahorro</option></select></Field>
        <Field label="Moneda"><select className={inputCls} value={f.currency} onChange={(e) => set("currency", e.target.value as "BOB" | "USD")}><option value="BOB">Bolivianos (BOB)</option><option value="USD">Dólares (USD)</option></select></Field>
        <Field label="Titular"><input className={inputCls} value={f.holderName} onChange={(e) => set("holderName", e.target.value)} required maxLength={120} data-testid="acc-holder" /></Field>
        <Field label="NIT / CI del titular"><input className={inputCls} value={f.holderTaxId} onChange={(e) => set("holderTaxId", e.target.value)} maxLength={30} /></Field>
        <Field label="Notas" className="sm:col-span-2"><input className={inputCls} value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={200} /></Field>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-body"><input type="checkbox" checked={f.isDefault} onChange={(e) => set("isDefault", e.target.checked)} /> Cuenta principal del proveedor</label>
      {account && <p className="text-xs text-ink-3">El cambio quedará en el historial con el valor anterior y el nuevo.</p>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy} data-testid="acc-save">{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar</button>
      </div>
    </form>
  );
}
