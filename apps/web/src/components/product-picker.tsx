"use client";

import type { ProductSummary } from "@erp/contracts";
import { useEffect, useState } from "react";
import { bff } from "@/lib/client-api";
import { inputCls } from "./ui";

export interface PickedProduct { id: string; code: string; name: string; unit: string; trackLots: boolean; trackExpiry: boolean; kind: string; decimals: number }

/** Buscador de productos con sugerencias (≥ 2 letras). Solo bienes si `goodsOnly`. */
export function ProductPicker({ value, onChange, goodsOnly = false, autoFocus = false }: {
  value: PickedProduct | null; onChange: (p: PickedProduct | null) => void; goodsOnly?: boolean; autoFocus?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<ProductSummary[]>([]);

  useEffect(() => {
    if (value || search.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ q: search.trim(), status: "ACTIVE", limit: "8", ...(goodsOnly ? { kind: "GOODS" } : {}) });
      const r = await bff<{ items: ProductSummary[] }>(`/bff/api/catalog/products?${qs}`, "GET");
      if (r.ok) setFound(r.data.items);
    }, 250);
    return () => clearTimeout(t);
  }, [search, value, goodsOnly]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line-strong bg-surface-muted px-3 py-2 text-[13px]">
        <span className="text-ink">{value.name} <span className="text-ink-3">· {value.code}</span></span>
        <button type="button" className="text-brand hover:underline" onClick={() => { onChange(null); setSearch(""); }}>Cambiar</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto por código o nombre…" autoFocus={autoFocus} aria-label="Buscar producto" />
      {found.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface shadow-popover">
          {found.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-[13px] hover:bg-surface-muted"
                onClick={() => onChange({ id: p.id, code: p.code, name: p.name, unit: p.baseUnit.code, trackLots: p.trackLots, trackExpiry: p.trackExpiry, kind: p.kind, decimals: p.baseUnit.decimals })}>
                {p.name} <span className="text-ink-3">· {p.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
