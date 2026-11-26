"use client";

import type { CustomerSummary } from "@erp/contracts";
import { Loader2, Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, money } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

interface ListOpt { id: string; name: string; code: string }

export function CustomersManager({ customers, lists, canManage }: { customers: CustomerSummary[]; lists: ListOpt[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<CustomerSummary | "new" | null>(null);
  const [q, setQ] = useState("");
  const shown = customers.filter((c) => !q.trim() || [c.name, c.code, c.taxId ?? ""].some((x) => x.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <input className={`${inputCls.replace("w-full ", "")} w-[260px]`} placeholder="Buscar por nombre, código o NIT" aria-label="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
          {canManage && <button className={btnPrimary} onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Nuevo cliente</button>}
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={Users} title={customers.length ? "Sin resultados" : "Aún no hay clientes"} description={customers.length ? "Prueba con otra búsqueda." : canManage ? "Crea el primero con «Nuevo cliente». Las ventas también pueden hacerse a consumidor final, sin cliente." : "Cuando existan, aparecerán aquí."} />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Cliente</th><th className="px-3 font-medium">NIT / documento</th><th className="px-3 font-medium">Contacto</th><th className="px-3 font-medium">Lista de precios</th><th className="px-3 font-medium">Crédito</th><th className="px-3 text-right font-medium">Por cobrar</th><th className="px-3 font-medium">Estado</th>{canManage && <th className="px-5" />}</tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="h-[52px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                    <td className="px-5"><span className="font-medium text-ink">{c.name}</span><span className="block text-xs text-ink-3">{c.code}</span></td>
                    <td className="px-3 text-ink-2">{c.taxId ?? "—"}</td>
                    <td className="px-3 text-ink-2">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3">{c.defaultPriceList?.name ?? <span className="text-ink-3">Automática</span>}</td>
                    <td className="px-3 text-xs">{c.creditLimit ? `Límite ${money(c.creditLimit)}` : "Sin límite"}{c.paymentTermsDays ? ` · ${c.paymentTermsDays} días` : ""}</td>
                    <td className={`px-3 text-right tabular-nums ${Number(c.outstanding) > 0 ? "font-medium text-warning" : "text-ink-3"}`}>{money(c.outstanding)}</td>
                    <td className="px-3"><StatusBadge tone={c.status === "ACTIVE" ? "success" : "neutral"}>{c.status === "ACTIVE" ? "Activo" : "Inactivo"}</StatusBadge></td>
                    {canManage && <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing(c)}>Editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nuevo cliente" : "Editar cliente"} size="lg">
        {editing && <CustomerForm customer={editing === "new" ? null : editing} lists={lists} onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function CustomerForm({ customer, lists, onDone, onCancel }: { customer: CustomerSummary | null; lists: ListOpt[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    code: customer?.code ?? "", name: customer?.name ?? "", taxId: customer?.taxId ?? "", email: customer?.email ?? "", phone: customer?.phone ?? "", address: customer?.address ?? "",
    listId: customer?.defaultPriceList?.id ?? "", terms: String(customer?.paymentTermsDays ?? 0), limit: customer?.creditLimit ? String(Number(customer.creditLimit)) : "", status: customer?.status ?? "ACTIVE",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const common = {
      name: f.name, taxId: f.taxId, email: f.email, phone: f.phone, address: f.address, defaultPriceListId: f.listId || null,
      paymentTermsDays: Number(f.terms), creditLimit: f.limit.trim() === "" ? null : Number(f.limit),
    };
    const r = customer
      ? await bff(`/bff/api/sales/customers/${customer.id}`, "PATCH", { ...common, status: f.status })
      : await bff("/bff/api/sales/customers", "POST", { ...common, ...(f.code.trim() ? { code: f.code.trim() } : {}) });
    setBusy(false);
    if (r.ok) return onDone();
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa los datos: el correo debe ser válido, el plazo va de 0 a 365 días y el límite no puede ser negativo.");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código" hint={customer ? "No se puede cambiar." : "Vacío = automático (C-000001…)"}><input className={`${inputCls} ${customer ? "bg-surface-muted" : ""}`} value={f.code} onChange={(e) => set("code", e.target.value)} disabled={!!customer} maxLength={32} /></Field>
        <Field label="Nombre o razón social"><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={120} /></Field>
        <Field label="NIT / documento"><input className={inputCls} value={f.taxId} onChange={(e) => set("taxId", e.target.value)} maxLength={30} /></Field>
        <Field label="Teléfono"><input className={inputCls} value={f.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} /></Field>
        <Field label="Correo"><input type="email" className={inputCls} value={f.email} onChange={(e) => set("email", e.target.value)} maxLength={120} /></Field>
        <Field label="Dirección"><input className={inputCls} value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={200} /></Field>
        <Field label="Lista de precios" hint="Si no eliges una, se usa la que corresponda por sucursal y canal.">
          <select className={inputCls} value={f.listId} onChange={(e) => set("listId", e.target.value)}><option value="">Automática</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}</select>
        </Field>
        <Field label="Plazo de pago (días)"><input type="number" min={0} max={365} className={inputCls} value={f.terms} onChange={(e) => set("terms", e.target.value)} /></Field>
        <Field label="Límite de crédito" hint="Deuda máxima pendiente. Vacío = sin límite."><input type="number" min={0} step="any" className={inputCls} value={f.limit} onChange={(e) => set("limit", e.target.value)} /></Field>
        {customer && <Field label="Estado"><select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value)}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></Field>}
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar</button>
      </div>
    </form>
  );
}
