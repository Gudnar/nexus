"use client";

import type { BrandSummary, UnitSummary } from "@erp/contracts";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import type { FlatCategory } from "@/lib/category-tree";

type Tab = "categories" | "brands" | "units";
type Editing = { kind: Tab; item: FlatCategory | BrandSummary | UnitSummary | null } | null;

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

const StatusCell = ({ s }: { s: "ACTIVE" | "INACTIVE" }) => <StatusBadge tone={s === "ACTIVE" ? "success" : "neutral"}>{s === "ACTIVE" ? "Activo" : "Inactivo"}</StatusBadge>;

export function MastersManager({
  categories, brands, units, canManage,
}: { categories: FlatCategory[]; brands: BrandSummary[]; units: UnitSummary[]; canManage: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("categories");
  const [editing, setEditing] = useState<Editing>(null);
  const tabs: [Tab, string, number][] = [["categories", "Categorías", categories.length], ["brands", "Marcas", brands.length], ["units", "Unidades de medida", units.length]];
  const th = "px-3 font-medium";

  return (
    <>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Maestros" className="flex gap-1 rounded-lg bg-neutral-soft p-1">
            {tabs.map(([id, label, n]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium ${tab === id ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"}`}>
                {label} ({n})
              </button>
            ))}
          </div>
          {canManage && (
            <button className={btnPrimary} onClick={() => setEditing({ kind: tab, item: null })}>
              <Plus className="size-4" aria-hidden /> {tab === "categories" ? "Nueva categoría" : tab === "brands" ? "Nueva marca" : "Nueva unidad"}
            </button>
          )}
        </div>

        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            {tab === "categories" && (
              <>
                <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Categoría</th><th className={th}>Código</th><th className={th}>Productos</th><th className={th}>Estado</th>{canManage && <th className="px-5" />}</tr></thead>
                <tbody>
                  {categories.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-2">Aún no hay categorías.</td></tr>}
                  {categories.map((c) => (
                    <tr key={c.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                      <td className="px-5 font-medium text-ink" style={{ paddingLeft: 20 + c.depth * 22 }}>{c.depth > 0 && <span className="mr-1.5 text-ink-3">↳</span>}{c.name}</td>
                      <td className="px-3 text-ink-2">{c.code}</td><td className="px-3 tabular-nums">{c.products}</td><td className="px-3"><StatusCell s={c.status} /></td>
                      {canManage && <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing({ kind: "categories", item: c })}>Editar</button></td>}
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "brands" && (
              <>
                <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Marca</th><th className={th}>Productos</th><th className={th}>Estado</th>{canManage && <th className="px-5" />}</tr></thead>
                <tbody>
                  {brands.length === 0 && <tr><td colSpan={4} className="px-5 py-8 text-center text-ink-2">Aún no hay marcas.</td></tr>}
                  {brands.map((b) => (
                    <tr key={b.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                      <td className="px-5 font-medium text-ink">{b.name}</td><td className="px-3 tabular-nums">{b.products}</td><td className="px-3"><StatusCell s={b.status} /></td>
                      {canManage && <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing({ kind: "brands", item: b })}>Editar</button></td>}
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "units" && (
              <>
                <thead><tr className="h-[42px] border-y border-line text-ink-2"><th className="px-5 font-medium">Código</th><th className={th}>Nombre</th><th className={th}>Decimales</th><th className={th}>Productos</th><th className={th}>Estado</th>{canManage && <th className="px-5" />}</tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                      <td className="px-5 font-medium text-ink">{u.code}</td><td className="px-3">{u.name}</td><td className="px-3 tabular-nums">{u.decimals}</td><td className="px-3 tabular-nums">{u.products}</td><td className="px-3"><StatusCell s={u.status} /></td>
                      {canManage && <td className="px-5 text-right"><button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing({ kind: "units", item: u })}>Editar</button></td>}
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      </Card>

      <Modal
        open={editing !== null} onClose={() => setEditing(null)}
        title={editing ? `${editing.item ? "Editar" : "Nueva"} ${editing.kind === "categories" ? "categoría" : editing.kind === "brands" ? "marca" : "unidad"}` : ""}
      >
        {editing && <MasterForm editing={editing} categories={categories} onDone={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function MasterForm({ editing, categories, onDone, onCancel }: { editing: NonNullable<Editing>; categories: FlatCategory[]; onDone: () => void; onCancel: () => void }) {
  const { kind, item } = editing;
  const isNew = item === null;
  const cat = item as FlatCategory | null;
  const unit = item as UnitSummary | null;
  const [code, setCode] = useState((item as { code?: string } | null)?.code ?? "");
  const [name, setName] = useState((item as { name?: string } | null)?.name ?? "");
  const [parentId, setParentId] = useState(cat?.parentId ?? "");
  const [decimals, setDecimals] = useState(String(unit?.decimals ?? 0));
  const [active, setActive] = useState((item as { status?: string } | null)?.status !== "INACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const base = `/bff/api/catalog/${kind}`;
    const status = active ? "ACTIVE" : "INACTIVE";
    let body: object;
    if (kind === "categories") body = isNew ? { code, name, parentId: parentId || null } : { name, parentId: parentId || null, status };
    else if (kind === "brands") body = isNew ? { name } : { name, status };
    else body = isNew ? { code, name, decimals: Number(decimals) } : { name, decimals: Number(decimals), status };
    const r = isNew ? await bff(base, "POST", body) : await bff(`${base}/${(item as { id: string }).id}`, "PATCH", body);
    setBusy(false);
    if (r.ok) return onDone();
    setError(r.status === 400 && r.data.code === "VALIDATION" ? "Revisa los datos (código: letras, números, punto, guion; decimales entre 0 y 6)." : errorText(r));
  }

  // Una categoría no puede colgar de sí misma ni de sus descendientes (la API también lo valida).
  const blocked = new Set<string>();
  if (cat) {
    blocked.add(cat.id);
    for (let grew = true; grew; ) { grew = false; for (const c of categories) if (c.parentId && blocked.has(c.parentId) && !blocked.has(c.id)) { blocked.add(c.id); grew = true; } }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {kind !== "brands" && (
        <Field label="Código" hint={isNew ? undefined : "No se puede cambiar."}>
          <input className={`${inputCls} uppercase ${isNew ? "" : "bg-surface-muted text-ink-2"}`} value={code} onChange={(e) => setCode(e.target.value)} readOnly={!isNew} required maxLength={kind === "units" ? 8 : 30} autoFocus={isNew} />
        </Field>
      )}
      <Field label="Nombre"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoFocus={!isNew || kind === "brands"} /></Field>
      {kind === "categories" && (
        <Field label="Categoría padre">
          <select className={inputCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Ninguna (nivel principal)</option>
            {categories.filter((c) => !blocked.has(c.id)).map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>)}
          </select>
        </Field>
      )}
      {kind === "units" && (
        <Field label="Decimales permitidos" hint={unit && unit.products > 0 ? "Hay productos que usan esta unidad: no se pueden cambiar." : "0 = solo cantidades enteras; 3 = gramos, etc."}>
          <input className={inputCls} type="number" min={0} max={6} step={1} value={decimals} onChange={(e) => setDecimals(e.target.value)} required disabled={!!unit && unit.products > 0} />
        </Field>
      )}
      {!isNew && (
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-body">
          <input type="checkbox" className="size-4 accent-brand" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activo
        </label>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {isNew ? "Crear" : "Guardar cambios"}</button>
      </div>
    </form>
  );
}
