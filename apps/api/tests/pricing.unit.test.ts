import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NoTierError, priceQuantity, validateTiers, type TierInput } from "../src/pricing/tiers";
import { calculateLineTax } from "../src/pricing/tax";

// 1–9 u: 10,00 · 10–49 u: 9,00 · 50 u o más: 8,00
const TIERS: TierInput[] = [
  { minQuantity: 1, maxQuantity: 10, unitPrice: "10" },
  { minQuantity: 10, maxQuantity: 50, unitPrice: "9" },
  { minQuantity: 50, maxQuantity: null, unitPrice: "8" },
];
const total = (q: number | string, mode: "TIER_THRESHOLD" | "PROGRESSIVE", tiers = TIERS) => priceQuantity(tiers, q, mode).total.toString();

describe("validación de tramos", () => {
  it("acepta tramos contiguos con el último abierto (en cualquier orden de entrada)", () => {
    assert.deepEqual(validateTiers(TIERS), []);
    assert.deepEqual(validateTiers([...TIERS].reverse()), []);
    assert.deepEqual(validateTiers([{ minQuantity: "0.5", unitPrice: "3.25" }]), [], "un solo tramo abierto");
  });

  it("rechaza huecos, solapes y tramos mal formados", () => {
    const e = (t: object[]) => validateTiers(t as never).join(" | ");
    assert.match(e([{ minQuantity: 1, maxQuantity: 10, unitPrice: 5 }, { minQuantity: 12, unitPrice: 4 }]), /no puede haber huecos ni solapes/);
    assert.match(e([{ minQuantity: 1, maxQuantity: 10, unitPrice: 5 }, { minQuantity: 8, unitPrice: 4 }]), /no puede haber huecos ni solapes/);
    assert.match(e([{ minQuantity: 1, maxQuantity: 10, unitPrice: 5 }]), /debe quedar abierto/);
    assert.match(e([{ minQuantity: 1, unitPrice: 5 }, { minQuantity: 10, unitPrice: 4 }]), /solo el último tramo puede quedar abierto/);
    assert.match(e([{ minQuantity: 0, unitPrice: 5 }]), /mayor que cero/);
    assert.match(e([{ minQuantity: 1, unitPrice: -1 }]), /negativo/);
    assert.match(e([{ minQuantity: 5, maxQuantity: 5, unitPrice: 1 }]), /mayor que el mínimo/);
    assert.match(e([{ minQuantity: 1, unitPrice: 1.00001 }]), /decimales/);
    assert.match(e([{ minQuantity: 1, maxQuantity: 5, unitPrice: 1 }, { minQuantity: 1, unitPrice: 2 }]), /mismo mínimo/);
    assert.deepEqual(validateTiers([]), ["Define al menos un tramo."]);
    assert.match(validateTiers(Array.from({ length: 21 }, (_, i) => ({ minQuantity: i + 1, unitPrice: 1 })))[0]!, /Máximo 20/);
  });
});

describe("por tramo (TIER_THRESHOLD): todas las unidades al precio del tramo alcanzado", () => {
  it("cambia de precio exactamente en el mínimo del siguiente tramo", () => {
    assert.equal(total(1, "TIER_THRESHOLD"), "10");
    assert.equal(total(9, "TIER_THRESHOLD"), "90");
    assert.equal(total(10, "TIER_THRESHOLD"), "90", "10 u × 9,00");
    assert.equal(total(49, "TIER_THRESHOLD"), "441");
    assert.equal(total(50, "TIER_THRESHOLD"), "400");
    assert.equal(total(1000, "TIER_THRESHOLD"), "8000");
  });

  it("admite cantidades fraccionarias", () => {
    assert.equal(total("2.5", "TIER_THRESHOLD"), "25");
    assert.equal(total("9.9999", "TIER_THRESHOLD"), "99.999");
    assert.equal(total("10.0001", "TIER_THRESHOLD"), "90.0009");
  });

  it("por debajo del mínimo de la lista no hay precio", () => {
    assert.throws(() => priceQuantity(TIERS, "0.5", "TIER_THRESHOLD"), NoTierError);
    assert.throws(() => priceQuantity([{ minQuantity: 5, unitPrice: 1 }], 4, "TIER_THRESHOLD"), /mínima/);
    assert.throws(() => priceQuantity(TIERS, 0, "TIER_THRESHOLD"), RangeError);
    assert.throws(() => priceQuantity(TIERS, -1, "TIER_THRESHOLD"), RangeError);
  });
});

describe("progresivo (PROGRESSIVE): cada bloque se cobra a su tramo", () => {
  it("las 9 primeras unidades a 10, de la 10.ª a la 49.ª a 9, desde la 50.ª a 8", () => {
    assert.equal(total(9, "PROGRESSIVE"), "90");
    assert.equal(total(10, "PROGRESSIVE"), "99", "9×10 + 1×9");
    assert.equal(total(25, "PROGRESSIVE"), "234", "9×10 + 16×9");
    assert.equal(total(49, "PROGRESSIVE"), "450", "9×10 + 40×9");
    assert.equal(total(50, "PROGRESSIVE"), "458", "+ 1×8");
    assert.equal(total(100, "PROGRESSIVE"), "858", "90 + 360 + 51×8");
  });

  it("devuelve el desglose por tramo", () => {
    const r = priceQuantity(TIERS, 25, "PROGRESSIVE");
    assert.deepEqual(r.parts.map((p) => [p.tierMin, p.quantity, p.unitPrice]), [["1", "9", "10"], ["10", "16", "9"]]);
  });

  it("la fracción final se cobra al precio de la unidad siguiente", () => {
    assert.equal(total("9.5", "PROGRESSIVE"), "94.5", "9×10 + 0,5×9 (la unidad 10 ya es del tramo 2)");
    assert.equal(total("2.5", "PROGRESSIVE"), "25", "2×10 + 0,5×10");
  });

  it("con un solo tramo coincide con el precio plano", () => {
    const flat = [{ minQuantity: 1, unitPrice: "3.50" }];
    assert.equal(total(7, "PROGRESSIVE", flat), "24.5");
    assert.equal(total(7, "TIER_THRESHOLD", flat), "24.5");
  });

  it("para enteros, nunca cuesta más que el modo por tramo (el progresivo es más caro hasta cruzar tramos)", () => {
    // propiedad: con precios decrecientes, progresivo >= por tramo para toda cantidad entera
    for (let q = 1; q <= 120; q++) {
      assert.ok(priceQuantity(TIERS, q, "PROGRESSIVE").total.gte(priceQuantity(TIERS, q, "TIER_THRESHOLD").total), `q=${q}`);
    }
  });

  it("sin huecos: la suma de las partes es el total", () => {
    for (const q of [1, 9, 10, 49, 50, 51, 137]) {
      const r = priceQuantity(TIERS, q, "PROGRESSIVE");
      const qty = r.parts.reduce((s, p) => s + Number(p.quantity), 0);
      assert.equal(qty, q);
      assert.equal(r.parts.reduce((s, p) => s + Number(p.amount), 0), Number(r.total));
    }
  });
});

describe("impuestos: precio SIN impuestos (se suman)", () => {
  it("IVA 13 % sobre la base", () => {
    const r = calculateLineTax("100", "WITHOUT_TAX", [{ code: "IVA", rate: 13 }], 2);
    assert.equal(r.net, "100.00");
    assert.equal(r.taxes[0]!.amount, "13.00");
    assert.equal(r.total, "113.00");
    assert.equal(r.taxTotal, "13.00");
  });

  it("varios tributos sobre la misma base (sin cascada)", () => {
    const r = calculateLineTax("200", "WITHOUT_TAX", [{ code: "IVA", rate: 13 }, { code: "IT", rate: 3 }], 2);
    assert.deepEqual(r.taxes.map((t) => t.amount), ["26.00", "6.00"]);
    assert.equal(r.total, "232.00");
  });

  it("redondea cada tributo mitad hacia arriba", () => {
    const r = calculateLineTax("10.05", "WITHOUT_TAX", [{ code: "IVA", rate: 13 }], 2); // 1,3065 → 1,31
    assert.equal(r.taxes[0]!.amount, "1.31");
    assert.equal(r.total, "11.36");
  });
});

describe("impuestos: precio CON impuestos (se desglosan)", () => {
  it("el total es exactamente el importe dado", () => {
    const r = calculateLineTax("113", "WITH_TAX", [{ code: "IVA", rate: 13 }], 2);
    assert.equal(r.net, "100.00");
    assert.equal(r.taxes[0]!.amount, "13.00");
    assert.equal(r.total, "113.00");
  });

  it("base + tributos siempre suma el total, aunque el redondeo no cuadre", () => {
    for (const gross of ["0.01", "1", "9.99", "10.01", "33.33", "99.99", "1234.56", "0.10"]) {
      const r = calculateLineTax(gross, "WITH_TAX", [{ code: "IVA", rate: 13 }, { code: "IT", rate: 3 }], 2);
      const sum = Number(r.net) + r.taxes.reduce((s, t) => s + Number(t.amount), 0);
      assert.equal(sum.toFixed(2), Number(gross).toFixed(2), gross);
      assert.equal(r.total, Number(gross).toFixed(2));
    }
  });

  it("varios tributos: sobre la misma base", () => {
    const r = calculateLineTax("116", "WITH_TAX", [{ code: "IVA", rate: 13 }, { code: "IT", rate: 3 }], 2); // 116 = 100 × 1,16
    assert.equal(r.net, "100.00");
    assert.deepEqual(r.taxes.map((t) => t.amount), ["13.00", "3.00"]);
  });
});

describe("impuestos: exenciones y casos límite", () => {
  it("un tributo exento no suma y conserva su motivo", () => {
    const r = calculateLineTax("100", "WITHOUT_TAX", [{ code: "IVA", rate: 13, exempt: true, exemptionReason: "Exportación" }], 2);
    assert.equal(r.total, "100.00");
    assert.equal(r.taxes[0]!.amount, "0.00");
    assert.equal(r.taxes[0]!.exemptionReason, "Exportación");
    assert.equal(r.taxes[0]!.exempt, true);
  });

  it("sin tributos: con o sin impuestos da lo mismo", () => {
    for (const mode of ["WITH_TAX", "WITHOUT_TAX"] as const) {
      const r = calculateLineTax("55.5", mode, [], 2);
      assert.deepEqual([r.net, r.total, r.taxTotal], ["55.50", "55.50", "0.00"]);
    }
  });

  it("tasa cero y decimales de redondeo distintos", () => {
    assert.equal(calculateLineTax("100", "WITHOUT_TAX", [{ code: "X", rate: 0 }], 2).total, "100.00");
    const r = calculateLineTax("100", "WITHOUT_TAX", [{ code: "IVA", rate: 13 }], 0);
    assert.deepEqual([r.net, r.total], ["100", "113"]);
  });

  it("la misma mercadería cuesta lo mismo en ambas modalidades si el precio equivale", () => {
    const a = calculateLineTax("100", "WITHOUT_TAX", [{ code: "IVA", rate: 13 }], 2);
    const b = calculateLineTax(a.total, "WITH_TAX", [{ code: "IVA", rate: 13 }], 2);
    assert.equal(b.net, a.net);
    assert.equal(b.total, a.total);
  });
});
