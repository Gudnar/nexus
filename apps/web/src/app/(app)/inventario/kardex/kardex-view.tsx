"use client";

import type { KardexList } from "@erp/contracts";
import { Loader2, Undo2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, money, num } from "@/components/field";
import { Modal } from "@/components/modal";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { btnPrimary, btnSecondary, Card, EmptyState, inputCls, StatusBadge } from "@/components/ui";
import { bff, errorText } from "@/lib/client-api";
import { History } from "lucide-react";

const TYPE: Record<string, [string, "success" | "danger" | "info" | "neutral"]> = {
  RECEIPT: ["Recepción", "success"], ISSUE: ["Salida", "danger"], ADJUSTMENT_IN: ["Ajuste (+)", "success"], ADJUSTMENT_OUT: ["Ajuste (−)", "danger"],
  TRANSFER_IN: ["Transferencia (+)", "info"], TRANSFER_OUT: ["Transferencia (−)", "info"], REVALUATION: ["Revaluación", "neutral"],
};
const NOT_REVERSIBLE = new Set(["REVALUATION", "TRANSFER_IN", "TRANSFER_OUT"]);

interface Props {
  kardex: KardexList | null;
  product: { id: string; code: string; name: string; unit: string } | null;
  warehouses: { id: string; code: string; name: string }[];
  filters: { warehouseId: string; from: string; to: string };
  canReverse: boolean;
  hasCursor: boolean;
}

export function KardexView({ kardex, product, warehouses, filters, canReverse, hasCursor }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [picked, setPicked] = useState<PickedProduct | null>(null);
  const [reversing, setReversing] = useState<KardexList["items"][number] | null>(null);
  const compact = inputCls.replace("w-full ", "");

  function go(productId: string, f: FormData | null) {
    const qs = new URLSearchParams({ productId });
    for (const k of ["warehouseId", "from", "to"]) { const v = String(f?.get(k) ?? "").trim(); if (v) qs.set(k, v); }
    router.push(`${pathname}?${qs}`);
  }
  const withCursor = (c: string) => { const p = new URLSearchParams(params.toString()); p.set("cursor", c); return `${pathname}?${p}`; };
  const reversedIds = new Set((kardex?.items ?? []).map((m) => m.reversalOfId).filter(Boolean));

  return (
    <>
      <Card className="mb-6">
        <form className="grid gap-4 md:grid-cols-[1fr_auto_auto_auto_auto] md:items-end" onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const id = product?.id ?? picked?.id;
          if (id) go(id, new FormData(e.currentTarget));
        }}>
          <Field label="Producto">
            {product ? (
              <div className="flex items-center justify-between rounded-lg border border-line-strong bg-surface-muted px-3 py-2 text-[13px]">
                <span className="text-ink">{product.name} <span className="text-ink-3">· {product.code}</span></span>
                <Link href={pathname} className="text-brand hover:underline">Cambiar</Link>
              </div>
            ) : <ProductPicker value={picked} onChange={setPicked} goodsOnly autoFocus />}
          </Field>
          <Field label="Almacén">
            <select name="warehouseId" defaultValue={filters.warehouseId} className={`${compact} w-[170px]`}>
              <option value="">Todos</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
            </select>
          </Field>
          <Field label="Desde"><input type="date" name="from" defaultValue={filters.from} className={compact} /></Field>
          <Field label="Hasta"><input type="date" name="to" defaultValue={filters.to} className={compact} /></Field>
          <button className={`${btnPrimary} h-10`} disabled={!product && !picked}>Ver kardex</button>
        </form>
      </Card>

      {!kardex ? (
        <Card><EmptyState icon={History} title="Elige un producto" description="Verás cada entrada, salida y ajuste con el saldo resultante." /></Card>
      ) : kardex.items.length === 0 ? (
        <Card><EmptyState icon={History} title="Sin movimientos" description="No hay movimientos con esos filtros." /></Card>
      ) : (
        <Card>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="h-[42px] border-y border-line text-ink-2">
                  <th className="px-5 font-medium">Fecha</th><th className="px-3 font-medium">Movimiento</th><th className="px-3 font-medium">Almacén</th><th className="px-3 font-medium">Lote</th>
                  <th className="px-3 text-right font-medium">Cantidad</th><th className="px-3 text-right font-medium">Costo unit.</th><th className="px-3 text-right font-medium">Importe</th>
                  <th className="px-3 text-right font-medium">Saldo</th><th className="px-3 font-medium">Motivo</th><th className="px-5" />
                </tr>
              </thead>
              <tbody>
                {kardex.items.map((m) => {
                  const [label, tone] = TYPE[m.type] ?? [m.type, "neutral" as const];
                  const reversible = canReverse && !NOT_REVERSIBLE.has(m.type) && !m.reversalOfId && !reversedIds.has(m.id);
                  return (
                    <tr key={m.id} className="h-[46px] border-b border-line-strong/40 text-body hover:bg-surface-muted">
                      <td className="px-5 tabular-nums" suppressHydrationWarning>{new Date(m.occurredAt).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td className="px-3"><StatusBadge tone={tone}>{label}</StatusBadge>{m.reversalOfId && <span className="ml-1.5 text-xs text-ink-3">reversa</span>}{reversedIds.has(m.id) && <span className="ml-1.5 text-xs text-ink-3">revertido</span>}</td>
                      <td className="px-3">{m.warehouse.code}</td><td className="px-3 text-ink-2">{m.lot?.code ?? "—"}</td>
                      <td className={`px-3 text-right tabular-nums ${Number(m.quantity) < 0 ? "text-danger" : ""}`}>{Number(m.quantity) > 0 ? "+" : ""}{num(m.quantity)}</td>
                      <td className="px-3 text-right tabular-nums">{m.type === "REVALUATION" ? "—" : money(m.unitCost, 4)}</td>
                      <td className="px-3 text-right tabular-nums">{money(m.totalCost)}</td>
                      <td className="px-3 text-right font-medium tabular-nums text-ink">{num(m.balanceAfter)}</td>
                      <td className="max-w-[220px] truncate px-3 text-ink-2" title={m.note ?? ""}>{m.note ?? m.reasonCode ?? ""}</td>
                      <td className="px-5 text-right">{reversible && <button className={`${btnSecondary} h-8 px-2.5`} onClick={() => setReversing(m)} aria-label="Revertir movimiento"><Undo2 className="size-3.5" aria-hidden /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-4 text-[13px]">
            {hasCursor && <Link href={`${pathname}?${(() => { const p = new URLSearchParams(params.toString()); p.delete("cursor"); return p; })()}`} className="font-medium text-brand hover:underline">← Más recientes</Link>}
            {kardex.nextCursor && <Link href={withCursor(kardex.nextCursor)} className="font-medium text-brand hover:underline">Más antiguos →</Link>}
          </div>
        </Card>
      )}

      <Modal open={reversing !== null} onClose={() => setReversing(null)} title="Revertir movimiento">
        {reversing && <ReverseForm movement={reversing} onDone={() => { setReversing(null); router.refresh(); }} onCancel={() => setReversing(null)} />}
      </Modal>
    </>
  );
}

function ReverseForm({ movement, onDone, onCancel }: { movement: KardexList["items"][number]; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await bff(`/bff/api/inventory/movements/${movement.id}/reverse`, "POST", { reason });
    setBusy(false);
    if (r.ok) return onDone();
    setError(errorText(r));
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-[13px] text-ink-2">
        Se registrará un movimiento inverso de {num(Math.abs(Number(movement.quantity)))} unidad(es) al costo original ({money(movement.unitCost, 4)}). El movimiento original no se borra.
      </p>
      <Field label="Motivo"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} autoFocus /></Field>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancelar</button>
        <button className={btnPrimary} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Revertir</button>
      </div>
    </form>
  );
}
