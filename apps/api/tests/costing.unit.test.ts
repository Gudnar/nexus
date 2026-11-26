import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@erp/db";
import { exceedsDecimals, layersValue, orderLayers, planIssue, type Layer } from "../src/inventory/costing";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const layer = (lotId: string, available: number, unitCost: number, day: number): Layer => ({ lotId, available: D(available), unitCost: D(unitCost), receivedAt: new Date(Date.UTC(2026, 0, day)) });
const summary = (p: ReturnType<typeof planIssue>) => p.parts.map((x) => `${x.lotId}:${x.quantity}@${x.unitCost}=${x.totalCost}`);

const L = [layer("b", 10, 12, 2), layer("a", 10, 10, 1), layer("c", 10, 15, 3)];

describe("orden de capas", () => {
  it("FIFO y promedio: lo más antiguo primero; LIFO: lo más nuevo primero", () => {
    assert.deepEqual(orderLayers("FIFO", L).map((l) => l.lotId), ["a", "b", "c"]);
    assert.deepEqual(orderLayers("AVERAGE", L).map((l) => l.lotId), ["a", "b", "c"]);
    assert.deepEqual(orderLayers("LIFO", L).map((l) => l.lotId), ["c", "b", "a"]);
  });
  it("con la misma fecha, desempata por código de lote de forma estable", () => {
    const same = [layer("z", 1, 1, 1), layer("m", 1, 1, 1)];
    assert.deepEqual(orderLayers("FIFO", same).map((l) => l.lotId), ["m", "z"]);
    assert.deepEqual(orderLayers("LIFO", same).map((l) => l.lotId), ["z", "m"]);
  });
  it("no modifica la lista original", () => { const copy = [...L]; orderLayers("LIFO", L); assert.deepEqual(L, copy); });
});

describe("planIssue", () => {
  it("FIFO: 15 unidades consumen 10 del lote más viejo y 5 del siguiente, a su propio costo", () => {
    const p = planIssue("FIFO", L, 15);
    assert.deepEqual(summary(p), ["a:10@10=100", "b:5@12=60"]);
    assert.equal(p.shortfall.toString(), "0");
  });
  it("LIFO: consume del más nuevo", () => {
    assert.deepEqual(summary(planIssue("LIFO", L, 12)), ["c:10@15=150", "b:2@12=24"]);
  });
  it("PROMEDIO: el lote físico es el más antiguo pero el costo es el promedio ponderado", () => {
    const avg = { quantity: D(30), value: D(370) }; // 10·10 + 10·12 + 10·15 = 365 → aquí se fuerza otro valor
    const p = planIssue("AVERAGE", L, 15, avg);
    assert.deepEqual(p.parts.map((x) => x.lotId), ["a", "b"]);
    assert.equal(p.parts[0]!.unitCost.toString(), "12.333333");
    assert.equal(p.parts[1]!.unitCost.toString(), "12.333333");
  });
  it("PROMEDIO: una salida total saca exactamente el valor restante (sin residuo de redondeo)", () => {
    const three = [layer("a", 1, 1, 1), layer("b", 1, 1, 2), layer("c", 1, 1, 3)];
    const p = planIssue("AVERAGE", three, 3, { quantity: D(3), value: D(10) }); // 3,333333 por unidad
    assert.equal(p.parts.reduce((s, x) => s.add(x.totalCost), D(0)).toString(), "10");
  });
  it("reporta el faltante cuando no alcanza y no inventa cantidades", () => {
    const p = planIssue("FIFO", L, 45);
    assert.equal(p.shortfall.toString(), "15");
    assert.equal(p.parts.reduce((s, x) => s.add(x.quantity), D(0)).toString(), "30");
  });
  it("ignora capas sin saldo", () => {
    assert.deepEqual(summary(planIssue("FIFO", [layer("a", 0, 5, 1), layer("b", 4, 7, 2)], 3)), ["b:3@7=21"]);
  });
  it("cantidades fraccionarias sin errores de coma flotante", () => {
    const p = planIssue("FIFO", [layer("a", 0.3, 0.1, 1), layer("b", 5, 0.2, 2)], 0.7);
    assert.deepEqual(summary(p), ["a:0.3@0.1=0.03", "b:0.4@0.2=0.08"]);
  });
  it("cantidad cero no genera partes", () => assert.deepEqual(planIssue("FIFO", L, 0).parts, []));
});

describe("valor de capas y decimales", () => {
  it("suma saldo × costo de cada lote", () => assert.equal(layersValue(L).toString(), "370"));
  it("valida los decimales de la unidad", () => {
    assert.equal(exceedsDecimals("2.5", 0), true);
    assert.equal(exceedsDecimals("2", 0), false);
    assert.equal(exceedsDecimals("2.25", 2), false);
    assert.equal(exceedsDecimals("2.255", 2), true);
  });
});
