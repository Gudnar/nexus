import { Prisma } from "@erp/db";

type Dec = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const QTY_DECIMALS = 6;
export const COST_DECIMALS = 6;
export const round = (v: Dec, places = COST_DECIMALS) => v.toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);

export type ValuationMethod = "FIFO" | "LIFO" | "AVERAGE";

/** Una capa de costo: el saldo de un lote en un almacén, con el costo de adquisición del lote. */
export interface Layer {
  lotId: string;
  available: Dec;
  unitCost: Dec;
  receivedAt: Date;
}

export interface IssuePart {
  lotId: string;
  quantity: Dec; // positiva
  unitCost: Dec;
  totalCost: Dec; // positivo
}

export interface IssuePlan {
  parts: IssuePart[];
  /** Cantidad pedida que no se pudo cubrir con las capas disponibles. */
  shortfall: Dec;
}

/**
 * Orden de consumo de las capas (ADR-004): FIFO y promedio consumen primero lo más antiguo (el
 * promedio solo decide el COSTO, el lote físico se asigna igual por trazabilidad); LIFO, lo más nuevo.
 */
export function orderLayers(method: ValuationMethod, layers: Layer[]): Layer[] {
  const sign = method === "LIFO" ? -1 : 1;
  return [...layers].sort((a, b) => sign * (a.receivedAt.getTime() - b.receivedAt.getTime()) || sign * a.lotId.localeCompare(b.lotId));
}

/**
 * Reparte una salida entre lotes y le pone costo.
 *  - FIFO/LIFO: cada parte cuesta lo que costó su lote.
 *  - AVERAGE: todas las partes cuestan el promedio ponderado del almacén (valor / cantidad). Si la salida
 *    vacía el almacén, el costo total es exactamente el valor restante (sin residuos de redondeo).
 */
export function planIssue(
  method: ValuationMethod,
  layers: Layer[],
  quantity: Prisma.Decimal.Value,
  average?: { quantity: Dec; value: Dec },
): IssuePlan {
  let left = D(quantity);
  const parts: IssuePart[] = [];
  const avgCost = average && average.quantity.gt(0) ? round(average.value.div(average.quantity)) : D(0);

  for (const layer of orderLayers(method, layers)) {
    if (left.lte(0)) break;
    if (layer.available.lte(0)) continue;
    const take = Prisma.Decimal.min(left, layer.available);
    const unitCost = method === "AVERAGE" ? avgCost : layer.unitCost;
    parts.push({ lotId: layer.lotId, quantity: take, unitCost, totalCost: round(take.mul(unitCost)) });
    left = left.sub(take);
  }

  if (method === "AVERAGE" && average && parts.length) {
    const taken = parts.reduce((s, p) => s.add(p.quantity), D(0));
    if (left.lte(0) && taken.eq(average.quantity)) {
      // Salida total: el valor remanente sale completo (el último tramo absorbe el redondeo).
      const sum = parts.reduce((s, p) => s.add(p.totalCost), D(0));
      const last = parts[parts.length - 1]!;
      last.totalCost = round(last.totalCost.add(average.value.sub(sum)));
    }
  }
  return { parts, shortfall: left.gt(0) ? left : D(0) };
}

/** Valor de las capas: lo que valdría el inventario si cada lote se valuara a su costo de adquisición. */
export function layersValue(layers: Layer[]): Dec {
  return round(layers.reduce((s, l) => s.add(l.available.mul(l.unitCost)), D(0)));
}

/** Cantidad con más decimales de los que admite la unidad base del producto. */
export function exceedsDecimals(quantity: Prisma.Decimal.Value, decimals: number): boolean {
  const q = D(quantity);
  return !q.toDecimalPlaces(decimals).eq(q);
}
