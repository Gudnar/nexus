import { Prisma } from "@erp/db";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
type Dec = Prisma.Decimal;

/**
 * Precios por tramos (plan §8.2-8.3).
 *
 * Un tramo cubre [min, max): el máximo es EXCLUSIVO y es igual al mínimo del tramo siguiente
 * (sin huecos ni solapes). El último tramo no tiene máximo. El primer mínimo es la cantidad
 * mínima vendible con la lista.
 *
 *  - TIER_THRESHOLD: al alcanzar un tramo, TODAS las unidades se cobran al precio de ese tramo.
 *  - PROGRESSIVE: la unidad número n se cobra al precio del tramo que la contiene
 *    (min <= n < max). Con cantidades fraccionarias, la fracción final se cobra al precio de
 *    la unidad siguiente (n + 1).
 */

export interface TierInput {
  minQuantity: Prisma.Decimal.Value;
  maxQuantity?: Prisma.Decimal.Value | null;
  unitPrice: Prisma.Decimal.Value;
}

export interface Tier {
  min: Dec;
  max: Dec | null;
  price: Dec;
}

export const MAX_TIERS = 20;
const DECIMALS = 4;

export function normalizeTiers(input: TierInput[]): Tier[] {
  return input
    .map((t) => ({ min: D(t.minQuantity), max: t.maxQuantity == null ? null : D(t.maxQuantity), price: D(t.unitPrice) }))
    .sort((a, b) => a.min.comparedTo(b.min));
}

/** Mensajes de error (vacío = válido). */
export function validateTiers(input: TierInput[]): string[] {
  const errors: string[] = [];
  if (input.length === 0) return ["Define al menos un tramo."];
  if (input.length > MAX_TIERS) return [`Máximo ${MAX_TIERS} tramos.`];
  let tiers: Tier[];
  try {
    tiers = normalizeTiers(input);
  } catch {
    return ["Hay valores que no son números."];
  }
  const tooPrecise = (d: Dec) => d.decimalPlaces() > DECIMALS;
  tiers.forEach((t, i) => {
    const n = i + 1;
    if (!t.min.isFinite() || !t.price.isFinite() || (t.max && !t.max.isFinite())) errors.push(`Tramo ${n}: valores no válidos.`);
    if (t.min.lte(0)) errors.push(`Tramo ${n}: la cantidad mínima debe ser mayor que cero.`);
    if (t.price.lt(0)) errors.push(`Tramo ${n}: el precio no puede ser negativo.`);
    if (tooPrecise(t.min) || tooPrecise(t.price) || (t.max && tooPrecise(t.max))) errors.push(`Tramo ${n}: máximo ${DECIMALS} decimales.`);
    if (t.max && t.max.lte(t.min)) errors.push(`Tramo ${n}: el máximo debe ser mayor que el mínimo.`);
    const next = tiers[i + 1];
    if (next) {
      if (!t.max) errors.push(`Tramo ${n}: solo el último tramo puede quedar abierto.`);
      else if (!t.max.equals(next.min)) errors.push(`Tramo ${n}: el máximo (${t.max}) debe coincidir con el mínimo del siguiente (${next.min}); no puede haber huecos ni solapes.`);
    } else if (t.max) {
      errors.push(`Tramo ${n}: el último tramo debe quedar abierto (sin máximo).`);
    }
  });
  const mins = tiers.map((t) => t.min.toString());
  if (new Set(mins).size !== mins.length) errors.push("Hay dos tramos con el mismo mínimo.");
  return errors;
}

export interface PricePart {
  /** Mínimo del tramo aplicado */
  tierMin: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface PriceResult {
  /** Total de la línea SIN redondear. */
  total: Dec;
  parts: PricePart[];
}

export class NoTierError extends Error {
  constructor(readonly minimum: string) {
    super(`La cantidad es menor que la mínima de esta lista (${minimum}).`);
  }
}

const tierAt = (tiers: Tier[], x: Dec): Tier => {
  for (let i = tiers.length - 1; i >= 0; i--) if (x.gte(tiers[i]!.min)) return tiers[i]!;
  return tiers[0]!; // por debajo del primer mínimo (solo en progresivo: las primeras unidades)
};

export function priceQuantity(tiersInput: TierInput[], quantity: Prisma.Decimal.Value, mode: "TIER_THRESHOLD" | "PROGRESSIVE"): PriceResult {
  const tiers = normalizeTiers(tiersInput);
  const q = D(quantity);
  if (q.lte(0)) throw new RangeError("La cantidad debe ser mayor que cero.");
  if (q.lt(tiers[0]!.min)) throw new NoTierError(tiers[0]!.min.toString());

  if (mode === "TIER_THRESHOLD") {
    const t = tierAt(tiers, q);
    return { total: t.price.mul(q), parts: [{ tierMin: t.min.toString(), quantity: q.toString(), unitPrice: t.price.toString(), amount: t.price.mul(q).toString() }] };
  }

  const n = q.floor();
  const frac = q.minus(n);
  const parts: PricePart[] = [];
  let total = D(0);
  tiers.forEach((t, i) => {
    const first = i === 0;
    const idxLo = first ? D(1) : t.min.ceil();
    const idxHi = t.max ? t.max.ceil().minus(1) : n; // mayor índice entero < max
    const hi = Prisma.Decimal.min(idxHi, n);
    const count = Prisma.Decimal.max(0, hi.minus(idxLo).plus(1));
    if (count.gt(0)) {
      const amount = t.price.mul(count);
      total = total.plus(amount);
      parts.push({ tierMin: t.min.toString(), quantity: count.toString(), unitPrice: t.price.toString(), amount: amount.toString() });
    }
  });
  if (frac.gt(0)) {
    const t = tierAt(tiers, n.plus(1));
    const amount = t.price.mul(frac);
    total = total.plus(amount);
    parts.push({ tierMin: t.min.toString(), quantity: frac.toString(), unitPrice: t.price.toString(), amount: amount.toString() });
  }
  return { total, parts };
}
