"use client";

import type { ValuationPolicySummary, WarehouseSummary } from "@erp/contracts";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

type Method = "FIFO" | "LIFO" | "AVERAGE";
const METHOD: Record<Method, [string, string]> = {
  FIFO: ["FIFO (primero en entrar, primero en salir)", "Cada salida cuesta lo que costó el lote más antiguo."],
  LIFO: ["LIFO (último en entrar, primero en salir)", "Cada salida cuesta lo que costó el lote más reciente."],
  AVERAGE: ["Costo promedio ponderado", "Cada salida cuesta el promedio del almacén. El lote se asigna igual, por trazabilidad."],
};

interface Props {
  warehouses: WarehouseSummary[];
  branches: { id: string; name: string }[];
  policy: { current: Method; policies: ValuationPolicySummary[] };
  canManage: boolean;
}

export function WarehousesManager({ warehouses, branches, policy, canManage }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<WarehouseSummary | "new" | null>(null);
  const [method, setMethod] = useState<Method>(policy.current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changeMethod() {
    if (!window.confirm(`¿Cambiar el método de valoración a «${METHOD[method][0]}» desde hoy? No se reescribe el historial.`)) return;
    setBusy(true); setMsg(null);
    const r = await bff<{ revaluations: number }>("/bff/api/inventory/valuation/policy", "POST", { method });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: errorText(r) });
    setMsg({ ok: true, text: r.data.revaluations ? `Método cambiado. Se generaron ${r.data.revaluations} revaluación(es) para alinear el valor con el costo de los lotes.` : "Método cambiado." });
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Almacenes ({warehouses.length})</h2>
          {canManage && <button className={btnPrimary} onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Nuevo almacén</button>}
        </div>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Almacén</th><th className="px-3 font-medium">Sucursal</th><th className="px-3 font-medium">Estado</th>{canManage && <th className="px-5" />}</tr></thead>
            <tbody>
              {warehouses.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-ink-2">Aún no hay almacenes. {canManage ? "Crea el primero con «Nuevo almacén»." : ""}</td></tr>}
              {warehouses.map((w) => (
                <tr key={w.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                  <td className="px-5"><span className="font-medium text-ink">{w.name}</span><span className="block text-xs text-ink-3">{w.code}</span></td>
                  <td className="px-3">{w.branch.name}</td>
                  <td className="px-3"><StatusBadge tone={w.status === "ACTIVE" ? "success" : "neutral"}>{w.status === "ACTIVE" ? "Activo" : "Inactivo"}</StatusBadge></td>
                  {canManage && <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing(w)}>Editar</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-base font-semibold text-ink">Método de valoración</h2>
        <p className="mb-4 text-[13px] text-ink-2">Define cómo se costean las salidas. Rige desde hoy hacia adelante; lo ya registrado no cambia. Solo se puede cambiar una vez por día.</p>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Método de valoración">
          {(Object.keys(METHOD) as Method[]).map((m) => (
            <label key={m} className={`cursor-pointer rounded-lg border p-3 text-[13px] ${method === m ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-muted"} ${canManage ? "" : "opacity-70"}`}>
              <input type="radio" name="method" className="sr-only" checked={method === m} onChange={() => setMethod(m)} disabled={!canManage} />
              <span className="font-medium text-ink">{METHOD[m][0]}</span>
              <span className="mt-1 block text-xs text-ink-2">{METHOD[m][1]}</span>
              {policy.current === m && <span className="mt-2 inline-block"><StatusBadge tone="success">Vigente</StatusBadge></span>}
            </label>
          ))}
        </div>
        {canManage && (
          <div className="mt-4 flex items-center gap-3">
            <button className={btnPrimary} onClick={changeMethod} disabled={busy || method === policy.current}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Aplicar método</button>
            {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
          </div>
        )}
        {policy.policies.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Historial de cambios</h3>
            <ul className="grid gap-1 text-[13px] text-body">
              {policy.policies.map((p) => <li key={p.id}>{p.effectiveFrom} · {METHOD[p.method as Method][0].split(" (")[0]} · {p.productCode ? `solo ${p.productCode}` : "toda la empresa"}</li>)}
            </ul>
          </div>
        )}
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nuevo almacén" : "Editar almacén"}>
        {editing && <WarehouseForm warehouse={editing === "new" ? null : editing} branches={branches} onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function WarehouseForm({ warehouse, branches, onDone, onCancel }: { warehouse: WarehouseSummary | null; branches: { id: string; name: string }[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ code: warehouse?.code ?? "", name: warehouse?.name ?? "", branchId: warehouse?.branch.id ?? branches[0]?.id ?? "", status: warehouse?.status ?? "ACTIVE" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = warehouse
      ? await bff(`/bff/api/inventory/warehouses/${warehouse.id}`, "PATCH", { name: f.name, status: f.status })
      : await bff("/bff/api/inventory/warehouses", "POST", { code: f.code.trim(), name: f.name, branchId: f.branchId });
    setBusy(false);
    if (r.ok) return onDone();
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa los datos: el código admite letras, números, punto, guion o guion bajo.");
    else setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Código" hint={warehouse ? "No se puede cambiar." : undefined}><input className={`${inputCls} ${warehouse ? "bg-surface-muted" : ""}`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={!!warehouse} required maxLength={32} /></Field>
      <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
      <Field label="Sucursal" hint={warehouse ? "No se puede cambiar." : undefined}>
        <select className={`${inputCls} ${warehouse ? "bg-surface-muted" : ""}`} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} disabled={!!warehouse} required>
          {warehouse ? <option value={warehouse.branch.id}>{warehouse.branch.name}</option> : branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      {warehouse && <Field label="Estado"><select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "ACTIVE" | "INACTIVE" })}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></Field>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar</button>
      </div>
    </form>
  );
}
