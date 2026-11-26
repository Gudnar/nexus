"use client";

import type { CashSessionSummary, CustomerSummary, PosProductRow, SaleDetail, SalePreviewResult, WarehouseSummary } from "@erp/contracts";
import { CheckCircle2, Loader2, Minus, Plus, Save, ShoppingCart, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PrintButton } from "@/components/print-button";
import { Modal } from "@/components/modal";
import { btnPrimary, btnSecondary, Card, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { SaleView, type Can } from "../ventas/sales-manager";
import { CustomerPicker } from "./customer-picker";
import { PaymentModal, type PayResult } from "./payment-modal";
import { fmt, parseNum, qtyFmt, stockText, tierFor, tierRange } from "./pos-helpers";
import { ProductSearch } from "./product-search";

interface Line { key: string; productId: string; code: string; name: string; category: string | null; unit: string; decimals: number; kind: "GOODS" | "SERVICE"; info: PosProductRow | null; qty: string; discount: string }

const lab = "grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2";
const field = `${inputCls} h-10 font-normal normal-case tracking-normal`;
let seq = 0;
const newKey = () => `l${++seq}`;
const plusDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function PointOfSale({
  branches, warehouses, sessions, can, initial, today, collectMode,
}: { branches: { id: string; name: string }[]; warehouses: WarehouseSummary[]; sessions: CashSessionSummary[]; can: Can & { createCustomer: boolean; collectPending: boolean }; initial: SaleDetail | null; today: string; collectMode: "AT_POS" | "AT_CASHIER" }) {
  /** Con el cobro en caja activado, el punto de venta solo guarda: cobra quien tiene el permiso de cobrar ventas guardadas. */
  const canCharge = can.confirm && (collectMode === "AT_POS" || can.collectPending);
  const storage = warehouses.filter((w) => w.status === "ACTIVE" && w.kind === "STORAGE");
  const branchList = branches.filter((b) => storage.some((w) => w.branch.id === b.id));

  const [branchId, setBranchId] = useState(initial?.branchId ?? branchList[0]?.id ?? "");
  const whOptions = storage.filter((w) => w.branch.id === branchId);
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? whOptions[0]?.id ?? "");
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [withTax, setWithTax] = useState(initial?.withTax ?? true);
  const [billingTaxId, setBillingTaxId] = useState(initial?.billingTaxId ?? "");
  const [billingName, setBillingName] = useState(initial?.billingName ?? "");
  const [saleType, setSaleType] = useState<"CASH" | "CREDIT">("CASH");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? today);
  const [note, setNote] = useState(initial?.note ?? "");
  const [lines, setLines] = useState<Line[]>(() => (initial?.lines ?? []).map((l) => ({ key: newKey(), productId: l.productId, code: l.productCode, name: l.productName, category: null, unit: l.unit, decimals: 4, kind: "GOODS" as const, info: null, qty: String(Number(l.quantity)), discount: String(Number(l.discountPct)) })));
  const [sale, setSale] = useState<SaleDetail | null>(initial && initial.status === "DRAFT" ? initial : null);
  const [done, setDone] = useState<SaleDetail | null>(null);
  const [preview, setPreview] = useState<SalePreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [viewing, setViewing] = useState(false);
  const previewSeq = useRef(0);
  const dirty = useRef(false);

  const branchSessions = sessions.filter((s) => s.branchId === branchId && s.status === "OPEN");

  // Al cambiar de sucursal se elige su primer almacén.
  useEffect(() => { if (!whOptions.some((w) => w.id === warehouseId)) setWarehouseId(whOptions[0]?.id ?? ""); }, [branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Borrador abierto desde la búsqueda: se completan el cliente y los datos de cada producto.
  useEffect(() => {
    if (!initial) return;
    (async () => {
      if (initial.customer) { const r = await bff<CustomerSummary>(`/bff/api/sales/customers/${initial.customer.id}`, "GET"); if (r.ok) setCustomer(r.data); }
      const infos = await Promise.all(initial.lines.map(async (l) => {
        const r = await bff<PosProductRow[]>(`/bff/api/sales/product-search?${new URLSearchParams({ q: l.productCode, fields: "code", warehouseId: initial.warehouseId })}`, "GET");
        return r.ok ? r.data.find((p) => p.id === l.productId) ?? null : null;
      }));
      setLines((cur) => cur.map((l) => { const p = infos.find((i) => i?.id === l.productId); return p ? { ...l, info: p, category: p.category, decimals: p.decimals, kind: p.kind } : l; }));
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cálculo en el servidor: precio según cantidad, descuentos e impuestos.
  const priced = useMemo(() => lines.map((l) => ({ productId: l.productId, quantity: parseNum(l.qty), discountPct: parseNum(l.discount) ?? 0 })), [lines]);
  const calcKey = JSON.stringify([priced, warehouseId, customer?.id ?? null, withTax]);
  useEffect(() => {
    const valid = priced.filter((l) => l.quantity !== null && !Number.isNaN(l.quantity) && l.quantity > 0);
    if (!warehouseId || lines.length === 0 || valid.length !== lines.length) { if (lines.length === 0) setPreview(null); return; }
    const my = ++previewSeq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      const r = await bff<SalePreviewResult>("/bff/api/sales/preview", "POST", {
        warehouseId, withTax, ...(customer ? { customerId: customer.id } : {}),
        lines: valid.map((l) => ({ productId: l.productId, quantity: l.quantity, ...(l.discountPct > 0 ? { discountPct: l.discountPct } : {}) })),
      });
      if (my !== previewSeq.current) return;
      setPreviewing(false);
      if (r.ok) { setPreview(r.data); setPreviewError(null); } else setPreviewError(errorText(r, "No se pudo calcular la venta."));
    }, 260);
    return () => clearTimeout(t);
  }, [calcKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const touch = () => { dirty.current = true; setMsg(null); };
  const priceOf = (productId: string) => preview?.lines.find((l) => l.productId === productId);

  // ── Líneas
  const addProduct = useCallback((p: PosProductRow) => {
    touch();
    setLines((cur) => {
      const i = cur.findIndex((l) => l.productId === p.id);
      if (i >= 0) return cur.map((l, j) => (j === i ? { ...l, qty: String((parseNum(l.qty) || 0) + 1) } : l));
      return [...cur, { key: newKey(), productId: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit, decimals: p.decimals, kind: p.kind, info: p, qty: "1", discount: "0" }];
    });
  }, []);
  const setLine = (key: string, patch: Partial<Line>) => { touch(); setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l))); };
  const step = (l: Line, d: number) => setLine(l.key, { qty: String(Math.max(l.decimals > 0 ? 0.001 : 1, Math.round(((parseNum(l.qty) || 0) + d) * 1000) / 1000)) });

  // ── Guardar / cobrar
  const body = () => ({
    warehouseId, withTax, billingName: billingName.trim() || null, billingTaxId: billingTaxId.trim() || null, note: note.trim() || null,
    customerId: customer?.id ?? null,
    lines: lines.map((l) => ({ productId: l.productId, quantity: parseNum(l.qty) as number, ...((parseNum(l.discount) ?? 0) > 0 ? { discountPct: parseNum(l.discount) as number } : {}) })),
  });
  const problem = (): string | null => {
    if (!warehouseId) return "Elige la sucursal y el almacén desde el que vendes.";
    if (lines.length === 0) return "Agrega al menos un producto.";
    if (lines.some((l) => { const q = parseNum(l.qty); return q === null || Number.isNaN(q) || q <= 0; })) return "Hay cantidades vacías o incorrectas.";
    return null;
  };

  async function save(): Promise<SaleDetail | null> {
    const p = problem();
    if (p) { setMsg({ ok: false, text: p }); return null; }
    setSaving(true); setMsg(null);
    const r = sale
      ? await bff<SaleDetail>(`/bff/api/sales/orders/${sale.id}`, "PATCH", body())
      : await bff<SaleDetail>("/bff/api/sales/orders", "POST", { ...body(), channel: "POS", customerId: customer?.id ?? undefined });
    setSaving(false);
    if (!r.ok) { setMsg({ ok: false, text: errorText(r, "No se pudo guardar la venta.") }); return null; }
    setSale(r.data); dirty.current = false;
    return r.data;
  }

  async function saveDraft() {
    const s = await save();
    if (!s) return;
    if (canCharge) return setMsg({ ok: true, text: "Venta guardada como borrador: puedes seguir editándola o cobrarla después." });
    // Sin cobro en el punto de venta: la venta queda pendiente para el cajero y se empieza otra.
    reset();
    setMsg({ ok: true, text: `Venta guardada por Bs ${fmt(s.total)}${s.customer ? ` (${s.customer.name})` : ""}: queda pendiente de cobro en caja.` });
  }

  async function confirmSale(r: PayResult) {
    setPayBusy(true); setPayError(null);
    const s = await save();
    if (!s) { setPayBusy(false); setPayError("No se pudo guardar la venta antes de cobrar."); return; }
    const paid = r.payments.reduce((x, p) => x + p.amount, 0);
    if (paid > Number(s.total) + 0.001) { setPayBusy(false); return setPayError(`El total real de la venta es Bs ${fmt(s.total)}: ajusta los cobros.`); }
    const c = await bff<SaleDetail>(`/bff/api/sales/orders/${s.id}/confirm`, "POST", { payments: r.payments, ...(r.dueDate ? { dueDate: r.dueDate } : {}) });
    setPayBusy(false);
    if (!c.ok) return setPayError(errorText(c, "No se pudo confirmar la venta."));
    setPaying(false); setDone(c.data); setSale(null);
  }

  function reset() {
    setLines([]); setSale(null); setDone(null); setCustomer(null); setWithTax(true); setBillingName(""); setBillingTaxId(""); setNote(""); setPreview(null); setSaleType("CASH"); setDueDate(today); setMsg(null); setPayError(null);
    dirty.current = false;
    if (initial) window.history.replaceState(null, "", "/punto-de-venta");
  }

  async function discard() {
    if (!sale || !window.confirm("¿Descartar este borrador? No deja rastro en stock ni en cobros.")) return;
    const r = await bff(`/bff/api/sales/orders/${sale.id}/discard`, "POST");
    if (!r.ok) return setMsg({ ok: false, text: errorText(r) });
    reset();
    setMsg({ ok: true, text: "Borrador descartado." });
  }

  function pickCustomer(c: CustomerSummary | null) {
    touch(); setCustomer(c);
    // Se completan los datos del comprobante con los del cliente.
    setBillingName(c?.name ?? ""); setBillingTaxId(c?.taxId ?? "");
    if (c && c.paymentTermsDays > 0) setDueDate(plusDays(today, c.paymentTermsDays));
    if (!c) setSaleType("CASH");
  }

  const total = Number(preview?.totals.total ?? 0);
  const canProcess = canCharge && lines.length > 0 && !previewing && !previewError;

  // ───────────── Venta terminada ─────────────
  if (done) {
    const owes = Number(done.balance) > 0;
    return (
      <Card>
        <div className="grid place-items-center gap-4 py-8 text-center" data-testid="sale-done">
          <span className="grid size-14 place-items-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-7" aria-hidden /></span>
          <div>
            <h2 className="text-[20px] font-[650] text-ink">Venta {done.code} registrada</h2>
            <p className="mt-1 text-[13px] text-ink-2">{done.customer?.name ?? "Consumidor final"} · {done.withTax ? "Con impuestos (CF)" : "Sin impuestos (SF)"}</p>
          </div>
          <dl className="grid grid-cols-3 gap-8 text-[13px]">
            <div><dt className="text-ink-2">Total</dt><dd className="text-[18px] font-semibold tabular-nums text-ink">Bs {fmt(done.total)}</dd></div>
            <div><dt className="text-ink-2">Cobrado</dt><dd className="text-[18px] font-semibold tabular-nums text-success">Bs {fmt(done.paidTotal)}</dd></div>
            <div><dt className="text-ink-2">Saldo</dt><dd className={`text-[18px] font-semibold tabular-nums ${owes ? "text-danger" : "text-ink"}`}>Bs {fmt(done.balance)}</dd></div>
          </dl>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <PrintButton docType="SALE_RECEIPT" id={done.id} label="Imprimir recibo" />
            <button className={btnSecondary} onClick={() => setViewing(true)}>Ver, cobrar o anular</button>
            <button className={btnPrimary} onClick={reset} data-testid="new-sale"><Plus className="size-4" aria-hidden />Nueva venta</button>
          </div>
        </div>
        <Modal open={viewing} onClose={() => setViewing(false)} title="Venta" size="lg">
          {viewing && <SaleView key={done.id} id={done.id} can={can} onChanged={async () => { const r = await bff<SaleDetail>(`/bff/api/sales/orders/${done.id}`, "GET"); if (r.ok) setDone(r.data); }} onClose={() => setViewing(false)} />}
        </Modal>
      </Card>
    );
  }

  return (
    <div className="grid gap-4" data-testid="pos">
      <Card>
        <div className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_190px_150px_auto]">
            <label className={lab}>Cliente<CustomerPicker value={customer} onPick={pickCustomer} canCreate={can.createCustomer} /></label>
            <label className={lab}>Sucursal
              <select aria-label="Sucursal" className={field} value={branchId} onChange={(e) => { touch(); setBranchId(e.target.value); }} disabled={!!sale}>
                {branchList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className={lab}>Fecha<input aria-label="Fecha" type="date" className={`${field} bg-surface-muted`} value={today} readOnly /></label>
            <div className={lab}>Impuestos
              <div role="radiogroup" aria-label="Tipo de impuestos" className="flex h-10 overflow-hidden rounded-lg border border-brand">
                {([[true, "CON IMPUESTOS", "CF"], [false, "SIN IMPUESTOS", "SF"]] as const).map(([v, l, k]) => (
                  <button key={k} type="button" role="radio" aria-checked={withTax === v} data-testid={`tax-${k}`} onClick={() => { touch(); setWithTax(v); }}
                    className={`px-3.5 text-[12px] font-semibold tracking-wide ${withTax === v ? "bg-brand text-white" : "bg-surface text-ink-2 hover:bg-surface-muted"}`}>{l} <span className="opacity-80">({k})</span></button>
                ))}
              </div>
            </div>
          </div>
          {whOptions.length > 1 && (
            <label className={`${lab} max-w-xs`}>Almacén
              <select aria-label="Almacén" className={field} value={warehouseId} onChange={(e) => { touch(); setWarehouseId(e.target.value); }} disabled={!!sale}>{whOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            </label>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[170px_1fr_170px_170px]">
            <label className={lab}>NIT / CI<input aria-label="NIT o CI del comprobante" className={field} value={billingTaxId} onChange={(e) => { touch(); setBillingTaxId(e.target.value); }} /></label>
            <label className={lab}>Nombre para el comprobante<input aria-label="Nombre para el comprobante" className={field} value={billingName} onChange={(e) => { touch(); setBillingName(e.target.value); }} placeholder="Razón social o nombre" /></label>
            <label className={lab}>Tipo de venta
              <select aria-label="Tipo de venta" className={field} value={saleType} onChange={(e) => { touch(); setSaleType(e.target.value as "CASH" | "CREDIT"); }}>
                <option value="CASH">Contado</option><option value="CREDIT" disabled={!customer}>Crédito{customer ? "" : " (elige cliente)"}</option>
              </select>
            </label>
            <label className={lab}>Fecha límite de pago<input aria-label="Fecha límite de pago" type="date" min={today} className={field} value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={saleType !== "CREDIT"} /></label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_160px_1fr_1.2fr]">
            <label className={lab}>Nombre del cliente<input aria-label="Nombre del cliente" className={`${field} bg-surface-muted`} value={customer?.name ?? ""} readOnly placeholder="Consumidor final" /></label>
            <label className={lab}>Celular<input aria-label="Celular" className={`${field} bg-surface-muted`} value={customer?.phone ?? ""} readOnly /></label>
            <label className={lab}>Correo electrónico<input aria-label="Correo electrónico" className={`${field} bg-surface-muted`} value={customer?.email ?? ""} readOnly /></label>
            <label className={lab}>Glosa<input aria-label="Glosa" className={field} value={note} onChange={(e) => { touch(); setNote(e.target.value); }} maxLength={500} /></label>
          </div>
          {customer && (Number(customer.outstanding) > 0 || customer.defaultPriceList) && (
            <p className="flex flex-wrap gap-x-4 text-[12px]" data-testid="customer-hints">
              {Number(customer.outstanding) > 0 && <span className="font-medium text-danger">Este cliente debe Bs {fmt(customer.outstanding)}{customer.creditLimit ? ` (límite ${fmt(customer.creditLimit)})` : ""}</span>}
              {customer.defaultPriceList && <span className="text-brand">Precios de la lista «{customer.defaultPriceList.name}»</span>}
            </p>
          )}

          <div className="border-t border-line pt-4">
            <ProductSearch warehouseId={warehouseId} customerId={customer?.id ?? null} onAdd={addProduct} disabled={!warehouseId} />
          </div>
        </div>
      </Card>

      <Card className="!p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-testid="pos-lines">
            <thead>
              <tr className="h-[40px] bg-surface-muted text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                <th className="w-10 px-4">#</th><th className="px-3">Código</th><th className="px-3">Descripción</th><th className="px-3">Precios</th>
                <th className="px-3 text-center">Cantidad</th>{can.discount && <th className="px-3 text-center">Desc. %</th>}<th className="px-3 text-right">Precio (Bs)</th><th className="px-3 text-right">Subtotal</th><th className="w-12 px-3" />
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {lines.length === 0 && <tr><td colSpan={can.discount ? 9 : 8} className="px-4 py-12 text-center text-ink-3"><ShoppingCart className="mx-auto mb-2 size-8" aria-hidden />Busca un producto arriba para agregarlo a la venta.</td></tr>}
              {lines.map((l, i) => {
                const pr = priceOf(l.productId);
                const q = parseNum(l.qty) ?? 0;
                const tier = tierFor(l.info?.price ?? null, q);
                const short = l.kind === "GOODS" && l.info?.stockHere != null && q > Number(l.info.stockHere);
                return (
                  <tr key={l.key} className="border-b border-line-strong/40 align-top" data-testid={`line-${l.code}`}>
                    <td className="px-4 py-3 text-ink-3">{i + 1}</td>
                    <td className="px-3 py-3 font-mono text-xs">{l.code}</td>
                    <td className="px-3 py-3 font-sans">
                      <span className="font-semibold text-ink">{l.name}</span>
                      {l.category && <span className="block text-xs text-ink-2">{l.category}</span>}
                      {l.info && <span className={`block text-xs font-medium ${short ? "text-danger" : "text-success"}`}>{short ? `Stock insuficiente: ${stockText(l.info)}` : `Stock: ${stockText(l.info)}`}</span>}
                    </td>
                    <td className="px-3 py-3 font-sans text-xs">
                      {tier && l.info?.price ? <span className="font-semibold text-success" data-testid={`tier-${l.code}`}>Cant. {tierRange(tier)}: Bs {fmt(tier.price)}</span> : pr ? <span className="text-ink-2">Lista {pr.priceListCode}</span> : null}
                      {l.info?.price && <span className="block text-[11px] text-ink-3">⚡ Precio automático según cantidad</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="mx-auto flex w-[128px] items-center justify-center gap-1">
                        <button type="button" className="rounded-md border border-line-strong p-1.5 text-ink-2 hover:bg-surface-muted" onClick={() => step(l, -1)} aria-label={`Menos ${l.code}`}><Minus className="size-3.5" /></button>
                        <input aria-label={`Cantidad ${l.code}`} inputMode="decimal" className="h-8 w-16 rounded-md border border-line-strong bg-surface px-1 text-center text-[13px] focus:border-brand focus:outline-none" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} onFocus={(e) => e.currentTarget.select()} />
                        <button type="button" className="rounded-md border border-line-strong p-1.5 text-ink-2 hover:bg-surface-muted" onClick={() => step(l, 1)} aria-label={`Más ${l.code}`}><Plus className="size-3.5" /></button>
                      </div>
                      <span className="mt-0.5 block text-center text-[11px] text-ink-3">{l.unit}</span>
                    </td>
                    {can.discount && <td className="px-3 py-3 text-center"><input aria-label={`Descuento ${l.code}`} inputMode="decimal" className="h-8 w-14 rounded-md border border-line-strong bg-surface px-1 text-center text-[13px] focus:border-brand focus:outline-none" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} onFocus={(e) => e.currentTarget.select()} /></td>}
                    <td className="px-3 py-3 text-right" data-testid={`price-${l.code}`}>{pr ? fmt(pr.unitPrice) : "—"}</td>
                    <td className="px-3 py-3 text-right font-semibold text-ink" data-testid={`subtotal-${l.code}`}>{pr ? fmt(pr.totalAmount) : "—"}</td>
                    <td className="px-3 py-3 text-right"><button type="button" className="rounded-md bg-danger p-1.5 text-white hover:opacity-90" onClick={() => { touch(); setLines((c) => c.filter((x) => x.key !== l.key)); }} aria-label={`Quitar ${l.code}`}><X className="size-3.5" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-4">
          <div className="text-[13px] text-ink-2" data-testid="pos-status">
            {sale ? <span className="flex items-center gap-2"><StatusBadge tone="neutral">Borrador guardado</StatusBadge><span>Puedes seguir editándola o cobrarla.</span></span> : "Aún no se ha guardado."}
            {saleType === "CREDIT" && <span className="ml-3"><StatusBadge tone="warning">A crédito</StatusBadge></span>}
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-right text-[12px] text-ink-2" data-testid="pos-totals">
              {preview && withTax && Number(preview.totals.tax) > 0 && <><dt>Neto</dt><dd className="tabular-nums">{fmt(preview.totals.net)}</dd><dt>Impuestos</dt><dd className="tabular-nums">{fmt(preview.totals.tax)}</dd></>}
              {preview && Number(preview.totals.discount) > 0 && <><dt>Descuento</dt><dd className="tabular-nums">−{fmt(preview.totals.discount)}</dd></>}
            </dl>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">Total {previewing && <Loader2 className="inline size-3 animate-spin" aria-hidden />}</p>
              <p className="text-[28px] font-[650] leading-none tabular-nums text-brand" data-testid="pos-total">Bs {fmt(total)}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <div className="flex items-center gap-3 text-[12px]" data-testid="cashbox-chip">
            {branchSessions.length > 0
              ? <span className="text-ink-2">Caja: <strong className="text-ink">{branchSessions.map((s) => s.register.name).join(", ")}</strong> abierta</span>
              : <span className="text-warning">Sin caja abierta · <Link href="/cajas" className="font-semibold underline">Abrir caja</Link></span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sale && <button className={`${btnSecondary} text-danger`} onClick={discard} disabled={saving}><Trash2 className="size-4" aria-hidden />Descartar</button>}
            {lines.length > 0 && !sale && <button className={btnSecondary} onClick={reset}>Limpiar</button>}
            <button className={btnSecondary} onClick={saveDraft} disabled={saving || lines.length === 0} data-testid="save-draft">{saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}Guardar</button>
            {canCharge && <button className={btnPrimary} onClick={() => { const p = problem(); if (p) return setMsg({ ok: false, text: p }); setPayError(null); setPaying(true); }} disabled={!canProcess} data-testid="process-sale"><ShoppingCart className="size-4" aria-hidden />Procesar venta</button>}
          </div>
        </div>
      </Card>

      {msg && <p role={msg.ok ? "status" : "alert"} data-testid="pos-msg" className={`rounded-lg px-4 py-2.5 text-[13px] ${msg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{msg.text}</p>}
      {previewError && <p role="alert" data-testid="preview-error" className="rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger">{previewError}</p>}
      <p className="rounded-lg bg-info-soft px-4 py-2.5 text-[12px] text-info">
        <strong>Nota:</strong> el precio de cada producto se elige solo según su cantidad y las escalas de su lista. {canCharge ? "«Guardar» deja la venta como borrador para editarla luego; «Procesar venta» la cobra al momento con una o varias formas de pago y descuenta el stock." : "«Guardar» deja la venta pendiente de cobro: el cajero la cobra desde «Ventas pendientes» y recién entonces se descuenta el stock."}
        Con impuestos (CF) se aplican los tributos de cada producto; sin impuestos (SF) se cobra el precio sin tributos.
      </p>

      <Modal open={paying} onClose={() => !payBusy && setPaying(false)} title="Cobrar la venta" size="lg">
        {paying && <PaymentModal total={total} hasCustomer={!!customer} isCredit={saleType === "CREDIT"} dueDate={dueDate} sessions={branchSessions} onConfirm={confirmSale} onCancel={() => setPaying(false)} busy={payBusy} error={payError} />}
      </Modal>
    </div>
  );
}
