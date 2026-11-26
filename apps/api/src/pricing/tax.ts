import { Prisma } from "@erp/db";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
type Dec = Prisma.Decimal;

/**
 * Motor de cálculo de impuestos de una línea (ADR-002, capa 3). Separado del motor de precios:
 * el precio comercial ("con" o "sin" impuestos) solo indica cómo se interpreta el importe; los
 * tributos reales vienen de las reglas fiscales.
 *
 *  - WITH_TAX: el importe ya incluye los tributos → se desglosa la base:
 *        base = importe / (1 + Σ tasas / 100)
 *  - WITHOUT_TAX: el importe es la base → se calcula cada tributo sobre él.
 *
 * Todos los tributos de una línea se calculan sobre la MISMA base (sin tributos en cascada).
 * Redondeo mitad hacia arriba a `decimals` por componente; la diferencia por redondeo se absorbe
 * en el mayor tributo para que base + tributos == total exactamente (en WITH_TAX el total es el
 * importe dado: el desglose nunca lo altera).
 */

export interface TaxInput {
  code: string;
  /** Tasa en porcentaje (13 = 13 %). */
  rate: Prisma.Decimal.Value;
  exempt?: boolean;
  exemptionReason?: string | null;
}

export interface TaxLine {
  code: string;
  rate: string;
  base: string;
  amount: string;
  exempt: boolean;
  exemptionReason: string | null;
}

export interface LineTaxResult {
  priceMode: "WITH_TAX" | "WITHOUT_TAX";
  /** Base imponible (sin tributos) */
  net: string;
  taxes: TaxLine[];
  taxTotal: string;
  /** Total de la línea (con tributos) */
  total: string;
}

const round = (v: Dec, dp: number) => v.toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);

export function calculateLineTax(
  amount: Prisma.Decimal.Value, priceMode: "WITH_TAX" | "WITHOUT_TAX", taxes: TaxInput[], decimals: number,
): LineTaxResult {
  const given = round(D(amount), decimals);
  const active = taxes.filter((t) => !t.exempt).map((t) => ({ ...t, r: D(t.rate) }));
  const sumRate = active.reduce((s, t) => s.plus(t.r), D(0));

  let net: Dec;
  let amounts: Dec[];
  let total: Dec;

  if (priceMode === "WITH_TAX") {
    total = given;
    net = round(total.div(D(1).plus(sumRate.div(100))), decimals);
    amounts = active.map((t) => round(net.mul(t.r).div(100), decimals));
    // Ajuste por redondeo: base + tributos debe ser exactamente el total
    const diff = total.minus(net).minus(amounts.reduce((s, a) => s.plus(a), D(0)));
    if (!diff.isZero()) {
      if (amounts.length) {
        const biggest = amounts.reduce((bi, a, i) => (a.gt(amounts[bi]!) ? i : bi), 0);
        amounts[biggest] = amounts[biggest]!.plus(diff);
      } else {
        net = net.plus(diff);
      }
    }
  } else {
    net = given;
    amounts = active.map((t) => round(net.mul(t.r).div(100), decimals));
    total = net.plus(amounts.reduce((s, a) => s.plus(a), D(0)));
  }

  let k = 0;
  const lines: TaxLine[] = taxes.map((t) => {
    const exempt = !!t.exempt;
    return {
      code: t.code, rate: D(t.rate).toString(), base: net.toFixed(decimals),
      amount: exempt ? D(0).toFixed(decimals) : amounts[k++]!.toFixed(decimals),
      exempt, exemptionReason: t.exemptionReason ?? null,
    };
  });
  const taxTotal = lines.reduce((s, l) => s.plus(l.amount), D(0));
  return { priceMode, net: net.toFixed(decimals), taxes: lines, taxTotal: taxTotal.toFixed(decimals), total: total.toFixed(decimals) };
}
