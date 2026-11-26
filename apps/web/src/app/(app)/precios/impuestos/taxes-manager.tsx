"use client";

import type { TaxCodeSummary, TaxProfileSummary } from "@erp/contracts";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

type Tab = "codes" | "profiles";
type Editing =
  | { kind: "code"; item: TaxCodeSummary | null }
  | { kind: "rate"; item: TaxCodeSummary }
  | { kind: "profile"; item: TaxProfileSummary | null }
  | null;

const APPLIES = { PRODUCT: "Producto", CUSTOMER: "Cliente", OPERATION: "Operación" } as const;
const th = "px-3 font-medium";
const today = () => new Date().toISOString().slice(0, 10);

export function TaxesManager({ codes, profiles, canManage }: { codes: TaxCodeSummary[]; profiles: TaxProfileSummary[]; canManage: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("codes");
  const [editing, setEditing] = useState<Editing>(null);
  const done = () => { setEditing(null); router.refresh(); };

  return (
    <>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Impuestos" className="flex gap-1 rounded-lg bg-neutral-soft p-1">
            {([["codes", "Impuestos y tasas", codes.length], ["profiles", "Perfiles fiscales", profiles.length]] as const).map(([id, label, n]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium ${tab === id ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}>
                {label} ({n})
              </button>
            ))}
          </div>
          {canManage && (
            <button className={btnPrimary} onClick={() => setEditing(tab === "codes" ? { kind: "code", item: null } : { kind: "profile", item: null })}>
              <Plus className="size-4" aria-hidden /> {tab === "codes" ? "Nuevo impuesto" : "Nuevo perfil"}
            </button>
          )}
        </div>

        <div className="-mx-5 overflow-x-auto">
          {tab === "codes" ? (
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Impuesto</th><th className={th}>Jurisdicción</th><th className={th}>Tasa vigente</th><th className={th}>Historial de tasas</th><th className={th}>Estado</th>{canManage && <th className="px-5" />}</tr></thead>
              <tbody>
                {codes.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-2">Aún no hay impuestos. {canManage ? "Crea el primero con «Nuevo impuesto»." : ""}</td></tr>}
                {codes.map((c) => (
                  <tr key={c.id} className="border-b border-line-strong/40 align-top text-body hover:bg-surface-muted">
                    <td className="px-5 py-3"><span className="font-medium text-ink">{c.name}</span><span className="block text-xs text-ink-3">{c.code}</span></td>
                    <td className="px-3 py-3 text-ink-2">{c.jurisdiction ?? "—"}</td>
                    <td className="px-3 py-3 font-medium tabular-nums text-ink">{c.currentRate === null ? <span className="font-normal text-warning">Sin tasa vigente</span> : `${num(c.currentRate, 6)} %`}</td>
                    <td className="px-3 py-3 text-xs tabular-nums text-ink-2">
                      {c.rates.map((r) => <div key={r.validFrom}>{num(r.rate, 6)} % · {r.validFrom} → {r.validTo ?? "vigente"}</div>)}
                    </td>
                    <td className="px-3 py-3"><StatusBadge tone={c.status === "ACTIVE" ? "success" : "neutral"}>{c.status === "ACTIVE" ? "Activo" : "Inactivo"}</StatusBadge></td>
                    {canManage && (
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing({ kind: "rate", item: c })}>Nueva tasa</button>
                          <button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing({ kind: "code", item: c })}>Editar</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Perfil</th><th className={th}>Aplica a</th><th className={th}>Reglas</th><th className={th}>Productos</th><th className={th}>Estado</th>{canManage && <th className="px-5" />}</tr></thead>
              <tbody>
                {profiles.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-2">Aún no hay perfiles fiscales.</td></tr>}
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-line-strong/40 align-top text-body hover:bg-surface-muted">
                    <td className="px-5 py-3"><span className="font-medium text-ink">{p.name}</span><span className="block text-xs text-ink-3">{p.code}</span></td>
                    <td className="px-3 py-3 text-ink-2">{APPLIES[p.appliesTo]}</td>
                    <td className="px-3 py-3 text-xs">
                      {p.rules.length === 0 ? <span className="text-ink-3">Sin reglas (no aplica impuestos)</span> : p.rules.map((r, i) => (
                        <div key={i}>{r.taxCode}{r.exemptionReason ? <span className="text-warning"> · exento: {r.exemptionReason}</span> : ""} <span className="text-ink-3">· prioridad {r.priority}</span></div>
                      ))}
                    </td>
                    <td className="px-3 py-3 tabular-nums">{p.products}</td>
                    <td className="px-3 py-3"><StatusBadge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status === "ACTIVE" ? "Activo" : "Inactivo"}</StatusBadge></td>
                    {canManage && <td className="px-5 py-3 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing({ kind: "profile", item: p })}>Editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal open={editing?.kind === "code"} onClose={() => setEditing(null)} title={editing?.kind === "code" && editing.item ? "Editar impuesto" : "Nuevo impuesto"}>
        {editing?.kind === "code" && <CodeForm item={editing.item} onDone={done} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal open={editing?.kind === "rate"} onClose={() => setEditing(null)} title={editing?.kind === "rate" ? `Nueva tasa · ${editing.item.name}` : "Nueva tasa"}>
        {editing?.kind === "rate" && <RateForm item={editing.item} onDone={done} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal open={editing?.kind === "profile"} onClose={() => setEditing(null)} title={editing?.kind === "profile" && editing.item ? "Editar perfil fiscal" : "Nuevo perfil fiscal"} size="lg">
        {editing?.kind === "profile" && <ProfileForm item={editing.item} codes={codes} onDone={done} onCancel={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function Actions({ busy, error, onCancel }: { busy: boolean; error: string | null; onCancel: () => void }) {
  return (
    <>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar</button>
      </div>
    </>
  );
}

function useSubmit(run: () => Promise<{ ok: boolean; status: number; data: Record<string, any> }>, onDone: () => void, validation: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (r.ok) return onDone();
    setError(r.status === 400 && r.data.code === "VALIDATION" ? validation : errorText(r));
  }
  return { busy, error, submit };
}

function CodeForm({ item, onDone, onCancel }: { item: TaxCodeSummary | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ code: item?.code ?? "", name: item?.name ?? "", jurisdiction: item?.jurisdiction ?? "", rate: "", validFrom: today(), status: item?.status ?? "ACTIVE" });
  const { busy, error, submit } = useSubmit(
    () => item
      ? bff(`/bff/api/taxes/codes/${item.id}`, "PATCH", { name: f.name, jurisdiction: f.jurisdiction.trim() || null, status: f.status })
      : bff("/bff/api/taxes/codes", "POST", { code: f.code.trim(), name: f.name, ...(f.jurisdiction.trim() ? { jurisdiction: f.jurisdiction.trim() } : {}), rate: { rate: Number(f.rate), validFrom: f.validFrom } }),
    onDone, "Revisa los datos: la tasa va de 0 a 100 (máx. 6 decimales) y el código admite letras, números, punto, guion o guion bajo.",
  );
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Código" hint={item ? "No se puede cambiar." : undefined}><input className={`${inputCls} ${item ? "bg-surface-muted" : ""}`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={!!item} required maxLength={32} /></Field>
      <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
      <Field label="Jurisdicción (opcional)"><input className={inputCls} value={f.jurisdiction} onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} maxLength={60} /></Field>
      {!item ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tasa inicial (%)"><input type="number" step="any" min="0" max="100" className={inputCls} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} required /></Field>
          <Field label="Vigente desde"><input type="date" className={inputCls} value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} required /></Field>
        </div>
      ) : (
        <Field label="Estado"><select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "ACTIVE" | "INACTIVE" })}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></Field>
      )}
      <Actions busy={busy} error={error} onCancel={onCancel} />
    </form>
  );
}

function RateForm({ item, onDone, onCancel }: { item: TaxCodeSummary; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ rate: "", validFrom: today() });
  const { busy, error, submit } = useSubmit(
    () => bff(`/bff/api/taxes/codes/${item.id}/rates`, "POST", { rate: Number(f.rate), validFrom: f.validFrom }),
    onDone, "Revisa los datos: la tasa va de 0 a 100 (máx. 6 decimales).",
  );
  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-[13px] text-ink-2">La tasa anterior se cierra el día previo a la fecha de inicio. Las ventas ya hechas conservan la tasa con la que se calcularon.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tasa (%)"><input type="number" step="any" min="0" max="100" className={inputCls} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} required autoFocus /></Field>
        <Field label="Vigente desde"><input type="date" className={inputCls} value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} required /></Field>
      </div>
      <Actions busy={busy} error={error} onCancel={onCancel} />
    </form>
  );
}

interface RuleRow { taxCodeId: string; priority: string; exempt: boolean; reason: string }

function ProfileForm({ item, codes, onDone, onCancel }: { item: TaxProfileSummary | null; codes: TaxCodeSummary[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ code: item?.code ?? "", name: item?.name ?? "", appliesTo: item?.appliesTo ?? "PRODUCT", status: item?.status ?? "ACTIVE" });
  const [rules, setRules] = useState<RuleRow[]>((item?.rules ?? []).map((r) => ({ taxCodeId: r.taxCodeId, priority: String(r.priority), exempt: !!r.exemptionReason, reason: r.exemptionReason ?? "" })));
  const payloadRules = rules.filter((r) => r.taxCodeId).map((r) => ({ taxCodeId: r.taxCodeId, priority: Number(r.priority || 0), exemptionReason: r.exempt ? r.reason.trim() : null }));
  const { busy, error, submit } = useSubmit(
    () => item
      ? bff(`/bff/api/taxes/profiles/${item.id}`, "PATCH", { name: f.name, status: f.status, rules: payloadRules })
      : bff("/bff/api/taxes/profiles", "POST", { code: f.code.trim(), name: f.name, appliesTo: f.appliesTo, rules: payloadRules }),
    onDone, "Revisa los datos: toda exención necesita un motivo de al menos 3 caracteres.",
  );
  const setRule = (i: number, patch: Partial<RuleRow>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código" hint={item ? "No se puede cambiar." : undefined}><input className={`${inputCls} ${item ? "bg-surface-muted" : ""}`} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} disabled={!!item} required maxLength={32} /></Field>
        <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
        <Field label="Aplica a" hint={item ? "No se puede cambiar." : undefined}>
          <select className={`${inputCls} ${item ? "bg-surface-muted" : ""}`} value={f.appliesTo} onChange={(e) => setF({ ...f, appliesTo: e.target.value as typeof f.appliesTo })} disabled={!!item}>
            {Object.entries(APPLIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {item && <Field label="Estado"><select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "ACTIVE" | "INACTIVE" })}><option value="ACTIVE">Activo</option><option value="INACTIVE">Inactivo</option></select></Field>}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-medium text-ink-2">Reglas: impuestos que se aplican con este perfil</legend>
        {rules.length === 0 && <p className="text-xs text-ink-3">Sin reglas, el producto no genera impuestos.</p>}
        {rules.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_90px_auto]">
            <select aria-label={`Impuesto, regla ${i + 1}`} className={inputCls} value={r.taxCodeId} onChange={(e) => setRule(i, { taxCodeId: e.target.value })} required>
              <option value="">Elige un impuesto</option>
              {codes.filter((c) => c.status === "ACTIVE" || c.id === r.taxCodeId).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
            <input aria-label={`Prioridad, regla ${i + 1}`} type="number" min={0} max={1000} className={inputCls} value={r.priority} onChange={(e) => setRule(i, { priority: e.target.value })} title="Prioridad" />
            <button type="button" className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} aria-label={`Quitar regla ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
            <label className="flex items-center gap-2 text-[13px] text-body sm:col-span-3">
              <input type="checkbox" checked={r.exempt} onChange={(e) => setRule(i, { exempt: e.target.checked })} /> Exento (el impuesto se calcula con tasa 0 y se deja constancia del motivo)
            </label>
            {r.exempt && <input aria-label={`Motivo de exención, regla ${i + 1}`} className={`${inputCls} sm:col-span-3`} placeholder="Motivo de la exención" value={r.reason} onChange={(e) => setRule(i, { reason: e.target.value })} required minLength={3} maxLength={200} />}
          </div>
        ))}
        <div><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={() => setRules((rs) => [...rs, { taxCodeId: "", priority: String(rs.length), exempt: false, reason: "" }])}><Plus className="size-3.5" aria-hidden /> Agregar regla</button></div>
      </fieldset>
      <Actions busy={busy} error={error} onCancel={onCancel} />
    </form>
  );
}
