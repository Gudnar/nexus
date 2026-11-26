"use client";

import type { ProductSummary, QuoteResponse } from "@erp/contracts";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { btnPrimary, Card, inputCls } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";

const RESOLVED = { EXPLICIT: "Lista elegida", BRANCH: "Lista de la sucursal", CHANNEL: "Lista del canal", GENERAL: "Lista general" } as const;
const MODE = { WITH_TAX: "con impuestos incluidos", WITHOUT_TAX: "sin impuestos" } as const;

export function Quoter({ lists }: { lists: { id: string; name: string; code: string }[] }) {
  const [product, setProduct] = useState<{ id: string; label: string } | null>(null);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<ProductSummary[]>([]);
  const [f, setF] = useState({ quantity: "1", priceListId: "", channel: "", at: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResponse | null>(null);

  useEffect(() => {
    if (product || search.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const r = await bff<{ items: ProductSummary[] }>(`/bff/api/catalog/products?${new URLSearchParams({ q: search.trim(), status: "ACTIVE", limit: "8" })}`, "GET");
      if (r.ok) setFound(r.data.items);
    }, 250);
    return () => clearTimeout(t);
  }, [search, product]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!product) return setError("Elige un producto.");
    setError(null);
    setResult(null);
    setBusy(true);
    const r = await bff<QuoteResponse>("/bff/api/pricing/quote", "POST", {
      productId: product.id, quantity: Number(f.quantity),
      ...(f.priceListId ? { priceListId: f.priceListId } : {}), ...(f.channel ? { channel: f.channel } : {}), ...(f.at ? { at: f.at } : {}),
    });
    setBusy(false);
    if (r.ok) setResult(r.data);
    else if (r.status === 404 || r.status === 422) setError((r.data as { detail?: string }).detail ?? "No hay un precio vigente para ese producto.");
    else setError(errorText(r));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <Card className="h-fit">
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Producto">
            {product ? (
              <div className="flex items-center justify-between rounded-lg border border-line-strong bg-surface-muted px-3 py-2 text-[13px]">
                <span className="text-ink">{product.label}</span>
                <button type="button" className="text-brand hover:underline" onClick={() => { setProduct(null); setSearch(""); setResult(null); }}>Cambiar</button>
              </div>
            ) : (
              <div className="relative">
                <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código o nombre…" />
                {found.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface shadow-popover">
                    {found.map((p) => (
                      <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-[13px] hover:bg-surface-muted" onClick={() => setProduct({ id: p.id, label: `${p.name} (${p.code})` })}>{p.name} <span className="text-ink-3">· {p.code}</span></button></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          <Field label="Cantidad"><input type="number" step="any" min="0" className={inputCls} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></Field>
          <Field label="Lista de precios" hint="Automática: se elige por sucursal, canal o la general.">
            <select className={inputCls} value={f.priceListId} onChange={(e) => setF({ ...f, priceListId: e.target.value })}>
              <option value="">Automática</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
            </select>
          </Field>
          <Field label="Canal de venta">
            <select className={inputCls} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              <option value="">Cualquiera</option><option value="POS">Punto de venta</option><option value="ECOMMERCE">Tienda online</option><option value="MESSAGING">Mensajería</option>
            </select>
          </Field>
          <Field label="Fecha de vigencia" hint="Vacío = hoy."><input type="date" className={inputCls} value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Calcular</button>
        </form>
      </Card>

      <Card className="[&]:block">
        {!result ? (
          <p className="py-10 text-center text-ink-2">Elige un producto y una cantidad para ver el cálculo.</p>
        ) : (
          <div className="grid gap-5" data-testid="quote-result" aria-live="polite">
            <div>
              <h2 className="text-base font-semibold text-ink">{result.product.name} <span className="font-normal text-ink-3">· {result.product.code}</span></h2>
              <p className="mt-0.5 text-xs text-ink-2">
                {RESOLVED[result.resolvedBy]}: {result.priceList.name} ({result.priceList.code}) · precios {MODE[result.priceList.priceMode]} · {result.priceList.currency}
              </p>
            </div>
            <table className="w-full text-left text-[13px]">
              <thead><tr className="h-9 border-y border-line text-ink-2"><th className="font-medium">Escala desde</th><th className="font-medium">Cantidad</th><th className="text-right font-medium">Precio unit.</th><th className="text-right font-medium">Importe</th></tr></thead>
              <tbody className="tabular-nums">
                {result.breakdown.map((b) => (
                  <tr key={b.tierMin} className="h-9 border-b border-line-strong/40"><td>{num(b.tierMin)}</td><td>{num(b.quantity)}</td><td className="text-right">{money(b.unitPrice, 4)}</td><td className="text-right">{money(b.amount)}</td></tr>
                ))}
              </tbody>
            </table>
            <dl className="ml-auto grid w-full max-w-[360px] grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[13px] tabular-nums">
              <dt className="text-ink-2">Neto</dt><dd className="text-right" data-testid="quote-net">{money(result.tax.net)}</dd>
              {result.tax.taxes.map((t) => (
                <div key={t.code} className="contents">
                  <dt className="text-ink-2">{t.code} {t.exempt ? <span className="text-warning">(exento: {t.exemptionReason})</span> : `${num(t.rate, 6)} %`}</dt>
                  <dd className="text-right">{money(t.amount)}</dd>
                </div>
              ))}
              {result.tax.taxes.length === 0 && <><dt className="text-ink-3">Sin impuestos (el producto no tiene perfil fiscal)</dt><dd /></>}
              <dt className="border-t border-line pt-1.5 font-semibold text-ink">Total</dt><dd className="border-t border-line pt-1.5 text-right text-[15px] font-semibold text-ink" data-testid="quote-total">{money(result.tax.total)}</dd>
            </dl>
          </div>
        )}
      </Card>
    </div>
  );
}
