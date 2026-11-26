import type { PosProductRow } from "@erp/contracts";

/** Número escrito por una persona («8,5» o «8.5»); NaN si no es válido y null si está vacío. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export const fmt = (v: string | number, d = 2) => Number(v).toLocaleString("es-BO", { minimumFractionDigits: d, maximumFractionDigits: d });
export const qtyFmt = (v: string | number) => Number(v).toLocaleString("es-BO", { maximumFractionDigits: 4 });

type Tier = NonNullable<PosProductRow["price"]>["tiers"][number];

/** Rango de un tramo para mostrarlo: «1-5» (el máximo guardado es exclusivo) o «13+» si es el último. */
export function tierRange(t: Tier): string {
  const min = Number(t.min);
  if (t.max === null) return `${qtyFmt(min)}+`;
  const max = Number(t.max);
  return Number.isInteger(min) && Number.isInteger(max) ? `${qtyFmt(min)}-${qtyFmt(max - 1)}` : `${qtyFmt(min)}–<${qtyFmt(max)}`;
}

/** Tramo que le toca a una cantidad (para mostrarlo en la línea antes de que el servidor confirme el cálculo). */
export function tierFor(price: PosProductRow["price"], qty: number): Tier | null {
  if (!price) return null;
  let hit: Tier | null = null;
  for (const t of price.tiers) if (qty >= Number(t.min)) hit = t;
  return hit;
}

/** Texto de existencias: «135 aquí · 151 en total». */
export function stockText(p: Pick<PosProductRow, "stockHere" | "stockTotal" | "kind">): string {
  if (p.kind === "SERVICE") return "Servicio";
  return `${qtyFmt(p.stockHere ?? 0)} aquí · ${qtyFmt(p.stockTotal ?? 0)} en total`;
}

export const METHODS: Record<string, string> = { CASH: "Efectivo", QR: "QR", TRANSFER: "Transferencia", CARD: "Tarjeta", CHEQUE: "Cheque" };
