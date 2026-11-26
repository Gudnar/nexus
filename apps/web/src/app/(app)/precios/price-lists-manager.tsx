"use client";

import type { PriceListSummary, ProductPriceRow, ProductSummary } from "@erp/contracts";
import { Download, History, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Field, downloadBase64, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { Tags } from "lucide-react";

const MODE = { WITH_TAX: "Con impuestos", WITHOUT_TAX: "Sin impuestos" } as const;
const SCALING = { TIER_THRESHOLD: "Escala por umbral", PROGRESSIVE: "Escala progresiva" } as const;
const CHANNEL = { POS: "Punto de venta", ECOMMERCE: "Tienda online", MESSAGING: "Mensajería" } as const;
const scopeText = (l: PriceListSummary) =>
  l.scope === "BRANCH" ? `Sucursal ${l.branch?.code ?? ""}` : l.scope === "CHANNEL" ? CHANNEL[l.channel as keyof typeof CHANNEL] : "Toda la empresa";

interface Branch { id: string; name: string }

export function PriceListsManager({ lists, branches, canManage }: { lists: PriceListSummary[]; branches: Branch[]; canManage: boolean }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(lists[0]?.id ?? null);
  const [editing, setEditing] = useState<PriceListSummary | "new" | null>(null);
  const selected = lists.find((l) => l.id === selectedId) ?? null;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card className="h-fit">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-ink">Listas ({lists.length})</h2>
            {canManage && <button className={`${btnPrimary} h-9 px-3`} onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Nueva</button>}
          </div>
          {lists.length === 0 ? (
            <EmptyState icon={Tags} title="Aún no hay listas" description={canManage ? "Crea la primera con «Nueva»." : "Cuando existan, aparecerán aquí."} />
          ) : (
            <ul className="grid gap-2">
              {lists.map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => setSelectedId(l.id)}
                    aria-current={l.id === selectedId ? "true" : undefined}
                    className={`w-full rounded-lg border p-3 text-left ${l.id === selectedId ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-muted"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{l.name}</span>
                      <StatusBadge tone={l.status === "ACTIVE" ? "success" : "neutral"}>{l.status === "ACTIVE" ? "Activa" : "Inactiva"}</StatusBadge>
                    </span>
                    <span className="mt-1 block text-xs text-ink-2">{l.code} · {MODE[l.priceMode]} · {l.currency}</span>
                    <span className="block text-xs text-ink-3">{scopeText(l)} · {l.products} producto(s)</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected ? (
          <PricesPanel key={selected.id} list={selected} canManage={canManage} onEditList={() => setEditing(selected)} />
        ) : (
          <Card><EmptyState icon={Tags} title="Selecciona una lista" description="Aquí verás y editarás los precios por producto." /></Card>
        )}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nueva lista de precios" : "Editar lista de precios"} size="lg">
        {editing && (
          <ListForm
            list={editing === "new" ? null : editing}
            branches={branches}
            onDone={(id) => { setEditing(null); if (id) setSelectedId(id); router.refresh(); }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

// ───────────── Formulario de lista ─────────────

function ListForm({ list, branches, onDone, onCancel }: { list: PriceListSummary | null; branches: Branch[]; onDone: (id?: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    code: list?.code ?? "", name: list?.name ?? "", priceMode: list?.priceMode ?? "WITHOUT_TAX", currency: list?.currency ?? "BOB",
    scope: list?.scope ?? "TENANT", branchId: list?.branch?.id ?? "", channel: list?.channel ?? "POS",
    scalingMode: list?.scalingMode ?? "TIER_THRESHOLD", validFrom: list?.validFrom ?? "", validTo: list?.validTo ?? "",
    priority: String(list?.priority ?? 0), roundingDecimals: String(list?.roundingDecimals ?? 2), status: list?.status ?? "ACTIVE",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const locked = !!list; // código, ámbito y moneda no cambian

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const common = {
      name: f.name, scalingMode: f.scalingMode, priceMode: f.priceMode,
      validFrom: f.validFrom || null, validTo: f.validTo || null,
      priority: Number(f.priority), roundingDecimals: Number(f.roundingDecimals),
    };
    const r = list
      ? await bff(`/bff/api/pricing/lists/${list.id}`, "PATCH", { ...common, status: f.status })
      : await bff("/bff/api/pricing/lists", "POST", {
          ...common, code: f.code.trim(), currency: f.currency, scope: f.scope,
          ...(f.scope === "BRANCH" ? { branchId: f.branchId || null } : {}), ...(f.scope === "CHANNEL" ? { channel: f.channel } : {}),
        });
    setBusy(false);
    if (r.ok) return onDone(list ? undefined : (r.data as { id: string }).id);
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa los datos: el código admite letras, números, punto, guion o guion bajo; las fechas deben ser coherentes.");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código" hint={locked ? "No se puede cambiar." : undefined}>
          <input className={`${inputCls} ${locked ? "bg-surface-muted" : ""}`} value={f.code} onChange={(e) => set("code", e.target.value)} disabled={locked} required maxLength={32} />
        </Field>
        <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={80} /></Field>
        <Field label="Los precios incluyen" hint="Se puede cambiar mientras la lista no tenga precios.">
          <select className={inputCls} value={f.priceMode} onChange={(e) => set("priceMode", e.target.value as typeof f.priceMode)}>
            <option value="WITHOUT_TAX">Sin impuestos (se suman al vender)</option><option value="WITH_TAX">Con impuestos (se desglosan)</option>
          </select>
        </Field>
        <Field label="Moneda"><input className={`${inputCls} ${locked ? "bg-surface-muted" : ""}`} value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} disabled={locked} maxLength={3} required /></Field>
        <Field label="Se aplica a" hint={locked ? "No se puede cambiar." : undefined}>
          <select className={`${inputCls} ${locked ? "bg-surface-muted" : ""}`} value={f.scope} onChange={(e) => set("scope", e.target.value as typeof f.scope)} disabled={locked}>
            <option value="TENANT">Toda la empresa</option><option value="BRANCH">Una sucursal</option><option value="CHANNEL">Un canal de venta</option>
          </select>
        </Field>
        {f.scope === "BRANCH" && (
          <Field label="Sucursal">
            <select className={`${inputCls} ${locked ? "bg-surface-muted" : ""}`} value={f.branchId} onChange={(e) => set("branchId", e.target.value)} disabled={locked} required>
              <option value="">Elige una sucursal</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        {f.scope === "CHANNEL" && (
          <Field label="Canal">
            <select className={`${inputCls} ${locked ? "bg-surface-muted" : ""}`} value={f.channel} onChange={(e) => set("channel", e.target.value as typeof f.channel)} disabled={locked}>
              {Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
        <Field label="Escalas por cantidad" hint={f.scalingMode === "TIER_THRESHOLD" ? "Toda la cantidad se cobra al precio del tramo alcanzado." : "Cada tramo se cobra a su propio precio."}>
          <select className={inputCls} value={f.scalingMode} onChange={(e) => set("scalingMode", e.target.value as typeof f.scalingMode)}>
            {Object.entries(SCALING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Vigente desde"><input type="date" className={inputCls} value={f.validFrom} onChange={(e) => set("validFrom", e.target.value)} /></Field>
        <Field label="Vigente hasta"><input type="date" className={inputCls} value={f.validTo} onChange={(e) => set("validTo", e.target.value)} /></Field>
        <Field label="Prioridad" hint="Si dos listas aplican, gana la de mayor prioridad.">
          <input type="number" className={inputCls} value={f.priority} onChange={(e) => set("priority", e.target.value)} min={-1000} max={1000} />
        </Field>
        <Field label="Decimales de redondeo"><input type="number" className={inputCls} value={f.roundingDecimals} onChange={(e) => set("roundingDecimals", e.target.value)} min={0} max={4} /></Field>
        {list && (
          <Field label="Estado">
            <select className={inputCls} value={f.status} onChange={(e) => set("status", e.target.value as "ACTIVE" | "INACTIVE")}>
              <option value="ACTIVE">Activa</option><option value="INACTIVE">Inactiva</option>
            </select>
          </Field>
        )}
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar</button>
      </div>
    </form>
  );
}

// ───────────── Precios de una lista ─────────────

function PricesPanel({ list, canManage, onEditList }: { list: PriceListSummary; canManage: boolean; onEditList: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<ProductPriceRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ productId: string; code: string; name: string; tiers: ProductPriceRow["tiers"] } | "new" | null>(null);
  const [history, setHistory] = useState<ProductPriceRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const base = `/bff/api/pricing/lists/${list.id}/prices`;

  const load = useCallback(async (search: string, cursor?: string) => {
    const qs = new URLSearchParams({ limit: "50", ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}) });
    const r = await bff<{ items: ProductPriceRow[]; nextCursor: string | null }>(`${base}?${qs}`, "GET");
    if (!r.ok) return setError(errorText(r, "No se pudieron cargar los precios."));
    setError(null);
    setRows((prev) => (cursor && prev ? [...prev, ...r.data.items] : r.data.items));
    setNext(r.data.nextCursor);
  }, [base]);

  useEffect(() => { const t = setTimeout(() => void load(q), 250); return () => clearTimeout(t); }, [q, load]);

  async function remove(row: ProductPriceRow) {
    if (!window.confirm(`¿Quitar «${row.name}» de esta lista?`)) return;
    const r = await bff(`${base}/${row.productId}`, "DELETE");
    if (!r.ok) return setError(errorText(r));
    await load(q);
    router.refresh();
  }

  async function exportPrices() {
    setExporting(true);
    const r = await bff<{ fileName: string; contentBase64: string }>(`/bff/api/exports/prices/${list.id}`, "GET");
    setExporting(false);
    if (!r.ok) return setError(r.status === 403 ? "No tienes permiso para exportar." : errorText(r));
    downloadBase64(r.data.fileName, r.data.contentBase64);
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{list.name}</h2>
          <p className="mt-0.5 text-xs text-ink-2">
            {list.code} · {MODE[list.priceMode]} · {SCALING[list.scalingMode]} · {list.currency}
            {(list.validFrom || list.validTo) && ` · Vigencia ${list.validFrom ?? "…"} → ${list.validTo ?? "…"}`} · Prioridad {list.priority}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={`${btnSecondary} h-9 px-3`} onClick={exportPrices} disabled={exporting}>
            {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />} Exportar
          </button>
          {canManage && <button className={`${btnSecondary} h-9 px-3`} onClick={onEditList}>Editar lista</button>}
          {canManage && <button className={`${btnPrimary} h-9 px-3`} onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Asignar precio</button>}
        </div>
      </div>

      <input className={`${inputCls} mb-4 max-w-[320px]`} placeholder="Buscar por código o nombre" aria-label="Buscar producto" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}

      {rows === null ? (
        <p className="py-8 text-center text-ink-2">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Tags} title={q ? "Sin resultados" : "Sin precios todavía"} description={q ? "Prueba con otra búsqueda." : canManage ? "Usa «Asignar precio» o importa un Excel desde Productos." : "Esta lista no tiene precios."} />
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="h-[42px] border-y border-line text-ink-2">
                <th className="px-5 font-medium">Producto</th><th className="px-3 font-medium">Unidad</th><th className="px-3 font-medium">Escalas (desde → precio)</th><th className="px-5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-b border-line-strong/40 align-top text-body hover:bg-surface-muted">
                  <td className="px-5 py-3"><span className="font-medium text-ink">{r.name}</span><span className="block text-xs text-ink-3">{r.code}</span></td>
                  <td className="px-3 py-3">{r.unit}</td>
                  <td className="px-3 py-3">
                    <ul className="grid gap-0.5 tabular-nums">
                      {r.tiers.map((t) => (
                        <li key={t.minQuantity}>
                          <span className="text-ink-2">{num(t.minQuantity)}{t.maxQuantity ? `–${num(t.maxQuantity)}` : "+"}:</span> <strong className="text-ink">{money(t.unitPrice, list.roundingDecimals)}</strong>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {canManage && <button className={`${btnSecondary} h-8 px-3`} onClick={() => setHistory(r)} aria-label={`Historial de ${r.name}`}><History className="size-3.5" aria-hidden /></button>}
                      {canManage && <button className={`${btnSecondary} h-8 px-3`} onClick={() => setEditing({ productId: r.productId, code: r.code, name: r.name, tiers: r.tiers })}>Editar</button>}
                      {canManage && <button className={`${btnSecondary} h-8 px-2.5 text-danger`} onClick={() => remove(r)} aria-label={`Quitar ${r.name}`}><Trash2 className="size-3.5" aria-hidden /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {next && <div className="px-5 pt-4"><button className={btnSecondary} onClick={() => load(q, next)}>Cargar más</button></div>}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Asignar precio" : "Editar precios"} size="lg">
        {editing && (
          <PriceEditor
            list={list} base={base} target={editing === "new" ? null : editing}
            onDone={() => { setEditing(null); void load(q); router.refresh(); }} onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal open={history !== null} onClose={() => setHistory(null)} title={history ? `Historial · ${history.name}` : "Historial"}>
        {history && <HistoryView base={base} productId={history.productId} />}
      </Modal>
    </Card>
  );
}

interface TierRow { min: string; max: string; price: string }

function PriceEditor({ list, base, target, onDone, onCancel }: {
  list: PriceListSummary; base: string; target: { productId: string; code: string; name: string; tiers: ProductPriceRow["tiers"] } | null; onDone: () => void; onCancel: () => void;
}) {
  const [product, setProduct] = useState<{ id: string; label: string } | null>(target ? { id: target.productId, label: `${target.name} (${target.code})` } : null);
  const [tiers, setTiers] = useState<TierRow[]>(
    target ? target.tiers.map((t) => ({ min: String(Number(t.minQuantity)), max: t.maxQuantity ? String(Number(t.maxQuantity)) : "", price: String(Number(t.unitPrice)) })) : [{ min: "1", max: "", price: "" }],
  );
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<ProductSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (product || search.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const r = await bff<{ items: ProductSummary[] }>(`/bff/api/catalog/products?${new URLSearchParams({ q: search.trim(), status: "ACTIVE", limit: "8" })}`, "GET");
      if (r.ok) setFound(r.data.items);
    }, 250);
    return () => clearTimeout(t);
  }, [search, product]);

  const setTier = (i: number, k: keyof TierRow, v: string) => setTiers((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  // Un tramo nuevo empieza donde termina el anterior (los tramos son contiguos: [mín, máx)).
  const addTier = () => setTiers((rows) => [...rows, { min: rows[rows.length - 1]?.max ?? "", max: "", price: "" }]);
  const dropTier = (i: number) => setTiers((rows) => rows.filter((_, j) => j !== i));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!product) return setError("Elige un producto.");
    setError(null);
    setBusy(true);
    const body = { tiers: tiers.map((t) => ({ minQuantity: Number(t.min), maxQuantity: t.max.trim() ? Number(t.max) : null, unitPrice: Number(t.price) })) };
    const r = await bff(`${base}/${product.id}`, "PUT", body);
    setBusy(false);
    if (r.ok) return onDone();
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa las escalas: cantidades mayores que cero, precios sin negativos.");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <Field label="Producto" hint={target ? "No se puede cambiar." : "Escribe al menos 2 letras del código o nombre."}>
        {product ? (
          <div className="flex items-center justify-between rounded-lg border border-line-strong bg-surface-muted px-3 py-2 text-[13px]">
            <span className="text-ink">{product.label}</span>
            {!target && <button type="button" className="text-brand hover:underline" onClick={() => { setProduct(null); setSearch(""); }}>Cambiar</button>}
          </div>
        ) : (
          <div className="relative">
            <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" autoFocus />
            {found.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface shadow-popover">
                {found.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="w-full px-3 py-2 text-left text-[13px] hover:bg-surface-muted" onClick={() => setProduct({ id: p.id, label: `${p.name} (${p.code})` })}>
                      {p.name} <span className="text-ink-3">· {p.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-medium text-ink-2">
          Escalas — precio unitario {list.priceMode === "WITH_TAX" ? "con" : "sin"} impuestos ({list.currency})
        </legend>
        <div className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 text-xs text-ink-3"><span>Desde (incl.)</span><span>Hasta (excl.)</span><span>Precio unitario</span><span /></div>
        {tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_32px] items-center gap-2">
            <input aria-label={`Desde, escala ${i + 1}`} type="number" step="any" min="0" className={inputCls} value={t.min} onChange={(e) => setTier(i, "min", e.target.value)} required />
            <input aria-label={`Hasta, escala ${i + 1}`} type="number" step="any" min="0" className={inputCls} value={t.max} onChange={(e) => setTier(i, "max", e.target.value)} placeholder="Sin límite" />
            <input aria-label={`Precio, escala ${i + 1}`} type="number" step="any" min="0" className={inputCls} value={t.price} onChange={(e) => setTier(i, "price", e.target.value)} required />
            <button type="button" className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-neutral-soft disabled:opacity-40" onClick={() => dropTier(i)} disabled={tiers.length === 1} aria-label={`Quitar escala ${i + 1}`}><Trash2 className="size-4" aria-hidden /></button>
          </div>
        ))}
        <div><button type="button" className={`${btnSecondary} h-8 px-3`} onClick={addTier}><Plus className="size-3.5" aria-hidden /> Agregar escala</button></div>
        <p className="text-xs text-ink-3">Las escalas deben ser contiguas: el «Hasta» de una es el «Desde» de la siguiente. La última puede quedar sin límite.</p>
      </fieldset>

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Guardar precios</button>
      </div>
    </form>
  );
}

type Tier = { minQuantity: string | number; maxQuantity: string | number | null; unitPrice: string | number };
const tiersText = (v: unknown) =>
  Array.isArray(v) && v.length
    ? (v as Tier[]).map((t) => `${num(t.minQuantity)}${t.maxQuantity ? `–${num(t.maxQuantity)}` : "+"}: ${money(t.unitPrice)}`).join(" · ")
    : "—";

function HistoryView({ base, productId }: { base: string; productId: string }) {
  const [items, setItems] = useState<{ changedAt: string; before: unknown; after: unknown }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void bff<{ changedAt: string; before: unknown; after: unknown }[]>(`${base}/${productId}/history`, "GET").then((r) => (r.ok ? setItems(r.data) : setError(errorText(r))));
  }, [base, productId]);
  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!items) return <p className="text-ink-2">Cargando…</p>;
  if (items.length === 0) return <p className="text-ink-2">Sin cambios registrados.</p>;
  return (
    <ol className="grid gap-3">
      {items.map((h, i) => (
        <li key={i} className="rounded-lg border border-line p-3 text-[13px]">
          <p className="text-xs text-ink-3">{new Date(h.changedAt).toLocaleString("es-BO")}</p>
          <p className="mt-1"><span className="text-ink-2">Antes:</span> {tiersText(h.before)}</p>
          <p><span className="text-ink-2">Después:</span> {tiersText(h.after)}</p>
        </li>
      ))}
    </ol>
  );
}

