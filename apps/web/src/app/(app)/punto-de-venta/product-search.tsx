"use client";

import type { PosProductRow } from "@erp/contracts";
import { Loader2, Package, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inputCls } from "@/components/ui";
import { bff } from "@/lib/client-api";
import { fmt, stockText, tierRange } from "./pos-helpers";

const FIELDS = [["description", "Descripción"], ["code", "Código"], ["barcode", "Cód. barras"], ["supplier", "Proveedor"]] as const;

/** Buscador de productos con autocompletado: por descripción, código, código de barras o proveedor, mostrando existencias y escalas de precio. */
export function ProductSearch({ warehouseId, customerId, onAdd, disabled }: { warehouseId: string; customerId: string | null; onAdd: (p: PosProductRow) => void; disabled?: boolean }) {
  const [fields, setFields] = useState<Set<string>>(new Set(["description", "code", "barcode"]));
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PosProductRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [none, setNone] = useState(false);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const toggle = (f: string) => setFields((s) => { const n = new Set(s); if (n.has(f)) { if (n.size > 1) n.delete(f); } else n.add(f); return n; });
  const fieldsKey = [...fields].sort().join(",");

  async function run(text: string): Promise<PosProductRow[]> {
    const qs = new URLSearchParams({ q: text, fields: fieldsKey, warehouseId, ...(customerId ? { customerId } : {}) });
    const r = await bff<PosProductRow[]>(`/bff/api/sales/product-search?${qs}`, "GET");
    return r.ok ? r.data : [];
  }

  useEffect(() => {
    if (!q.trim() || !warehouseId) { setItems([]); setNone(false); return; }
    setNone(false);
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const rows = await run(q.trim());
      if (my !== seq.current) return;
      setLoading(false); setItems(rows); setNone(rows.length === 0); setActive(0);
    }, 220);
    return () => clearTimeout(t);
  }, [q, fieldsKey, warehouseId, customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const add = (p: PosProductRow) => { onAdd(p); setQ(""); setItems([]); setOpen(false); setNone(false); input.current?.focus(); };

  async function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) return add(items[active]!);
      // Un lector de códigos de barras escribe y presiona Enter antes de que llegue el autocompletado: se busca en el acto.
      if (q.trim()) { const rows = await run(q.trim()); if (rows.length === 1) add(rows[0]!); else { setItems(rows); setNone(rows.length === 0); setOpen(true); } }
    }
  }

  return (
    <div ref={box} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]" role="group" aria-label="Buscar productos por">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-1.5 text-ink-2">
            <input type="checkbox" className="size-4 accent-brand" checked={fields.has(k)} onChange={() => toggle(k)} aria-label={label} />{label}
          </label>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input ref={input} aria-label="Buscar producto" data-testid="product-input" autoComplete="off" disabled={disabled} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          placeholder={fields.has("supplier") ? "Buscar y agregar producto… (o nombre del proveedor)" : "Buscar y agregar producto… (nombre, código o escanea el código de barras)"} className={`${inputCls} h-11 pl-9 focus:border-brand`} />
        {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" aria-hidden />}
        {open && q.trim() && (items.length > 0 || none) && (
          <ul role="listbox" aria-label="Productos encontrados" data-testid="product-results" className="absolute left-0 right-0 top-12 z-30 max-h-[420px] overflow-y-auto rounded-lg border border-line bg-surface shadow-popover">
            {none && <li className="px-4 py-3 text-[13px] text-ink-2">No se encontró ningún producto con «{q.trim()}».</li>}
            {items.map((p, i) => {
              const out = p.kind === "GOODS" && Number(p.stockHere ?? 0) <= 0;
              return (
                <li key={p.id} role="option" aria-selected={i === active}>
                  <button type="button" onMouseEnter={() => setActive(i)} onClick={() => add(p)} data-testid={`prod-${p.code}`}
                    className={`flex w-full items-start gap-3 border-b border-line-strong/30 px-4 py-2.5 text-left text-[13px] ${i === active ? "bg-brand-soft" : "hover:bg-surface-muted"}`}>
                    {p.thumbUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.thumbUrl} alt="" className="size-11 shrink-0 rounded-md border border-line object-cover" />
                      : <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-md bg-neutral-soft text-ink-3"><Package className="size-5" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2"><span className="rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info">T: {p.code}</span><span className="font-semibold text-ink">{p.name}</span>{p.variantLabel && <span className="text-xs text-ink-3">({p.variantLabel})</span>}</span>
                      {(p.category || p.brand) && <span className="block text-xs text-ink-2">{[p.category, p.brand].filter(Boolean).join(" · ")}</span>}
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        <span className={out ? "font-semibold text-danger" : "font-semibold text-success"}>Stock: {stockText(p)}</span>
                        {p.suppliers.length > 0 && <span className="text-ink-2">Prov.: {p.suppliers.join(", ")}</span>}
                      </span>
                      {p.price ? (
                        <span className="mt-0.5 block text-xs text-ink-2">
                          {p.price.tiers.map((t) => `Q${tierRange(t)}: Bs ${fmt(t.price)}`).join("  |  ")}
                          <span className="text-ink-3"> · lista {p.price.listCode}{p.price.priceMode === "WITH_TAX" ? " (con impuestos)" : ""}</span>
                        </span>
                      ) : <span className="mt-0.5 block text-xs font-medium text-warning">Sin precio en las listas vigentes</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
