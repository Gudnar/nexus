"use client";

import type { BrandSummary, ProductGroupView, UnitSummary } from "@erp/contracts";
import { Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { btnPrimary, btnSecondary, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import type { FlatCategory } from "@/lib/category-tree";

const compact = `${inputCls} h-9`;
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const abbr = (v: string, n = 3) => strip(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n) || "X";

interface Opt { name: string; values: string[]; draft: string }

/** Alta de un producto con variantes (talla, color…): genera una variante por combinación. */
export function VariantsCreateForm({
  categories, brands, units, taxProfiles, onDone, onCancel,
}: { categories: FlatCategory[]; brands: BrandSummary[]; units: UnitSummary[]; taxProfiles: { id: string; code: string; name: string; status: string }[]; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: "", baseCode: "", categoryId: "", brandId: "", taxProfileId: "", baseUnitId: units.find((u) => u.code === "UND")?.id ?? units[0]?.id ?? "", trackLots: false, trackExpiry: false,
  });
  const [opts, setOpts] = useState<Opt[]>([{ name: "Talla", values: [], draft: "" }, { name: "Color", values: [], draft: "" }]);
  const [codeTouched, setCodeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const used = opts.filter((o) => o.values.length > 0);
  const combos = useMemo(() => used.reduce<string[][]>((acc, o) => acc.flatMap((a) => o.values.map((v) => [...a, v])), [[]]), [used]);
  const total = used.length ? combos.length : 0;

  function addValue(i: number, raw: string) {
    const vals = raw.split(",").map((v) => v.trim()).filter(Boolean);
    if (!vals.length) return;
    setOpts((l) => l.map((o, j) => (j === i ? { ...o, values: [...o.values, ...vals.filter((v) => !o.values.some((x) => x.toLowerCase() === v.toLowerCase()))].slice(0, 20), draft: "" } : o)));
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addValue(i, e.currentTarget.value); }
    else if (e.key === "Backspace" && !e.currentTarget.value) setOpts((l) => l.map((o, j) => (j === i ? { ...o, values: o.values.slice(0, -1) } : o)));
  };
  function onName(v: string) {
    set("name", v);
    if (!codeTouched) set("baseCode", strip(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Los valores escritos y no confirmados con Enter también cuentan.
    const options = opts.map((o) => ({ name: o.name.trim(), values: [...o.values, ...o.draft.split(",").map((v) => v.trim()).filter(Boolean)] })).filter((o) => o.name && o.values.length);
    if (options.length === 0) return setError("Agrega al menos una opción con sus valores (por ejemplo Talla: S, M, L).");
    setBusy(true);
    const r = await bff<ProductGroupView>("/bff/api/catalog/product-groups", "POST", {
      name: f.name.trim(), baseCode: f.baseCode.trim(), options, baseUnitId: f.baseUnitId,
      categoryId: f.categoryId || null, brandId: f.brandId || null, taxProfileId: f.taxProfileId || null, trackLots: f.trackLots, trackExpiry: f.trackLots && f.trackExpiry,
    });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r, "No se pudo crear el producto."));
  }

  return (
    <form onSubmit={submit} className="grid gap-5 text-[13px]" data-testid="variants-form">
      <p className="rounded-lg bg-brand-soft px-3.5 py-2.5 text-ink-2">Crea un producto que viene en varias presentaciones (talla, color, sabor…). Cada combinación se guarda como un producto propio, con su <strong>código, código de barras, precio y stock</strong>.</p>
      <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
        <label className="grid gap-1 font-medium text-ink-2">Nombre del producto<input aria-label="Nombre del producto" required minLength={2} maxLength={120} className={inputCls} value={f.name} onChange={(e) => onName(e.target.value)} placeholder="Polera de algodón" autoFocus /></label>
        <label className="grid gap-1 font-medium text-ink-2">Prefijo de códigos<input aria-label="Prefijo de códigos" required maxLength={14} className={`${inputCls} uppercase`} value={f.baseCode} onChange={(e) => { setCodeTouched(true); set("baseCode", e.target.value.toUpperCase()); }} placeholder="POL" /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1 font-medium text-ink-2">Categoría
          <select aria-label="Categoría" className={inputCls} value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}><option value="">Sin categoría</option>{categories.filter((c) => c.status === "ACTIVE").map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>)}</select>
        </label>
        <label className="grid gap-1 font-medium text-ink-2">Marca
          <select aria-label="Marca" className={inputCls} value={f.brandId} onChange={(e) => set("brandId", e.target.value)}><option value="">Sin marca</option>{brands.filter((b) => b.status === "ACTIVE").map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </label>
        <label className="grid gap-1 font-medium text-ink-2">Unidad base
          <select aria-label="Unidad base" className={inputCls} value={f.baseUnitId} onChange={(e) => set("baseUnitId", e.target.value)} required>{units.filter((u) => u.status === "ACTIVE").map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}</select>
        </label>
      </div>
      {taxProfiles.length > 0 && (
        <label className="grid gap-1 font-medium text-ink-2">Perfil fiscal
          <select aria-label="Perfil fiscal" className={inputCls} value={f.taxProfileId} onChange={(e) => set("taxProfileId", e.target.value)}><option value="">Sin perfil fiscal</option>{taxProfiles.filter((t) => t.status === "ACTIVE").map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}</select>
        </label>
      )}
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand" checked={f.trackLots} onChange={(e) => { set("trackLots", e.target.checked); if (!e.target.checked) set("trackExpiry", false); }} />Controlar por lote</label>
        <label className={`flex items-center gap-2 ${f.trackLots ? "" : "text-ink-3"}`}><input type="checkbox" className="size-4 accent-brand" disabled={!f.trackLots} checked={f.trackExpiry} onChange={(e) => set("trackExpiry", e.target.checked)} />Controlar vencimiento</label>
      </div>

      <fieldset className="grid gap-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-[13px] font-semibold text-ink">Variantes: opciones y valores</legend>
        {opts.map((o, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[160px_1fr_auto] sm:items-start">
            <input aria-label={`Nombre de la opción ${i + 1}`} className={compact} value={o.name} onChange={(e) => setOpts((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Talla, Color…" maxLength={30} />
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-1 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
              {o.values.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded-full bg-neutral-soft py-0.5 pl-2.5 pr-1 text-xs text-ink">{v}
                  <button type="button" aria-label={`Quitar ${v}`} className="rounded-full p-0.5 text-ink-3 hover:text-danger" onClick={() => setOpts((l) => l.map((x, j) => (j === i ? { ...x, values: x.values.filter((y) => y !== v) } : x)))}><X className="size-3" /></button>
                </span>
              ))}
              <input aria-label={`Valores de la opción ${i + 1}`} className="min-w-[120px] flex-1 bg-transparent py-1 text-[13px] outline-none" value={o.draft} onChange={(e) => setOpts((l) => l.map((x, j) => (j === i ? { ...x, draft: e.target.value } : x)))}
                onKeyDown={(e) => onKey(e, i)} onBlur={(e) => addValue(i, e.currentTarget.value)} placeholder={o.values.length ? "Otro valor…" : "S, M, L (Enter para agregar)"} />
            </div>
            {opts.length > 1 && <button type="button" className="rounded-md p-2 text-ink-3 hover:bg-neutral-soft hover:text-danger" aria-label={`Quitar la opción ${i + 1}`} onClick={() => setOpts((l) => l.filter((_, j) => j !== i))}><X className="size-4" /></button>}
          </div>
        ))}
        {opts.length < 3 && <button type="button" className="flex w-fit items-center gap-1 text-xs font-medium text-brand hover:underline" onClick={() => setOpts((l) => [...l, { name: "", values: [], draft: "" }])}><Plus className="size-3.5" aria-hidden />Agregar otra opción</button>}
        <p className="text-xs text-ink-3" data-testid="variants-count">{total === 0 ? "Escribe los valores de cada opción para ver las variantes." : total > 100 ? `Serían ${total} variantes: el máximo es 100.` : `Se crearán ${total} variante${total === 1 ? "" : "s"}.`}</p>
        {total > 0 && total <= 100 && (
          <ul className="grid max-h-36 gap-1 overflow-y-auto text-xs text-ink-2 sm:grid-cols-2" data-testid="variants-preview">
            {combos.slice(0, 40).map((c) => <li key={c.join("|")}><span className="font-mono text-ink">{[f.baseCode || "…", ...c.map((v) => abbr(v))].join("-")}</span> · {f.name || "Producto"} - {c.join(" / ")}</li>)}
            {combos.length > 40 && <li className="text-ink-3">… y {combos.length - 40} más</li>}
          </ul>
        )}
      </fieldset>

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy || total > 100}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Crear {total > 0 ? `${total} variante${total === 1 ? "" : "s"}` : "producto"}</button>
      </div>
    </form>
  );
}

/** Dentro de la ficha de una variante: las hermanas de su familia, y alta de una nueva. */
export function ProductVariantsPanel({ groupId, currentId, canManage, onOpen }: { groupId: string; currentId: string; canManage: boolean; onOpen: (id: string) => void }) {
  const [group, setGroup] = useState<ProductGroupView | null>(null);
  const [adding, setAdding] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await bff<ProductGroupView>(`/bff/api/catalog/product-groups/${groupId}`, "GET");
    if (r.ok) setGroup(r.data);
  }, [groupId]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: { preventDefault(): void }) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff<ProductGroupView>(`/bff/api/catalog/product-groups/${groupId}/variants`, "POST", { values: vals });
    setBusy(false);
    if (!r.ok) return setError(errorText(r));
    setGroup(r.data); setAdding(false); setVals({});
  }

  if (!group) return null;
  return (
    <fieldset className="grid gap-3" data-testid="variants-panel">
      <legend className="mb-1 text-[13px] font-semibold text-ink">Variantes de «{group.name}» <span className="font-normal text-ink-3">({group.variants.length})</span></legend>
      <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-line p-1.5">
        {group.variants.map((v) => (
          <li key={v.id} className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] ${v.id === currentId ? "bg-brand-soft" : "hover:bg-surface-muted"}`}>
            {v.thumbUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={v.thumbUrl} alt="" className="size-8 rounded object-cover" />
              : <span className="size-8 rounded bg-neutral-soft" aria-hidden />}
            <span className="font-mono text-xs text-ink-2">{v.code}</span>
            <span className="flex-1 truncate text-ink">{v.variantLabel}</span>
            {v.status === "INACTIVE" && <StatusBadge>Inactivo</StatusBadge>}
            {v.id === currentId ? <span className="text-xs font-medium text-brand">Esta</span> : <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => onOpen(v.id)}>Abrir</button>}
          </li>
        ))}
      </ul>
      {canManage && !adding && <button type="button" className="w-fit text-xs font-medium text-brand hover:underline" onClick={() => setAdding(true)}>+ Agregar otra variante</button>}
      {adding && (
        <div className="grid gap-2 rounded-lg border border-line p-3" data-testid="add-variant">
          <div className="grid gap-2 sm:grid-cols-3">
            {group.options.map((o) => (
              <label key={o.name} className="grid gap-1 text-xs font-medium text-ink-2">{o.name}
                <input aria-label={`Valor de ${o.name}`} list={`dl-${o.name}`} className={compact} value={vals[o.name] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [o.name]: e.target.value }))} required maxLength={30} />
                <datalist id={`dl-${o.name}`}>{o.values.map((x) => <option key={x} value={x} />)}</datalist>
              </label>
            ))}
          </div>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <div className="flex gap-2"><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={add} disabled={busy}>{busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}Agregar variante</button><button type="button" className="text-xs text-ink-2 hover:underline" onClick={() => { setAdding(false); setError(null); }}>Cancelar</button></div>
        </div>
      )}
    </fieldset>
  );
}
