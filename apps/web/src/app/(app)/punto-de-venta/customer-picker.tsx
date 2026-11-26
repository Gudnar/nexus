"use client";

import type { CustomerSummary } from "@erp/contracts";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { fmt } from "./pos-helpers";

/**
 * Cliente de la venta: se busca por nombre, código, NIT/CI o teléfono y al elegirlo se completan sus datos.
 * También permite registrar un cliente nuevo sin salir de la venta.
 */
export function CustomerPicker({ value, onPick, canCreate }: { value: CustomerSummary | null; onPick: (c: CustomerSummary | null) => void; canCreate: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CustomerSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  /** Texto para el que ya terminó la búsqueda: «sin coincidencias» solo se dice entonces, no mientras se espera la respuesta. */
  const [searched, setSearched] = useState<string | null>(null);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value || q.trim().length < 1) { setItems([]); setSearched(null); return; }
    setSearched(null);
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await bff<CustomerSummary[]>(`/bff/api/sales/customers?q=${encodeURIComponent(q.trim())}`, "GET");
      if (my !== seq.current) return;
      setLoading(false);
      setItems(r.ok ? r.data.filter((c) => c.status === "ACTIVE").slice(0, 8) : []);
      setSearched(q.trim());
      setActive(0);
    }, 220);
    return () => clearTimeout(t);
  }, [q, value]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (c: CustomerSummary) => { onPick(c); setQ(""); setOpen(false); };

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); pick(items[active]!); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div ref={box} className="relative font-normal normal-case tracking-normal">
      {value ? (
        <div className="flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface-muted px-3 text-[13px]" data-testid="customer-selected">
          <span className="min-w-0 flex-1 truncate"><strong className="text-ink">{value.name}</strong> <span className="text-ink-3">{value.code}{value.taxId ? ` · ${value.taxId}` : ""}{value.phone ? ` · ${value.phone}` : ""}</span></span>
          <button type="button" onClick={() => onPick(null)} className="rounded p-1 text-ink-3 hover:bg-neutral-soft hover:text-danger" aria-label="Quitar cliente"><X className="size-4" /></button>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input aria-label="Buscar cliente" autoComplete="off" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
              placeholder="Nombre, NIT, teléfono o código… (vacío = consumidor final)" className={`${inputCls} pl-9`} />
            {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-3" aria-hidden />}
          </div>
          {canCreate && <button type="button" className={`${btnSecondary} shrink-0 px-3`} onClick={() => setCreating(true)} aria-label="Registrar cliente nuevo" title="Registrar cliente nuevo"><UserPlus className="size-4" aria-hidden /><span className="hidden xl:inline">Nuevo</span></button>}
        </div>
      )}
      {open && !value && q.trim() && (items.length > 0 || searched === q.trim()) && (
        <ul role="listbox" aria-label="Clientes encontrados" data-testid="customer-results" className="absolute left-0 right-0 top-11 z-30 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface shadow-popover">
          {items.length === 0 && searched === q.trim() && (
            <li className="px-4 py-3 text-[13px] text-ink-2">
              Sin coincidencias. {canCreate && <button type="button" className="font-medium text-brand hover:underline" onClick={() => { setCreating(true); setOpen(false); }}>Registrar «{q.trim()}» como cliente nuevo</button>}
            </li>
          )}
          {items.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(c)} className={`block w-full border-b border-line-strong/30 px-4 py-2.5 text-left text-[13px] ${i === active ? "bg-brand-soft" : "hover:bg-surface-muted"}`}>
                <span className="font-medium text-ink">{c.name}</span>
                <span className="block text-xs text-ink-2">{c.code}{c.taxId ? ` · NIT/CI ${c.taxId}` : ""}{c.phone ? ` · Tel. ${c.phone}` : ""}</span>
                {(Number(c.outstanding) > 0 || c.defaultPriceList || c.paymentTermsDays > 0) && (
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px]">
                    {Number(c.outstanding) > 0 && <span className="text-danger">Debe Bs {fmt(c.outstanding)}</span>}
                    {c.defaultPriceList && <span className="text-brand">Lista {c.defaultPriceList.name}</span>}
                    {c.paymentTermsDays > 0 && <span className="text-ink-3">Crédito a {c.paymentTermsDays} días</span>}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Registrar cliente">
        {creating && <NewCustomerForm initialName={q.trim()} onCancel={() => setCreating(false)} onCreated={(c) => { setCreating(false); pick(c); }} />}
      </Modal>
    </div>
  );
}

function NewCustomerForm({ initialName, onCancel, onCreated }: { initialName: string; onCancel: () => void; onCreated: (c: CustomerSummary) => void }) {
  const looksLikeName = initialName && !/^[\d\s+-]+$/.test(initialName);
  const [f, setF] = useState({ name: looksLikeName ? initialName : "", taxId: /^\d{5,}$/.test(initialName) ? initialName : "", phone: "", email: "", address: "", paymentTermsDays: "0" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff<CustomerSummary>("/bff/api/sales/customers", "POST", {
      name: f.name.trim(), taxId: f.taxId.trim() || undefined, phone: f.phone.trim() || undefined, email: f.email.trim() || undefined, address: f.address.trim() || undefined, paymentTermsDays: Number(f.paymentTermsDays) || 0,
    });
    setBusy(false);
    if (!r.ok) return setError(r.data.code === "DUPLICATE_CUSTOMER" ? "Ya existe un cliente con ese NIT/documento: búscalo por su NIT." : errorText(r));
    onCreated(r.data);
  }
  const lab = "grid gap-1 text-xs font-medium text-ink-2";
  return (
    <form onSubmit={submit} className="grid gap-4 text-[13px]" data-testid="new-customer-form">
      <label className={lab}>Nombre o razón social<input aria-label="Nombre del cliente nuevo" required minLength={2} autoFocus className={inputCls} value={f.name} onChange={set("name")} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={lab}>NIT / CI<input aria-label="NIT o CI del cliente nuevo" className={inputCls} value={f.taxId} onChange={set("taxId")} /></label>
        <label className={lab}>Celular<input aria-label="Celular del cliente nuevo" className={inputCls} inputMode="tel" value={f.phone} onChange={set("phone")} /></label>
        <label className={lab}>Correo electrónico<input aria-label="Correo del cliente nuevo" type="email" className={inputCls} value={f.email} onChange={set("email")} /></label>
        <label className={lab}>Plazo de pago (días)<input aria-label="Plazo de pago" type="number" min={0} max={365} className={inputCls} value={f.paymentTermsDays} onChange={set("paymentTermsDays")} /></label>
      </div>
      <label className={lab}>Dirección<input aria-label="Dirección del cliente nuevo" className={inputCls} value={f.address} onChange={set("address")} /></label>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button><button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}Registrar y usar</button></div>
    </form>
  );
}
