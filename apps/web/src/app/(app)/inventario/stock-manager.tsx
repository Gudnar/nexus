"use client";

import type { LotBalanceRow, StockList } from "@erp/contracts";
import { ChevronDown, ChevronRight, Layers, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useState, type FormEvent } from "react";
import { money, num } from "@/components/field";
import { btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff } from "@/lib/client-api";

interface Props {
  list: StockList;
  warehouses: { id: string; code: string; name: string }[];
  filters: { q: string; warehouseId: string };
  hasCursor: boolean;
}

export function StockManager({ list, warehouses, filters, hasCursor }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const [lots, setLots] = useState<LotBalanceRow[] | null>(null);
  const compact = inputCls.replace("w-full ", "");
  const filtered = !!(filters.q || filters.warehouseId);

  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const qs = new URLSearchParams();
    for (const k of ["q", "warehouseId"]) { const v = String(f.get(k) ?? "").trim(); if (v) qs.set(k, v); }
    router.push(`${pathname}${qs.size ? `?${qs}` : ""}`);
  }

  async function toggle(key: string, productId: string, warehouseId: string) {
    if (open === key) return setOpen(null);
    setOpen(key);
    setLots(null);
    const r = await bff<LotBalanceRow[]>(`/bff/api/inventory/stock/lots?${new URLSearchParams({ productId, warehouseId })}`, "GET");
    setLots(r.ok ? r.data : []);
  }

  const withCursor = (c: string) => { const p = new URLSearchParams(params.toString()); p.set("cursor", c); return `${pathname}?${p}`; };
  const totalValue = list.items.reduce((s, r) => s + Number(r.value), 0);

  return (
    <Card>
      <form onSubmit={apply} className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input name="q" defaultValue={filters.q} placeholder="Código o nombre" aria-label="Buscar" className={`${compact} w-[240px] pl-9`} />
        </div>
        <select name="warehouseId" defaultValue={filters.warehouseId} aria-label="Almacén" className={`${compact} w-[200px]`}>
          <option value="">Todos los almacenes</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
        </select>
        <button className={`${btnSecondary} h-10`}>Filtrar</button>
        {filtered && <Link href={pathname} className="text-[13px] text-brand hover:underline">Limpiar</Link>}
      </form>

      {list.items.length === 0 ? (
        <EmptyState icon={Layers} title={filtered ? "Sin resultados" : "Aún no hay existencias"} description={filtered ? "Prueba con otros filtros." : "Las existencias aparecen al recibir mercadería o registrar un ajuste."} />
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="h-[42px] border-y border-line text-ink-2">
                <th className="w-8 px-5" /><th className="px-3 font-medium">Producto</th><th className="px-3 font-medium">Almacén</th>
                <th className="px-3 text-right font-medium">Físico</th><th className="px-3 text-right font-medium">Reservado</th><th className="px-3 text-right font-medium">Disponible</th>
                <th className="px-3 text-right font-medium">Costo prom.</th><th className="px-5 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => {
                const key = `${r.productId}:${r.warehouse.id}`;
                return (
                  <Fragment key={key}>
                    <tr className="h-[48px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                      <td className="px-5">
                        <button onClick={() => toggle(key, r.productId, r.warehouse.id)} aria-expanded={open === key} aria-label={`Ver lotes de ${r.name}`} className="text-ink-2 hover:text-ink">
                          {open === key ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                        </button>
                      </td>
                      <td className="px-3"><span className="font-medium text-ink">{r.name}</span><span className="block text-xs text-ink-3">{r.code}</span></td>
                      <td className="px-3">{r.warehouse.code}</td>
                      <td className="px-3 text-right tabular-nums">{num(r.physicalQty)} <span className="text-ink-3">{r.unit}</span></td>
                      <td className="px-3 text-right tabular-nums">{num(r.reservedQty)}</td>
                      <td className="px-3 text-right font-medium tabular-nums text-ink">{num(r.availableQty)}</td>
                      <td className="px-3 text-right tabular-nums">{money(r.averageCost, 4)}</td>
                      <td className="px-5 text-right tabular-nums">{money(r.value)}</td>
                    </tr>
                    {open === key && (
                      <tr className="border-b border-line-strong/40 bg-surface-muted">
                        <td />
                        <td colSpan={7} className="px-3 py-3">
                          {lots === null ? <span className="text-ink-2">Cargando…</span> : (
                            <div className="grid gap-2">
                              <table className="w-full max-w-[760px] text-left text-xs">
                                <thead><tr className="text-ink-3"><th className="py-1 font-medium">Lote</th><th className="font-medium">Ingreso</th><th className="font-medium">Vence</th><th className="text-right font-medium">Costo</th><th className="text-right font-medium">Disponible</th><th /></tr></thead>
                                <tbody>
                                  {lots.map((l) => (
                                    <tr key={l.lotId} className="border-t border-line">
                                      <td className="py-1.5 font-medium text-ink">{l.lotCode}</td>
                                      <td>{new Date(l.receivedAt).toLocaleDateString("es-BO")}</td>
                                      <td>{l.expiresOn ?? "—"}</td>
                                      <td className="text-right tabular-nums">{money(l.unitCost, 4)}</td>
                                      <td className="text-right tabular-nums">{num(l.availableQty)}</td>
                                      <td className="pl-3">{l.status === "BLOCKED" && <StatusBadge tone="danger">Bloqueado</StatusBadge>}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <Link href={`/inventario/kardex?productId=${r.productId}&warehouseId=${r.warehouse.id}`} className="text-xs font-medium text-brand hover:underline">Ver kardex de este producto →</Link>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between text-[13px] text-ink-2">
        <span>{list.items.length} fila(s) · valor mostrado: <strong className="text-ink" data-testid="stock-total">{money(totalValue)}</strong></span>
        <span className="flex gap-4">
          {hasCursor && <Link href={pathname} className="font-medium text-brand hover:underline">← Inicio</Link>}
          {list.nextCursor && <Link href={withCursor(list.nextCursor)} className="font-medium text-brand hover:underline">Siguiente página →</Link>}
        </span>
      </div>
    </Card>
  );
}

