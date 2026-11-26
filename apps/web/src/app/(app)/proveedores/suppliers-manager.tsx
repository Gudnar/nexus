"use client";

import type { SupplierSummary } from "@erp/contracts";
import { Building2, Landmark, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { SupplierAccounts } from "./supplier-accounts";

export function SuppliersManager({ suppliers, canManage }: { suppliers: SupplierSummary[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SupplierSummary | "new" | null>(null);
  const [accountsOf, setAccountsOf] = useState<SupplierSummary | null>(null);
  return (
    <>
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Proveedores ({suppliers.length})</h2>
          {canManage && <button className={btnPrimary} onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Nuevo proveedor</button>}
        </div>
        {suppliers.length === 0 ? (
          <EmptyState icon={Building2} title="Aún no hay proveedores" description={canManage ? "Crea el primero con «Nuevo proveedor»." : "Cuando existan, aparecerán aquí."} />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Proveedor</th><th className="px-3 font-medium">NIT / ID</th><th className="px-3 font-medium">Contacto</th><th className="px-3 font-medium">Plazo de pago</th><th className="px-3 font-medium">Órdenes</th><th className="px-3 font-medium">Estado</th><th className="px-5" /></tr></thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="h-[52px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5"><span className="font-medium text-ink">{s.name}</span><span className="block text-xs text-ink-3">{s.code}</span></td>
                    <td className="px-3 text-ink-2">{s.taxId ?? "—"}</td>
                    <td className="px-3 text-ink-2">{[s.contactName && s.contactRole ? `${s.contactName} (${s.contactRole})` : s.contactName, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3">{s.paymentTermsDays ? `${s.paymentTermsDays} días` : "Contado"}</td>
                    <td className="px-3 tabular-nums">{s.orders}</td>
                    <td className="px-3"><StatusBadge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{s.status === "ACTIVE" ? "Activo" : "Inactivo"}</StatusBadge></td>
                    <td className="px-5 text-right"><span className="inline-flex gap-2"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setAccountsOf(s)} data-testid={`accounts-${s.code}`}><Landmark className="size-4" aria-hidden /> Cuentas</button>{canManage && <button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing(s)}>Editar</button>}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nuevo proveedor" : "Editar proveedor"} size="lg">
        {editing && <SupplierForm supplier={editing === "new" ? null : editing} onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal open={accountsOf !== null} onClose={() => setAccountsOf(null)} title={accountsOf ? `Cuentas e historial · ${accountsOf.name}` : "Cuentas"} size="lg">
        {accountsOf && <SupplierAccounts key={accountsOf.id} supplier={accountsOf} canManage={canManage} onClose={() => setAccountsOf(null)} />}
      </Modal>
    </>
  );
}

function SupplierForm({ supplier, onDone, onCancel }: { supplier: SupplierSummary | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    code: supplier?.code ?? "", name: supplier?.name ?? "", taxId: supplier?.taxId ?? "", contactName: supplier?.contactName ?? "", contactRole: supplier?.contactRole ?? "", email: supplier?.email ?? "",
    phone: supplier?.phone ?? "", address: supplier?.address ?? "", paymentTermsDays: String(supplier?.paymentTermsDays ?? 0), status: supplier?.status ?? "ACTIVE",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const common = { name: f.name, taxId: f.taxId, contactName: f.contactName, contactRole: f.contactRole, email: f.email, phone: f.phone, address: f.address, paymentTermsDays: Number(f.paymentTermsDays) };
    const r = supplier
      ? await bff(`/bff/api/purchasing/suppliers/${supplier.id}`, "PATCH", { ...common, status: f.status })
      : await bff("/bff/api/purchasing/suppliers", "POST", { ...common, code: f.code.trim() });
    setBusy(false);
    if (r.ok) return onDone();
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa los datos: el código admite letras, números, punto, guion o guion bajo; el correo debe ser válido; el plazo va de 0 a 365 días.");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código" hint={supplier ? "No se puede cambiar." : undefined}><input className={`${inputCls} ${supplier ? "bg-surface-muted" : ""}`} value={f.code} onChange={(e) => set("code", e.target.value)} disabled={!!supplier} required maxLength={32} /></Field>
        <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={120} /></Field>
        <Field label="NIT / documento"><input className={inputCls} value={f.taxId} onChange={(e) => set("taxId", e.target.value)} maxLength={30} /></Field>
        <Field label="Contacto"><input className={inputCls} value={f.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={80} /></Field>
        <Field label="Cargo del contacto" hint={supplier ? "Los cambios del contacto quedan en el historial." : undefined}><input className={inputCls} value={f.contactRole} onChange={(e) => set("contactRole", e.target.value)} maxLength={80} placeholder="Ej.: Gerente de ventas" data-testid="sup-role" /></Field>
        <Field label="Correo"><input type="email" className={inputCls} value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={120} /></Field>
        <Field label="Teléfono"><input className={inputCls} value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} /></Field>
        <Field label="Dirección" className="sm:col-span-2"><input className={inputCls} value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={200} /></Field>
        <Field label="Plazo de pago (días)" hint="0 = contado."><input type="number" min={0} max={365} className={inputCls} value={f.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} /></Field>
        {supplier && <Field label="Estado"><select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></Field>}
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar</button>
      </div>
    </form>
  );
}
