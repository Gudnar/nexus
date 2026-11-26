"use client";

import type { BulkPricesResult, CategorySummary, PriceGrid, PriceGridRow, PriceListSummary } from "@erp/contracts";
import { Loader2, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { btnPrimary, btnSecondary, Card, inputCls } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

// ───────────── Utilidades de celdas ─────────────

type Cells = Record<string, string[]>; // productId → [desde1, precio1, desde2, precio2, …]
type Sel = { r1: number; c1: number; r2: number; c2: number };

const fmtPrice = (s: string) => { const n = Number(s); const r2 = Math.round(n * 100) / 100; return Math.abs(n - r2) < 1e-9 ? r2.toFixed(2) : String(Math.round(n * 1e4) / 1e4); };
const fmtQty = (s: string) => String(Number(s));
const num = (s: string): number | null => { const t = s.trim().replace(",", "."); if (t === "") return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

function toCells(row: PriceGridRow, m: number): string[] {
  const out = Array<string>(m * 2).fill("");
  row.tiers.slice(0, m).forEach((t, i) => { out[i * 2] = fmtQty(t.minQuantity); out[i * 2 + 1] = fmtPrice(t.unitPrice); });
  return out;
}

/** Escalas de una fila: pares completos válidos, ordenados; o los problemas que impiden guardarla. */
function parseRow(cells: string[], hadPrice: boolean): { tiers: { minQuantity: number; unitPrice: number }[]; bad: Set<number>; error: string | null } {
  const bad = new Set<number>();
  const tiers: { minQuantity: number; unitPrice: number }[] = [];
  let error: string | null = null;
  for (let i = 0; i < cells.length; i += 2) {
    const min = num(cells[i]!); const price = num(cells[i + 1]!);
    if (min === null && price === null) continue;
    if (min === null || Number.isNaN(min) || min <= 0) { bad.add(i); error ??= "Cada escala necesita una cantidad «Desde» mayor que cero."; }
    if (price === null || Number.isNaN(price) || price < 0) { bad.add(i + 1); error ??= "Cada escala necesita un precio (no negativo)."; }
    if (!bad.has(i) && !bad.has(i + 1)) tiers.push({ minQuantity: min!, unitPrice: price! });
  }
  const mins = tiers.map((t) => t.minQuantity);
  if (new Set(mins).size !== mins.length) { error ??= "Dos escalas tienen la misma cantidad «Desde»."; for (let i = 0; i < cells.length; i += 2) if (mins.filter((x) => x === num(cells[i]!)).length > 1) bad.add(i); }
  if (tiers.length === 0 && hadPrice && !error) error = "No se puede dejar un producto sin precio desde aquí.";
  tiers.sort((a, b) => a.minQuantity - b.minQuantity);
  return { tiers, bad, error };
}

const sameCells = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x.trim() === b[i]!.trim());

function roundTo(v: number, step: number) { return step > 0 ? Math.round(v / step) * step : v; }

// ───────────── Componente ─────────────

export function PriceSheet({ lists, categories, canManage }: { lists: PriceListSummary[]; categories: CategorySummary[]; canManage: boolean }) {
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [q, setQ] = useState("");
  const [grid, setGrid] = useState<PriceGrid | null>(null);
  const [m, setM] = useState(3); // escalas visibles
  const [cells, setCells] = useState<Cells>({});
  const [orig, setOrig] = useState<Cells>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const undo = useRef<Cells[]>([]); const redo = useRef<Cells[]>([]);
  const [, bump] = useState(0);
  const dragging = useRef(false);
  const typingKey = useRef<string | null>(null);

  const rows = grid?.items ?? [];
  const cols = m * 2;

  const dirtyIds = useMemo(() => rows.filter((r) => cells[r.productId] && orig[r.productId] && !sameCells(cells[r.productId]!, orig[r.productId]!)).map((r) => r.productId), [rows, cells, orig]);
  const parsed = useMemo(() => new Map(rows.map((r) => [r.productId, parseRow(cells[r.productId] ?? [], r.tiers.length > 0)])), [rows, cells]);
  const errorIds = dirtyIds.filter((id) => parsed.get(id)?.error);

  // ── Carga
  const load = useCallback(async (list: string, cat: string, text: string, cols0: number) => {
    if (!list) return;
    setLoading(true);
    const qs = new URLSearchParams({ ...(cat ? { categoryId: cat } : {}), ...(text ? { q: text } : {}) }).toString();
    const r = await bff<PriceGrid>(`/bff/api/pricing/lists/${list}/grid${qs ? `?${qs}` : ""}`, "GET");
    setLoading(false);
    if (!r.ok) return setMsg({ ok: false, text: errorText(r) });
    const mm = Math.max(cols0, ...r.data.items.map((i) => i.tiers.length));
    setM(mm);
    setGrid(r.data);
    const c: Cells = {};
    for (const row of r.data.items) c[row.productId] = toCells(row, mm);
    setCells(c); setOrig(structuredClone(c));
    undo.current = []; redo.current = []; setSel(null); setActive(null);
  }, []);

  const confirmDiscard = () => dirtyIds.length === 0 || window.confirm(`Tienes ${dirtyIds.length} producto(s) con cambios sin guardar. ¿Descartarlos?`);
  const first = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => void load(listId, categoryId, q, 3), first.current ? 0 : 300);
    first.current = false;
    return () => clearTimeout(t);
  }, [listId, categoryId, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyIds.length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirtyIds.length]);

  // ── Edición con deshacer
  const snapshot = () => { undo.current.push(structuredClone(cells)); if (undo.current.length > 100) undo.current.shift(); redo.current = []; bump((x) => x + 1); };
  const mutate = (fn: (c: Cells) => void) => { snapshot(); setCells((prev) => { const n = structuredClone(prev); fn(n); return n; }); };
  const doUndo = () => { const s = undo.current.pop(); if (!s) return; redo.current.push(structuredClone(cells)); setCells(s); bump((x) => x + 1); };
  const doRedo = () => { const s = redo.current.pop(); if (!s) return; undo.current.push(structuredClone(cells)); setCells(s); bump((x) => x + 1); };

  const setCell = (r: number, c: number, v: string) => {
    const id = rows[r]!.productId;
    const key = `${id}:${c}`;
    if (typingKey.current !== key) { snapshot(); typingKey.current = key; }
    setCells((prev) => {
      const next = { ...prev, [id]: [...(prev[id] ?? [])] };
      next[id]![c] = v;
      // Primer precio en una fila sin escalas: la cantidad mínima es 1.
      if (c % 2 === 1 && v.trim() !== "" && (next[id]![c - 1] ?? "").trim() === "") next[id]![c - 1] = "1";
      return next;
    });
  };

  const focusCell = (r: number, c: number, extend = false) => {
    const rr = Math.max(0, Math.min(rows.length - 1, r)); const cc = Math.max(0, Math.min(cols - 1, c));
    typingKey.current = null;
    setActive({ r: rr, c: cc });
    setSel((s) => (extend && s ? { ...s, r2: rr, c2: cc } : { r1: rr, c1: cc, r2: rr, c2: cc }));
    requestAnimationFrame(() => { const el = document.querySelector<HTMLInputElement>(`[data-cell="${rr}:${cc}"]`); el?.focus(); el?.select(); });
  };

  const rect = sel ? { r1: Math.min(sel.r1, sel.r2), r2: Math.max(sel.r1, sel.r2), c1: Math.min(sel.c1, sel.c2), c2: Math.max(sel.c1, sel.c2) } : null;
  const inSel = (r: number, c: number) => !!rect && r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;

  const clearSelection = () => { if (!rect) return; mutate((n) => { for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) n[rows[r]!.productId]![c] = ""; }); };
  const fillDown = () => { if (!rect) return; mutate((n) => { for (let c = rect.c1; c <= rect.c2; c++) { const v = n[rows[rect.r1]!.productId]![c]!; for (let r = rect.r1 + 1; r <= rect.r2; r++) n[rows[r]!.productId]![c] = v; } }); };
  const copy = async () => {
    if (!rect) return;
    const tsv = Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => Array.from({ length: rect.c2 - rect.c1 + 1 }, (_, j) => cells[rows[rect.r1 + i]!.productId]![rect.c1 + j]).join("\t")).join("\n");
    try { await navigator.clipboard.writeText(tsv); } catch { /* sin portapapeles */ }
  };
  const pasteText = (text: string) => {
    if (!active) return;
    const data = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    mutate((n) => {
      data.forEach((line, i) => line.forEach((v, j) => {
        const r = active.r + i; const c = active.c + j;
        if (r >= rows.length || c >= cols) return;
        n[rows[r]!.productId]![c] = v.trim();
      }));
    });
    setSel({ r1: active.r, c1: active.c, r2: Math.min(rows.length - 1, active.r + data.length - 1), c2: Math.min(cols - 1, active.c + Math.max(...data.map((l) => l.length)) - 1) });
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); return doRedo(); }
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); return void save(); }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); return fillDown(); }
    if (mod && e.key.toLowerCase() === "c" && rect && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2)) { e.preventDefault(); return void copy(); }
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); return setSel({ r1: 0, c1: 0, r2: rows.length - 1, c2: cols - 1 }); }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); return focusCell(r + 1, c, e.shiftKey);
      case "ArrowUp": e.preventDefault(); return focusCell(r - 1, c, e.shiftKey);
      case "ArrowRight": e.preventDefault(); return focusCell(r, c + 1, e.shiftKey);
      case "ArrowLeft": e.preventDefault(); return focusCell(r, c - 1, e.shiftKey);
      case "Enter": e.preventDefault(); return focusCell(r + (e.shiftKey ? -1 : 1), c);
      case "Tab": e.preventDefault(); return focusCell(r, c + (e.shiftKey ? -1 : 1));
      case "Escape": e.preventDefault(); return focusCell(r, c);
      case "Delete": case "Backspace":
        if (rect && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2 || e.key === "Delete")) { e.preventDefault(); clearSelection(); }
    }
  };

  // ── Ajuste masivo (se aplica a la hoja; no guarda hasta pulsar «Guardar»)
  const [adj, setAdj] = useState({ scope: "selection", op: "pct", value: "", round: "0.01", tiers: "all" });
  function applyAdjust() {
    const v = num(adj.value);
    if (v === null || Number.isNaN(v)) return setMsg({ ok: false, text: "Escribe el valor del ajuste (por ejemplo 5 para 5 %)." });
    const targetRows = adj.scope === "selection" && rect ? rows.slice(rect.r1, rect.r2 + 1) : rows;
    if (adj.scope === "selection" && !rect) return setMsg({ ok: false, text: "Selecciona primero las celdas (columnas de precio) que quieres ajustar." });
    const step = Number(adj.round);
    let touched = 0;
    const n = structuredClone(cells);
    {
      for (const row of targetRows) {
        const arr = n[row.productId]!;
        for (let i = 1; i < arr.length; i += 2) {
          if (adj.tiers === "first" && i !== 1) continue;
          if (adj.scope === "selection" && rect && (i < rect.c1 || i > rect.c2)) continue; // solo las columnas seleccionadas
          const cur = num(arr[i]!);
          if (cur === null || Number.isNaN(cur)) continue;
          let nv = cur;
          if (adj.op === "pct") nv = cur * (1 + v / 100);
          else if (adj.op === "add") nv = cur + v;
          else nv = v;
          nv = Math.max(0, roundTo(nv, step));
          arr[i] = fmtPrice(String(Math.round(nv * 1e4) / 1e4));
          touched++;
        }
      }
    }
    if (touched > 0) { snapshot(); setCells(n); }
    setMsg({ ok: true, text: `Ajuste aplicado a ${touched} precio(s) en ${targetRows.length} producto(s). Revisa y pulsa «Guardar cambios».` });
  }

  // ── Guardar
  async function save() {
    if (!canManage || dirtyIds.length === 0 || saving) return;
    if (errorIds.length) return setMsg({ ok: false, text: `Hay ${errorIds.length} producto(s) con celdas incorrectas (en rojo). Corrígelos para guardar.` });
    setSaving(true); setMsg(null);
    const items = dirtyIds.map((id) => ({ productId: id, tiers: parsed.get(id)!.tiers }));
    const r = await bff<BulkPricesResult>(`/bff/api/pricing/lists/${listId}/prices/bulk`, "POST", { items });
    setSaving(false);
    if (!r.ok) {
      const errs = (r.data as { errors?: unknown }).errors;
      return setMsg({ ok: false, text: errorText(r, "No se pudo guardar."), list: Array.isArray(errs) ? (errs as string[]) : undefined });
    }
    setMsg({ ok: true, text: `Guardado: ${r.data.updated} producto(s) actualizado(s).` });
    await load(listId, categoryId, q, m);
  }

  const list = lists.find((l) => l.id === listId);
  const catOptions = useMemo(() => {
    const byParent = new Map<string | null, CategorySummary[]>();
    for (const c of categories.filter((x) => x.status === "ACTIVE")) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
    const out: { id: string; label: string }[] = [];
    const walk = (p: string | null, depth: number) => { for (const c of (byParent.get(p) ?? []).sort((a, b) => a.name.localeCompare(b.name, "es"))) { out.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}` }); walk(c.id, depth + 1); } };
    walk(null, 0);
    return out;
  }, [categories]);

  if (lists.length === 0) return <Card><p className="text-[13px] text-ink-2">Primero crea una lista de precios en la pestaña «Listas de precios».</p></Card>;

  return (
    <div className="grid gap-4">
      <Card>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr_auto] lg:items-end">
          <label className="grid gap-1 text-[12px] font-medium text-ink-2">Lista de precios
            <select aria-label="Lista de precios" className={inputCls} value={listId} onChange={(e) => { if (confirmDiscard()) setListId(e.target.value); }}>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-medium text-ink-2">Categoría
            <select aria-label="Categoría" className={inputCls} value={categoryId} onChange={(e) => { if (confirmDiscard()) setCategoryId(e.target.value); }}>
              <option value="">Todas las categorías</option>
              {catOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-medium text-ink-2">Buscar
            <input aria-label="Buscar producto" className={inputCls} placeholder="Código o nombre" value={q} onChange={(e) => { if (dirtyIds.length === 0 || confirmDiscard()) setQ(e.target.value); }} />
          </label>
          <div className="flex items-center gap-2">
            <button className={`${btnSecondary} h-10 px-3`} onClick={doUndo} disabled={undo.current.length === 0} aria-label="Deshacer" title="Deshacer (Ctrl+Z)"><Undo2 className="size-4" aria-hidden /></button>
            <button className={`${btnSecondary} h-10 px-3`} onClick={doRedo} disabled={redo.current.length === 0} aria-label="Rehacer" title="Rehacer (Ctrl+Y)"><Redo2 className="size-4" aria-hidden /></button>
          </div>
        </div>
        {list && <p className="mt-3 text-xs text-ink-3">{list.priceMode === "WITH_TAX" ? "Los precios incluyen impuestos" : "Los precios no incluyen impuestos"} · {list.currency} · {grid?.scalingMode === "PROGRESSIVE" ? "Escala progresiva: cada unidad se cobra al precio de su tramo" : "Escala por umbral: al llegar a un tramo, todas las unidades se cobran a su precio"}</p>}
      </Card>

      {canManage && (
        <Card>
          <div className="flex flex-wrap items-end gap-3 text-[12px] font-medium text-ink-2" data-testid="adjust-bar">
            <span className="pb-2.5 text-[13px] font-semibold text-ink">Ajuste masivo</span>
            <label className="grid gap-1">Aplicar a
              <select aria-label="Aplicar a" className={`${inputCls} w-44`} value={adj.scope} onChange={(e) => setAdj({ ...adj, scope: e.target.value })}><option value="selection">Celdas seleccionadas</option><option value="all">Todas las filas de la vista</option></select>
            </label>
            <label className="grid gap-1">Operación
              <select aria-label="Operación" className={`${inputCls} w-44`} value={adj.op} onChange={(e) => setAdj({ ...adj, op: e.target.value })}><option value="pct">Subir / bajar %</option><option value="add">Sumar / restar importe</option><option value="set">Fijar precio</option></select>
            </label>
            <label className="grid gap-1">Valor
              <input aria-label="Valor del ajuste" className={`${inputCls} w-24`} inputMode="decimal" placeholder={adj.op === "pct" ? "5 ó -5" : "1,50"} value={adj.value} onChange={(e) => setAdj({ ...adj, value: e.target.value })} />
            </label>
            <label className="grid gap-1">Redondear a
              <select aria-label="Redondeo" className={`${inputCls} w-28`} value={adj.round} onChange={(e) => setAdj({ ...adj, round: e.target.value })}><option value="0.01">0,01</option><option value="0.1">0,10</option><option value="0.5">0,50</option><option value="1">1,00</option></select>
            </label>
            <label className="grid gap-1">Escalas
              <select aria-label="Escalas a ajustar" className={`${inputCls} w-40`} value={adj.tiers} onChange={(e) => setAdj({ ...adj, tiers: e.target.value })}><option value="all">Todas</option><option value="first">Solo la primera</option></select>
            </label>
            <button className={btnSecondary} onClick={applyAdjust}>Aplicar a la hoja</button>
          </div>
        </Card>
      )}

      {msg && (
        <div role={msg.ok ? "status" : "alert"} data-testid="sheet-msg" className={`rounded-lg px-4 py-2.5 text-[13px] ${msg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
          {msg.text}
          {msg.list && <ul className="mt-1 list-disc pl-5">{msg.list.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="text-[13px] text-ink-2" data-testid="sheet-count">
            {loading ? "Cargando…" : `${rows.length} producto(s)`}{grid?.truncated ? " (se muestran los primeros 500: filtra por categoría)" : ""} · <strong className="text-ink">{dirtyIds.length}</strong> con cambios{errorIds.length ? <> · <span className="text-danger">{errorIds.length} con errores</span></> : null}
          </p>
          <div className="flex items-center gap-2">
            <button className={`${btnSecondary} h-9 px-3`} onClick={() => setM((x) => Math.max(1, Math.min(x - 1, 8)))} disabled={m <= 1 || rows.some((r) => (cells[r.productId] ?? []).slice((m - 1) * 2).some((v) => v.trim() !== ""))} aria-label="Menos escalas" title="Quitar una escala (solo si está vacía)">− escala</button>
            <span className="text-[13px] text-ink-2">{m} escala(s)</span>
            <button className={`${btnSecondary} h-9 px-3`} onClick={() => { setM((x) => Math.min(8, x + 1)); setCells((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v, "", ""]]))); setOrig((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v, "", ""]]))); }} disabled={m >= 8} aria-label="Más escalas">+ escala</button>
            {canManage && <button className={`${btnSecondary} h-9 px-3`} onClick={() => { if (dirtyIds.length === 0 || confirmDiscard()) void load(listId, categoryId, q, m); }} disabled={dirtyIds.length === 0}>Descartar</button>}
            {canManage && <button className={`${btnPrimary} h-9`} onClick={save} disabled={dirtyIds.length === 0 || saving} data-testid="save-sheet">{saving && <Loader2 className="size-4 animate-spin" aria-hidden />}Guardar cambios{dirtyIds.length ? ` (${dirtyIds.length})` : ""}</button>}
          </div>
        </div>

        <div className="max-h-[62vh] overflow-auto" onMouseUp={() => { dragging.current = false; }} onMouseLeave={() => { dragging.current = false; }}>
          <table className="w-full border-separate border-spacing-0 text-[13px]" data-testid="price-sheet" onPaste={(e) => { if (!canManage) return; const t = e.clipboardData.getData("text"); if (t.includes("\t") || t.includes("\n")) { e.preventDefault(); pasteText(t); } }}>
            <thead className="sticky top-0 z-20 bg-surface-muted">
              <tr className="text-left text-ink-2">
                <th className="sticky left-0 z-30 min-w-[96px] border-b border-r border-line bg-surface-muted px-3 py-2 font-medium">Código</th>
                <th className="sticky left-[96px] z-30 min-w-[220px] border-b border-r border-line bg-surface-muted px-3 py-2 font-medium">Producto</th>
                <th className="min-w-[120px] border-b border-line px-3 py-2 font-medium">Categoría</th>
                <th className="min-w-[56px] border-b border-r border-line px-3 py-2 font-medium">Unid.</th>
                {Array.from({ length: m }, (_, i) => (
                  <th key={i} colSpan={2} className="border-b border-r border-line px-3 py-1.5 text-center font-medium">
                    Escala {i + 1}
                    <span className="mt-0.5 grid grid-cols-2 gap-px text-[11px] font-normal text-ink-3"><span>Desde</span><span>Precio</span></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.length === 0 && !loading && <tr><td colSpan={4 + cols} className="px-4 py-10 text-center text-ink-3">No hay productos con ese filtro.</td></tr>}
              {rows.map((row, r) => {
                const dirty = dirtyIds.includes(row.productId);
                const p = parsed.get(row.productId)!;
                const o = orig[row.productId] ?? [];
                return (
                  <tr key={row.productId} className={dirty ? (p.error ? "bg-danger-soft/40" : "bg-warning-soft/40") : ""} data-testid={`row-${row.code}`} title={p.error ?? undefined}>
                    <td className={`sticky left-0 z-10 border-b border-r border-line px-3 py-1.5 font-mono text-xs ${dirty ? "bg-warning-soft" : "bg-surface"}`}>{row.code}</td>
                    <td className={`sticky left-[96px] z-10 border-b border-r border-line px-3 py-1.5 font-sans ${dirty ? "bg-warning-soft" : "bg-surface"}`}>{row.name}{row.tiers.length === 0 && <span className="ml-2 rounded-full bg-neutral-soft px-1.5 text-[10px] text-ink-3">sin precio</span>}</td>
                    <td className="border-b border-line px-3 py-1.5 font-sans text-ink-2">{row.category ?? "—"}</td>
                    <td className="border-b border-r border-line px-3 py-1.5 font-sans text-ink-2">{row.unit}</td>
                    {Array.from({ length: cols }, (_, c) => {
                      const v = cells[row.productId]?.[c] ?? "";
                      const changed = dirty && (o[c] ?? "").trim() !== v.trim();
                      const isBad = dirty && p.bad.has(c);
                      return (
                        <td key={c} className={`border-b p-0 ${c % 2 === 1 ? "border-r border-line" : "border-line/60"} ${inSel(r, c) ? "bg-brand-soft" : ""}`}
                          onMouseDown={(e) => { if (e.shiftKey && sel) return; dragging.current = true; setSel({ r1: r, c1: c, r2: r, c2: c }); setActive({ r, c }); }}
                          onMouseEnter={() => { if (dragging.current) setSel((s) => (s ? { ...s, r2: r, c2: c } : s)); }}>
                          <input data-cell={`${r}:${c}`} aria-label={`${row.code} ${c % 2 === 0 ? "desde" : "precio"} ${Math.floor(c / 2) + 1}`} readOnly={!canManage} inputMode="decimal" autoComplete="off"
                            value={v} onChange={(e) => setCell(r, c, e.target.value)} onKeyDown={(e) => onKey(e, r, c)}
                            onFocus={(e) => { setActive({ r, c }); if (!(sel && inSel(r, c) && (rect!.r1 !== rect!.r2 || rect!.c1 !== rect!.c2))) setSel({ r1: r, c1: c, r2: r, c2: c }); e.currentTarget.select(); }}
                            className={`h-9 w-full min-w-[72px] bg-transparent px-2 text-right outline-none focus:ring-2 focus:ring-inset focus:ring-brand ${isBad ? "text-danger ring-1 ring-inset ring-danger" : changed ? "font-semibold text-ink" : c % 2 === 0 ? "text-ink-3" : "text-body"}`} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs text-ink-3">
          Flechas, Tab y Enter para moverte · escribe para reemplazar · Shift+flechas o arrastra para seleccionar · Ctrl+C / Ctrl+V (puedes pegar desde Excel) · Ctrl+D copia hacia abajo · Supr borra · Ctrl+Z deshace · Ctrl+S guarda.
          Cada escala vale desde la cantidad «Desde» hasta antes de la siguiente; la última queda abierta. Un producto sin escalas no se modifica.
        </p>
      </Card>
    </div>
  );
}
