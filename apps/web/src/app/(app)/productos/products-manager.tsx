"use client";

import type { BrandSummary, ProductDetail, ProductList, UnitSummary } from "@erp/contracts";
import { Loader2, Package, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { ProductPhotos } from "./product-photos";
import { ProductVariantsPanel, VariantsCreateForm } from "./variants";
import type { FlatCategory } from "@/lib/category-tree";

interface Filters { q: string; categoryId: string; brandId: string; status: string; kind: string }
interface Props {
  list: ProductList;
  categories: FlatCategory[];
  brands: BrandSummary[];
  units: UnitSummary[];
  taxProfiles: { id: string; code: string; name: string; status: string }[];
  canManage: boolean;
  filters: Filters;
  hasCursor: boolean;
}

function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

const compact = inputCls.replace("w-full ", "");

export function ProductsManager({ list, categories, brands, units, taxProfiles, canManage, filters, hasCursor }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProductDetail | "new" | null>(null);
  const [creatingVariants, setCreatingVariants] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyFilters = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const qs = new URLSearchParams();
    for (const k of ["q", "categoryId", "brandId", "status", "kind"]) {
      const v = String(f.get(k) ?? "").trim();
      if (v) qs.set(k, v);
    }
    router.push(`/productos${qs.size ? `?${qs}` : ""}`);
  };

  const withCursor = (cursor: string) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    qs.set("cursor", cursor);
    return `/productos?${qs}`;
  };

  async function open(id: string) {
    setLoadingId(id);
    setError(null);
    const r = await bff<ProductDetail>(`/bff/api/catalog/products/${id}`, "GET");
    setLoadingId(null);
    if (r.ok) setEditing(r.data);
    else setError(errorText(r));
  }

  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      {error && <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{error}</p>}
      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <form onSubmit={applyFilters} className="flex flex-1 flex-wrap items-end gap-2" role="search">
            <label className="relative min-w-[220px] flex-1">
              <span className="sr-only">Buscar productos</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <input name="q" defaultValue={filters.q} placeholder="Buscar por nombre, código o código de barras…" className={`${inputCls} pl-9`} />
            </label>
            <select name="categoryId" aria-label="Categoría" defaultValue={filters.categoryId} className={`${compact} w-[180px]`}>
              <option value="">Todas las categorías</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>)}
            </select>
            <select name="brandId" aria-label="Marca" defaultValue={filters.brandId} className={`${compact} w-[150px]`}>
              <option value="">Todas las marcas</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select name="kind" aria-label="Tipo" defaultValue={filters.kind} className={`${compact} w-[120px]`}>
              <option value="">Bienes y servicios</option><option value="GOODS">Bienes</option><option value="SERVICE">Servicios</option>
            </select>
            <select name="status" aria-label="Estado" defaultValue={filters.status} className={`${compact} w-[120px]`}>
              <option value="">Todos</option><option value="ACTIVE">Activos</option><option value="INACTIVE">Inactivos</option>
            </select>
            <button className={btnSecondary}>Filtrar</button>
            {filtered && <Link href="/productos" className="text-[13px] font-medium text-brand hover:underline">Limpiar</Link>}
          </form>
          {canManage && (
            <span className="flex flex-wrap gap-2">
              <button className={btnSecondary} onClick={() => setCreatingVariants(true)}><Plus className="size-4" aria-hidden /> Producto con variantes</button>
              <button className={btnPrimary} onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Nuevo producto</button>
            </span>
          )}
        </div>

        {list.items.length === 0 ? (
          <EmptyState
            icon={Package}
            title={filtered ? "Sin resultados" : "Aún no hay productos"}
            description={filtered ? "Prueba con otros filtros." : canManage ? "Crea el primero con «Nuevo producto»." : "Cuando existan, aparecerán aquí."}
          />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="h-[42px] border-y border-line text-ink-2">
                  <th className="px-5 font-medium">Código</th>
                  <th className="px-3 font-medium">Nombre</th>
                  <th className="px-3 font-medium">Categoría</th>
                  <th className="px-3 font-medium">Marca</th>
                  <th className="px-3 font-medium">Unidad</th>
                  <th className="px-3 font-medium">Control</th>
                  <th className="px-3 font-medium">Estado</th>
                  {canManage && <th className="px-5 text-right font-medium"><span className="sr-only">Acciones</span></th>}
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id} className="h-[54px] border-b border-line-strong/40 text-body last:border-0 hover:bg-surface-muted">
                    <td className="px-5 font-medium text-ink">
                      <span className="flex items-center gap-3">
                        {p.thumbUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.thumbUrl} alt={`Foto de ${p.name}`} className="size-9 shrink-0 rounded-md border border-line object-cover" loading="lazy" />
                          : <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-neutral-soft text-ink-3"><Package className="size-4" /></span>}
                        {p.code}
                      </span>
                    </td>
                    <td className="px-3">
                      {p.name}
                      {p.variantLabel && <span className="ml-2" title={`Variante de ${p.group?.name}`}><StatusBadge tone="info">{p.variantLabel}</StatusBadge></span>}
                      {p.kind === "SERVICE" && <span className="ml-2"><StatusBadge tone="info">Servicio</StatusBadge></span>}
                    </td>
                    <td className="px-3 text-ink-2">{p.category?.name ?? "—"}</td>
                    <td className="px-3 text-ink-2">{p.brand?.name ?? "—"}</td>
                    <td className="px-3">{p.baseUnit.code}</td>
                    <td className="px-3">
                      <span className="flex gap-1">
                        {p.trackLots && <StatusBadge>Lote</StatusBadge>}
                        {p.trackExpiry && <StatusBadge tone="warning">Vence</StatusBadge>}
                        {!p.trackLots && !p.trackExpiry && <span className="text-ink-3">—</span>}
                      </span>
                    </td>
                    <td className="px-3"><StatusBadge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status === "ACTIVE" ? "Activo" : "Inactivo"}</StatusBadge></td>
                    {canManage && (
                      <td className="px-5 text-right">
                        <button className={`${btnSecondary} h-8 px-3`} onClick={() => open(p.id)} disabled={loadingId === p.id}>
                          {loadingId === p.id && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Editar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(hasCursor || list.nextCursor) && (
          <div className="mt-4 flex items-center justify-between text-[13px]">
            {hasCursor ? <Link href={`/productos${Object.values(filters).some(Boolean) ? `?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][])}` : ""}`} className="font-medium text-brand hover:underline">← Volver al inicio</Link> : <span />}
            {list.nextCursor && <Link href={withCursor(list.nextCursor)} className="font-medium text-brand hover:underline">Siguiente página →</Link>}
          </div>
        )}
      </Card>

      <Modal open={creatingVariants} onClose={() => setCreatingVariants(false)} title="Nuevo producto con variantes" size="lg">
        {creatingVariants && <VariantsCreateForm categories={categories} brands={brands} units={units} taxProfiles={taxProfiles} onCancel={() => setCreatingVariants(false)} onDone={() => { setCreatingVariants(false); router.refresh(); }} />}
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nuevo producto" : "Editar producto"} size="lg">
        {editing && (
          <ProductForm
            product={editing === "new" ? null : editing}
            categories={categories} brands={brands} units={units} taxProfiles={taxProfiles}
            extra={editing !== "new" ? (
              <>
                <ProductPhotos key={`ph-${editing.id}`} productId={editing.id} canManage={canManage} />
                {editing.group && <ProductVariantsPanel key={`gr-${editing.id}`} groupId={editing.group.id} currentId={editing.id} canManage={canManage} onOpen={(id) => { setEditing(null); void open(id); }} />}
              </>
            ) : null}
            onDone={() => { setEditing(null); router.refresh(); }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

interface BarcodeRow { barcode: string; unitId: string }
interface ConvRow { unitId: string; factor: string }

function ProductForm({
  product, categories, brands, units, taxProfiles, extra, onDone, onCancel,
}: { extra?: ReactNode; product: ProductDetail | null; categories: FlatCategory[]; brands: BrandSummary[]; units: UnitSummary[]; taxProfiles: Props["taxProfiles"]; onDone: () => void; onCancel: () => void }) {
  const activeUnits = units.filter((u) => u.status === "ACTIVE" || u.id === product?.baseUnit.id);
  const [f, setF] = useState({
    code: product?.code ?? "", name: product?.name ?? "", description: product?.description ?? "",
    kind: product?.kind ?? "GOODS", categoryId: product?.category?.id ?? "", brandId: product?.brand?.id ?? "", taxProfileId: product?.taxProfile?.id ?? "",
    baseUnitId: product?.baseUnit.id ?? units.find((u) => u.code === "UND")?.id ?? units[0]?.id ?? "",
    trackLots: product?.trackLots ?? false, trackExpiry: product?.trackExpiry ?? false,
    status: product?.status ?? "ACTIVE",
  });
  const [barcodes, setBarcodes] = useState<BarcodeRow[]>((product?.barcodes ?? []).map((b) => ({ barcode: b.barcode, unitId: b.unitId ?? "" })));
  const [convs, setConvs] = useState<ConvRow[]>((product?.conversions ?? []).map((c) => ({ unitId: c.unitId, factor: String(Number(c.factor)) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = units.find((u) => u.id === f.baseUnitId);
  const isService = f.kind === "SERVICE";
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  // Unidades válidas para códigos de barras: la base y las de las conversiones
  const barcodeUnits = [base, ...convs.map((c) => units.find((u) => u.id === c.unitId))].filter(Boolean) as UnitSummary[];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const common = {
      name: f.name, description: f.description, kind: f.kind,
      categoryId: f.categoryId || null, brandId: f.brandId || null, ...(taxProfiles.length || product?.taxProfile ? { taxProfileId: f.taxProfileId || null } : {}),
      trackLots: isService ? false : f.trackLots, trackExpiry: isService ? false : f.trackLots && f.trackExpiry,
      barcodes: barcodes.filter((b) => b.barcode.trim()).map((b) => ({ barcode: b.barcode.trim(), unitId: b.unitId || null })),
      conversions: convs.filter((c) => c.unitId).map((c) => ({ unitId: c.unitId, factor: Number(c.factor) })),
    };
    const r = product
      ? await bff(`/bff/api/catalog/products/${product.id}`, "PATCH", { ...common, status: f.status })
      : await bff("/bff/api/catalog/products", "POST", { ...common, baseUnitId: f.baseUnitId, ...(f.code.trim() ? { code: f.code.trim() } : {}) });
    setBusy(false);
    if (r.ok) return onDone();
    if (r.status === 400 && r.data.code === "VALIDATION") setError("Revisa los datos: el código admite letras, números, punto, guion o guion bajo; los códigos de barras 3 a 64 caracteres; los factores deben ser mayores que cero (máx. 6 decimales).");
    else setError(errorText(r));
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-[170px_1fr]">
        <Field label="Código" hint={product ? "No se puede cambiar." : "Vacío = automático (P-000001…)"}>
          <input className={`${inputCls} uppercase ${product ? "bg-surface-muted text-ink-2" : ""}`} value={f.code} onChange={(e) => set("code", e.target.value)} readOnly={!!product} maxLength={30} placeholder="Automático" />
        </Field>
        <Field label="Nombre">
          <input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={160} autoFocus />
        </Field>
      </div>
      <Field label="Descripción">
        <textarea className={`${inputCls} h-20 py-2`} value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tipo">
          <select className={inputCls} value={f.kind} onChange={(e) => set("kind", e.target.value as "GOODS" | "SERVICE")}>
            <option value="GOODS">Bien (con inventario)</option><option value="SERVICE">Servicio</option>
          </select>
        </Field>
        <Field label="Categoría">
          <select className={inputCls} value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">Sin categoría</option>
            {categories.filter((c) => c.status === "ACTIVE" || c.id === f.categoryId).map((c) => <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>)}
          </select>
        </Field>
        <Field label="Marca">
          <select className={inputCls} value={f.brandId} onChange={(e) => set("brandId", e.target.value)}>
            <option value="">Sin marca</option>
            {brands.filter((b) => b.status === "ACTIVE" || b.id === f.brandId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      {(taxProfiles.length > 0 || product?.taxProfile) && (
        <Field label="Perfil fiscal" hint="Define qué impuestos aplican al vender este producto.">
          <select className={inputCls} value={f.taxProfileId} onChange={(e) => set("taxProfileId", e.target.value)}>
            <option value="">Sin perfil fiscal</option>
            {taxProfiles.filter((t) => t.status === "ACTIVE" || t.id === f.taxProfileId).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
          </select>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Unidad base" hint={product ? "No se puede cambiar." : "Unidad en la que se controla el stock."}>
          <select className={`${inputCls} ${product ? "bg-surface-muted" : ""}`} value={f.baseUnitId} onChange={(e) => set("baseUnitId", e.target.value)} disabled={!!product} required>
            {activeUnits.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
          </select>
        </Field>
        {!isService && (
          <div className="grid content-start gap-2 pt-6 sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-body">
              <input type="checkbox" className="size-4 accent-brand" checked={f.trackLots} onChange={(e) => { set("trackLots", e.target.checked); if (!e.target.checked) set("trackExpiry", false); }} />
              Controlar por lote
            </label>
            <label className={`flex items-center gap-2.5 text-[13px] ${f.trackLots ? "cursor-pointer text-body" : "text-ink-3"}`}>
              <input type="checkbox" className="size-4 accent-brand" checked={f.trackExpiry} disabled={!f.trackLots} onChange={(e) => set("trackExpiry", e.target.checked)} />
              Controlar fecha de vencimiento <span className="text-xs text-ink-3">(requiere lote)</span>
            </label>
          </div>
        )}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-semibold text-ink">Conversiones de unidad</legend>
        <p className="text-xs text-ink-2">Para comprar o vender en otra unidad. Ejemplo: 1 Caja = 12 {base?.code ?? "UND"}.</p>
        {convs.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-2">1</span>
            <select aria-label="Unidad" className={`${compact} w-[170px]`} value={c.unitId} onChange={(e) => setConvs((l) => l.map((x, j) => (j === i ? { ...x, unitId: e.target.value } : x)))}>
              <option value="">Elige una unidad</option>
              {units.filter((u) => u.id !== f.baseUnitId && (u.status === "ACTIVE" || u.id === c.unitId)).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
            </select>
            <span className="text-[13px] text-ink-2">=</span>
            <input aria-label="Factor" type="number" step="any" min="0" className={`${compact} w-[110px]`} value={c.factor} onChange={(e) => setConvs((l) => l.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} required />
            <span className="text-[13px] text-ink-2">{base?.code ?? ""}</span>
            <button type="button" className="rounded-md p-1.5 text-ink-3 hover:bg-neutral-soft hover:text-danger" aria-label="Quitar conversión" onClick={() => setConvs((l) => l.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button type="button" className="w-fit text-xs font-medium text-brand hover:underline" onClick={() => setConvs((l) => [...l, { unitId: "", factor: "" }])}>+ Añadir conversión</button>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-semibold text-ink">Códigos de barras</legend>
        {barcodes.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input aria-label="Código de barras" className={`${compact} w-[220px]`} value={b.barcode} onChange={(e) => setBarcodes((l) => l.map((x, j) => (j === i ? { ...x, barcode: e.target.value } : x)))} maxLength={64} placeholder="p. ej. 7790001000012" />
            <select aria-label="Unidad del código" className={`${compact} w-[170px]`} value={b.unitId} onChange={(e) => setBarcodes((l) => l.map((x, j) => (j === i ? { ...x, unitId: e.target.value } : x)))}>
              <option value="">Cualquier unidad</option>
              {barcodeUnits.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
            <button type="button" className="rounded-md p-1.5 text-ink-3 hover:bg-neutral-soft hover:text-danger" aria-label="Quitar código de barras" onClick={() => setBarcodes((l) => l.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button type="button" className="w-fit text-xs font-medium text-brand hover:underline" onClick={() => setBarcodes((l) => [...l, { barcode: "", unitId: "" }])}>+ Añadir código de barras</button>
      </fieldset>

      {product && (
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-body">
          <input type="checkbox" className="size-4 accent-brand" checked={f.status === "ACTIVE"} onChange={(e) => set("status", e.target.checked ? "ACTIVE" : "INACTIVE")} />
          Producto activo <span className="text-xs text-ink-3">(los inactivos se conservan pero no se ofrecen)</span>
        </label>
      )}

      {extra}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {product ? "Guardar cambios" : "Crear producto"}</button>
      </div>
    </form>
  );
}
