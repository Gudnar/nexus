import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDb, withTenant } from "@erp/db";
import { Clock } from "../src/access/clock";
import { StockEngine } from "../src/inventory/stock-engine";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string, clock: Clock;
let W1: string, W2: string, W3: string, WB: string;
let UND: string, KG: string;
let P1: string, PL: string, PK: string, PS: string;

type M = "GET" | "POST" | "PATCH";
const api = (token: string, method: M, url: string, body?: unknown, headers?: Record<string, string>) => call(method, `/api/v1${url}`, { token, body, headers });
const day = (n: number) => new Date(Date.now() + n * 86_400_000);
const isoDay = (n: number) => day(n).toISOString().slice(0, 10);

const adjust = (token: string, warehouseId: string, lines: object[], reason = "Prueba") => api(token, "POST", "/inventory/adjustments", { warehouseId, reason, lines });
const stockOf = async (productId: string, warehouseId?: string) => {
  const r = await api(admin, "GET", `/inventory/stock?productId=${productId}${warehouseId ? `&warehouseId=${warehouseId}` : ""}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.items as { physicalQty: string; value: string; averageCost: string; warehouse: { code: string } }[];
};
const qtyValue = async (productId: string, warehouseId: string) => { const [row] = await stockOf(productId, warehouseId); return row ? [row.physicalQty, row.value] : ["0", "0"]; };
const product = async (body: object) => { const r = await api(admin, "POST", "/catalog/products", { baseUnitId: UND, ...body }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id as string; };
const reconciled = async () => { const r = await api(admin, "GET", "/inventory/reconciliation"); assert.equal(r.status, 200); return r.json; };

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  [admin, adminB, manager, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local")]);
  const units = (await api(admin, "GET", "/catalog/units")).json as { id: string; code: string }[];
  UND = units.find((u) => u.code === "UND")!.id;
  KG = units.find((u) => u.code === "KG")!.id;
  const wh = async (token: string, branchId: string, code: string) => (await api(token, "POST", "/inventory/warehouses", { branchId, code, name: `Almacén ${code}` })).json.id as string;
  W1 = await wh(admin, world.a1, "W1");
  W2 = await wh(admin, world.a2, "W2");
  W3 = await wh(admin, world.a3, "W3");
  WB = await wh(adminB, world.b1, "WB");
  P1 = await product({ code: "P1", name: "Producto simple" });
  PL = await product({ code: "PL", name: "Producto con lote y vencimiento", trackLots: true, trackExpiry: true });
  PK = await product({ code: "PK", name: "Producto al peso", baseUnitId: KG });
  PS = await product({ code: "PS", name: "Servicio", kind: "SERVICE" });
});
after(async () => { clock.set(null); await teardown(); });

describe("almacenes y alcance por sucursal", () => {
  it("el código es único por empresa y el mismo código sirve en otra empresa", async () => {
    assert.equal((await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Otro" })).status, 409);
    assert.equal((await api(adminB, "POST", "/inventory/warehouses", { branchId: world.b1, code: "W1", name: "Mismo código en B" })).status, 201);
  });
  it("no se crea un almacén en una sucursal de otra empresa", async () => {
    assert.equal((await api(admin, "POST", "/inventory/warehouses", { branchId: world.b1, code: "X1", name: "Ajeno" })).status, 403);
  });
  it("el gerente (sucursales A1 y A2) solo ve y opera esas; el cajero no tiene acceso a inventario", async () => {
    const list = (await api(manager, "GET", "/inventory/warehouses")).json.map((w: { code: string }) => w.code);
    assert.deepEqual(list.sort(), ["W1", "W2"]);
    assert.equal((await api(admin, "GET", "/inventory/warehouses")).json.length, 3);
    assert.equal((await api(cashier, "GET", "/inventory/warehouses")).status, 403);
    assert.equal((await api(cashier, "POST", "/inventory/warehouses", { branchId: world.a1, code: "C1", name: "x" })).status, 403);
    assert.equal((await adjust(manager, W3, [{ productId: P1, quantity: 1, unitCost: 1 }])).status, 403, "A3 queda fuera de su alcance");
  });
  it("la empresa B no ve los almacenes de A", async () => {
    assert.deepEqual((await api(adminB, "GET", "/inventory/warehouses")).json.map((w: { code: string }) => w.code).sort(), ["W1", "WB"]);
  });
});

describe("entradas y validaciones", () => {
  it("un ajuste positivo crea un lote con código automático y costo, y deja stock y valor", async () => {
    const r = await adjust(admin, W1, [{ productId: P1, quantity: 10, unitCost: 10 }], "Carga inicial");
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.code, /^AJ-\d{6}$/);
    assert.equal(r.json.lines[0].lotCode?.startsWith("L-"), true);
    assert.deepEqual(await qtyValue(P1, W1), ["10", "100"]);
  });
  it("al sumar hay que indicar el costo", async () => {
    const r = await adjust(admin, W1, [{ productId: P1, quantity: 1 }]);
    assert.equal(r.status, 400); assert.equal(r.json.code, "COST_REQUIRED");
  });
  it("rechaza servicios, cantidades con demasiados decimales, productos inexistentes y cantidad cero", async () => {
    assert.equal((await adjust(admin, W1, [{ productId: PS, quantity: 1, unitCost: 1 }])).json.code, "NOT_STOCKABLE");
    assert.equal((await adjust(admin, W1, [{ productId: P1, quantity: 1.5, unitCost: 1 }])).json.code, "INVALID_QUANTITY");
    assert.equal((await adjust(admin, W1, [{ productId: PK, quantity: 1.2345, unitCost: 1 }])).json.code, "INVALID_QUANTITY");
    assert.equal((await adjust(admin, W1, [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1, unitCost: 1 }])).status, 404);
    assert.equal((await adjust(admin, W1, [{ productId: P1, quantity: 0, unitCost: 1 }])).status, 400);
    assert.equal((await adjust(admin, W1, [{ productId: P1, quantity: 1, unitCost: -1 }])).status, 400);
  });
  it("un ajuste con una línea inválida no deja NADA aplicado (todo o nada)", async () => {
    const before = await qtyValue(P1, W1);
    const r = await adjust(admin, W1, [{ productId: P1, quantity: 5, unitCost: 1 }, { productId: PS, quantity: 1, unitCost: 1 }]);
    assert.equal(r.status, 400);
    assert.deepEqual(await qtyValue(P1, W1), before);
    assert.equal((await reconciled()).balances.length, 0);
  });
  it("cantidades fraccionarias en unidades con decimales", async () => {
    assert.equal((await adjust(admin, W1, [{ productId: PK, quantity: 2.5, unitCost: 8 }])).status, 201);
    assert.deepEqual(await qtyValue(PK, W1), ["2.5", "20"]);
    assert.equal((await adjust(admin, W1, [{ productId: PK, quantity: -0.75 }])).status, 201);
    assert.deepEqual(await qtyValue(PK, W1), ["1.75", "14"]);
  });
  it("el producto con vencimiento exige fecha; uno sin vencimiento no la admite; el lote y la fecha se guardan", async () => {
    assert.equal((await adjust(admin, W1, [{ productId: PL, quantity: 5, unitCost: 4 }])).json.code, "EXPIRY_REQUIRED");
    assert.equal((await adjust(admin, W1, [{ productId: P1, quantity: 5, unitCost: 4, lot: { expiresOn: isoDay(30) } }])).json.code, "EXPIRY_NOT_TRACKED");
    assert.equal((await adjust(admin, W1, [{ productId: P1, quantity: 5, unitCost: 4, lot: { code: "MIO" } }])).json.code, "LOT_NOT_TRACKED");
    assert.equal((await adjust(admin, W1, [{ productId: PL, quantity: 5, unitCost: 4, lot: { expiresOn: isoDay(30), manufacturedOn: isoDay(60) } }])).json.code, "INVALID_DATES");
    const ok = await adjust(admin, W1, [{ productId: PL, quantity: 5, unitCost: 4, lot: { code: "LOTE-A", expiresOn: isoDay(30) } }]);
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    const lots = (await api(admin, "GET", `/inventory/stock/lots?productId=${PL}`)).json;
    assert.deepEqual(lots.map((l: { lotCode: string; expiresOn: string }) => [l.lotCode, l.expiresOn]), [["LOTE-A", isoDay(30)]]);
    assert.equal((await adjust(admin, W1, [{ productId: PL, quantity: 1, unitCost: 4, lot: { code: "LOTE-A", expiresOn: isoDay(30) } }])).json.code, "LOT_CODE_TAKEN");
  });
});

describe("valoración FIFO, LIFO y promedio", () => {
  const fifo = async () => {
    const out = await adjust(admin, W1, [{ productId: P1, quantity: 10, unitCost: 12 }]); // segundo lote: P1 = 10@10 + 10@12
    assert.equal(out.status, 201);
  };

  it("FIFO (por defecto): 15 unidades consumen el lote viejo y luego el nuevo, a su propio costo", async () => {
    await fifo();
    assert.deepEqual(await qtyValue(P1, W1), ["20", "220"]);
    const r = await adjust(admin, W1, [{ productId: P1, quantity: -15 }], "Merma");
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.lines.map((l: { quantity: string; unitCost: string }) => [l.quantity, l.unitCost]), [["-10", "10"], ["-5", "12"]]);
    assert.deepEqual(await qtyValue(P1, W1), ["5", "60"]);
  });

  it("stock insuficiente: 409 y no cambia nada", async () => {
    const r = await adjust(admin, W1, [{ productId: P1, quantity: -6 }]);
    assert.equal(r.status, 409); assert.equal(r.json.code, "INSUFFICIENT_STOCK");
    assert.deepEqual(await qtyValue(P1, W1), ["5", "60"]);
  });

  it("selección manual de lote: se descuenta del lote elegido", async () => {
    const lots = (await api(admin, "GET", `/inventory/stock/lots?productId=${P1}`)).json as { lotId: string; availableQty: string }[];
    assert.equal(lots.length, 1, "el lote más viejo se agotó");
    await adjust(admin, W1, [{ productId: P1, quantity: 5, unitCost: 20 }]); // tercer lote 5@20
    const all = (await api(admin, "GET", `/inventory/stock/lots?productId=${P1}`)).json as { lotId: string; unitCost: string }[];
    const dear = all.find((l) => l.unitCost === "20")!;
    const r = await adjust(admin, W1, [{ productId: P1, quantity: -2, lotId: dear.lotId }]);
    assert.deepEqual(r.json.lines.map((l: { quantity: string; unitCost: string }) => [l.quantity, l.unitCost]), [["-2", "20"]]);
    // devolver el estado para las pruebas siguientes: 5@12 + 3@20
    assert.deepEqual(await qtyValue(P1, W1), ["8", "120"]);
  });

  it("LIFO: consume primero lo más nuevo (y el cambio de método no genera revaluación si el valor ya coincide con los lotes)", async () => {
    const p = await api(admin, "POST", "/inventory/valuation/policy", { method: "LIFO" });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(p.json.revaluations, 0);
    const r = await adjust(admin, W1, [{ productId: P1, quantity: -4 }]);
    assert.deepEqual(r.json.lines.map((l: { quantity: string; unitCost: string }) => [l.quantity, l.unitCost]), [["-3", "20"], ["-1", "12"]]);
    assert.deepEqual(await qtyValue(P1, W1), ["4", "48"]); // 4 unidades del lote de 12
  });

  it("no se puede cambiar el método dos veces el mismo día (la política rige desde una fecha)", async () => {
    const r = await api(admin, "POST", "/inventory/valuation/policy", { method: "AVERAGE" });
    assert.equal(r.status, 409); assert.equal(r.json.code, "POLICY_TODAY");
  });

  it("PROMEDIO: el costo de salida es el promedio ponderado del almacén; el lote físico sigue siendo el más antiguo", async () => {
    clock.set(day(1));
    assert.equal((await api(admin, "POST", "/inventory/valuation/policy", { method: "AVERAGE" })).status, 200);
    await adjust(admin, W1, [{ productId: P1, quantity: 4, unitCost: 16 }]); // 4@12 + 4@16 = 112 → promedio 14
    assert.deepEqual(await qtyValue(P1, W1), ["8", "112"]);
    const r = await adjust(admin, W1, [{ productId: P1, quantity: -2 }]);
    assert.deepEqual(r.json.lines.map((l: { quantity: string; unitCost: string }) => [l.quantity, l.unitCost]), [["-2", "14"]]);
    assert.deepEqual(await qtyValue(P1, W1), ["6", "84"]);
  });

  it("volver a FIFO realinea el valor con el costo de los lotes mediante una revaluación (sin tocar la historia)", async () => {
    // Capas reales: 2@12 + 4@16 = 88, pero el promedio dejó el valor en 84.
    clock.set(day(2));
    const p = await api(admin, "POST", "/inventory/valuation/policy", { method: "FIFO" });
    assert.equal(p.json.revaluations, 1, JSON.stringify(p.json));
    assert.deepEqual(await qtyValue(P1, W1), ["6", "88"]);
    const k = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&warehouseId=${W1}&limit=5`)).json.items;
    assert.equal(k[0].type, "REVALUATION");
    assert.equal(k[0].totalCost, "4");
    assert.equal(k[0].quantity, "0");
  });

  it("los cambios de política quedan registrados", async () => {
    const pol = (await api(admin, "GET", "/inventory/valuation/policy")).json;
    assert.deepEqual(pol.policies.map((x: { method: string }) => x.method), ["FIFO", "AVERAGE", "LIFO"]);
    assert.equal(pol.current, "FIFO");
    clock.set(null);
  });

  it("política por producto: tiene prioridad sobre la de la empresa", async () => {
    const q = await product({ code: "PP", name: "Producto con política propia" });
    await adjust(admin, W1, [{ productId: q, quantity: 2, unitCost: 5 }, { productId: P1, quantity: 0.0, unitCost: 0 }].slice(0, 1));
    await adjust(admin, W1, [{ productId: q, quantity: 2, unitCost: 9 }]);
    clock.set(day(3));
    assert.equal((await api(admin, "POST", "/inventory/valuation/policy", { productId: q, method: "LIFO" })).status, 200);
    const r = await adjust(admin, W1, [{ productId: q, quantity: -1 }]);
    assert.deepEqual(r.json.lines.map((l: { unitCost: string }) => l.unitCost), ["9"]);
    clock.set(null);
  });
});

describe("concurrencia: sin stock negativo", () => {
  it("ocho salidas simultáneas de 1 unidad sobre 5 disponibles: exactamente 5 pasan", async () => {
    const p = await product({ code: "CONC", name: "Concurrencia" });
    await adjust(admin, W2, [{ productId: p, quantity: 5, unitCost: 3 }]);
    const engine = world.app.get(StockEngine);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        withTenant(owner, world.tenantA, (tx) => engine.issue(tx, { tenantId: world.tenantA, today: isoDay(0) }, { warehouseId: W2, productId: p, quantity: 1, type: "ISSUE" })),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
    const failures = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.response?.code);
    assert.ok(failures.every((c) => c === "INSUFFICIENT_STOCK"), failures.join(","));
    assert.deepEqual(await qtyValue(p, W2), ["0", "0"]);
    const rec = await reconciled();
    assert.deepEqual([rec.balances.length, rec.valuations.length], [0, 0]);
  });

  it("entradas y salidas mezcladas en paralelo mantienen saldo y valor consistentes", async () => {
    const p = await product({ code: "MIX", name: "Mezcla" });
    await adjust(admin, W2, [{ productId: p, quantity: 20, unitCost: 2 }]);
    const ops = [
      ...Array.from({ length: 3 }, () => adjust(admin, W2, [{ productId: p, quantity: -2 }])),
      ...Array.from({ length: 3 }, () => adjust(admin, W2, [{ productId: p, quantity: 3, unitCost: 5 }])),
    ];
    const res = await Promise.all(ops);
    assert.ok(res.every((r) => r.status === 201), res.map((r) => r.status).join(","));
    assert.deepEqual((await qtyValue(p, W2))[0], "23"); // 20 - 6 + 9
    const rec = await reconciled();
    assert.deepEqual([rec.balances.length, rec.valuations.length], [0, 0]);
  });
});

describe("motor de stock: lotes vencidos y bloqueados en salidas de venta", () => {
  it("una salida automática (ISSUE) salta los lotes vencidos y los bloqueados; un lote concreto vencido se rechaza", async () => {
    const p = await product({ code: "EXP", name: "Perecible", trackLots: true, trackExpiry: true });
    await adjust(admin, W1, [{ productId: p, quantity: 3, unitCost: 1, lot: { code: "VIEJO", expiresOn: isoDay(1) } }, { productId: p, quantity: 3, unitCost: 2, lot: { code: "BUENO", expiresOn: isoDay(90) } }, { productId: p, quantity: 3, unitCost: 3, lot: { code: "BLOQ", expiresOn: isoDay(90) } }]);
    await withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE lot SET expires_on = CURRENT_DATE - 5 WHERE code = 'VIEJO'`)); // venció hace 5 días
    await withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE lot SET status = 'BLOCKED' WHERE code = 'BLOQ'`));
    const engine = world.app.get(StockEngine);
    const actor = { tenantId: world.tenantA, today: isoDay(0) };
    const parts = await withTenant(owner, world.tenantA, (tx) => engine.issue(tx, actor, { warehouseId: W1, productId: p, quantity: 2, type: "ISSUE" }));
    assert.deepEqual(parts.map((x) => x.unitCost.toString()), ["2"], "solo el lote BUENO es elegible");
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => engine.issue(tx, actor, { warehouseId: W1, productId: p, quantity: 2, type: "ISSUE" })), (e: any) => e.response?.code === "INSUFFICIENT_STOCK");
    const lots = (await api(admin, "GET", `/inventory/stock/lots?productId=${p}`)).json as { lotId: string; lotCode: string }[];
    const viejo = lots.find((l) => l.lotCode === "VIEJO")!, bloq = lots.find((l) => l.lotCode === "BLOQ")!;
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => engine.issue(tx, actor, { warehouseId: W1, productId: p, quantity: 1, type: "ISSUE", lotId: viejo.lotId })), (e: any) => e.response?.code === "LOT_EXPIRED");
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => engine.issue(tx, actor, { warehouseId: W1, productId: p, quantity: 1, type: "ISSUE", lotId: bloq.lotId })), (e: any) => e.response?.code === "LOT_BLOCKED");
    // Pero un ajuste (dar de baja mercadería vencida) sí puede sacar el lote vencido.
    assert.equal((await adjust(admin, W1, [{ productId: p, quantity: -3, lotId: viejo.lotId }], "Baja por vencimiento")).status, 201);
  });
});

describe("reversas: nunca se borra, se compensa", () => {
  it("revertir una entrada saca lo ingresado al costo original y deja ambos movimientos", async () => {
    const p = await product({ code: "REV", name: "Reversas" });
    await adjust(admin, W1, [{ productId: p, quantity: 10, unitCost: 7 }]);
    const mov = (await api(admin, "GET", `/inventory/kardex?productId=${p}`)).json.items[0];
    const r = await api(admin, "POST", `/inventory/movements/${mov.id}/reverse`, { reason: "Error de carga" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(await qtyValue(p, W1), ["0", "0"]);
    const k = (await api(admin, "GET", `/inventory/kardex?productId=${p}`)).json.items;
    assert.deepEqual(k.map((x: { quantity: string; reversalOfId: string | null }) => [x.quantity, x.reversalOfId === mov.id]), [["-10", true], ["10", false]]);
    assert.equal(k[0].unitCost, "7");
  });

  it("no se revierte dos veces, ni una reversa, ni una revaluación", async () => {
    const p = await product({ code: "REV2", name: "Reversas 2" });
    await adjust(admin, W1, [{ productId: p, quantity: 4, unitCost: 2 }]);
    const mov = (await api(admin, "GET", `/inventory/kardex?productId=${p}`)).json.items[0];
    assert.equal((await api(admin, "POST", `/inventory/movements/${mov.id}/reverse`, { reason: "uno" })).status, 200);
    const again = await api(admin, "POST", `/inventory/movements/${mov.id}/reverse`, { reason: "dos" });
    assert.equal(again.status, 409); assert.equal(again.json.code, "ALREADY_REVERSED");
    const rev = (await api(admin, "GET", `/inventory/kardex?productId=${p}`)).json.items[0];
    assert.equal((await api(admin, "POST", `/inventory/movements/${rev.id}/reverse`, { reason: "tres" })).json.code, "NOT_REVERSIBLE");
    const reval = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&limit=5`)).json.items.find((x: { type: string }) => x.type === "REVALUATION");
    assert.equal((await api(admin, "POST", `/inventory/movements/${reval.id}/reverse`, { reason: "cuatro" })).json.code, "NOT_REVERSIBLE");
  });

  it("revertir una entrada cuyo stock ya se consumió falla sin dejar rastro", async () => {
    const p = await product({ code: "REV3", name: "Reversas 3" });
    await adjust(admin, W1, [{ productId: p, quantity: 5, unitCost: 2 }]);
    const mov = (await api(admin, "GET", `/inventory/kardex?productId=${p}`)).json.items[0];
    await adjust(admin, W1, [{ productId: p, quantity: -3 }]);
    const r = await api(admin, "POST", `/inventory/movements/${mov.id}/reverse`, { reason: "tarde" });
    assert.equal(r.status, 409); assert.equal(r.json.code, "INSUFFICIENT_STOCK");
    assert.deepEqual(await qtyValue(p, W1), ["2", "4"]);
  });

  it("revertir una salida devuelve el stock al mismo lote y con el mismo costo", async () => {
    const p = await product({ code: "REV4", name: "Reversas 4" });
    await adjust(admin, W1, [{ productId: p, quantity: 5, unitCost: 6 }]);
    await adjust(admin, W1, [{ productId: p, quantity: -2 }]);
    const out = (await api(admin, "GET", `/inventory/kardex?productId=${p}`)).json.items[0];
    assert.equal(out.quantity, "-2");
    assert.equal((await api(admin, "POST", `/inventory/movements/${out.id}/reverse`, { reason: "Error" })).status, 200);
    assert.deepEqual(await qtyValue(p, W1), ["5", "30"]);
    assert.equal(((await api(admin, "GET", `/inventory/stock/lots?productId=${p}`)).json as unknown[]).length, 1, "mismo lote, no se duplica");
  });

  it("un movimiento de otra empresa no existe; sin permiso no se revierte", async () => {
    const mov = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&limit=1`)).json.items[0];
    assert.equal((await api(adminB, "POST", `/inventory/movements/${mov.id}/reverse`, { reason: "intruso" })).status, 404);
    assert.equal((await api(cashier, "POST", `/inventory/movements/${mov.id}/reverse`, { reason: "intruso" })).status, 403);
  });
});

describe("kardex, existencias y conciliación", () => {
  it("el kardex muestra el saldo corrido y se pagina de nuevo a antiguo", async () => {
    const all = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&warehouseId=${W1}&limit=200`)).json.items;
    const asc = [...all].reverse();
    let run = 0;
    for (const m of asc) { run += Number(m.quantity); assert.equal(Number(m.balanceAfter), run, `seq ${m.seq}`); }
    const p1 = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&warehouseId=${W1}&limit=3`)).json;
    assert.equal(p1.items.length, 3);
    const p2 = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&warehouseId=${W1}&limit=3&cursor=${p1.nextCursor}`)).json;
    assert.deepEqual([...p1.items, ...p2.items].map((x: { id: string }) => x.id), all.slice(0, 3 + p2.items.length).map((x: { id: string }) => x.id));
  });
  it("filtra por lote y por rango de fechas", async () => {
    const lot = (await api(admin, "GET", `/inventory/stock/lots?productId=${P1}`)).json[0];
    const byLot = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&lotId=${lot.lotId}`)).json.items;
    assert.ok(byLot.length > 0 && byLot.every((m: { lot: { id: string } }) => m.lot.id === lot.lotId));
    assert.equal((await api(admin, "GET", `/inventory/kardex?productId=${P1}&from=2000-01-01&to=2000-01-02`)).json.items.length, 0);
    assert.ok((await api(admin, "GET", `/inventory/kardex?productId=${P1}&from=2000-01-01&to=2100-01-01`)).json.items.length > 0);
  });
  it("las existencias se filtran por búsqueda y almacén, y el gerente solo ve sus sucursales", async () => {
    assert.ok((await api(admin, "GET", "/inventory/stock?q=simple")).json.items.some((r: { code: string }) => r.code === "P1"));
    await adjust(admin, W3, [{ productId: P1, quantity: 7, unitCost: 1 }]);
    const mine = (await api(manager, "GET", `/inventory/stock?productId=${P1}`)).json.items.map((r: { warehouse: { code: string } }) => r.warehouse.code);
    assert.deepEqual(mine, ["W1"], "el stock de W3 (sucursal A3) no se ve");
    assert.equal((await api(manager, "GET", `/inventory/kardex?productId=${P1}&warehouseId=${W3}`)).json.items.length, 0);
  });
  it("la empresa B no ve existencias, kardex ni lotes de A", async () => {
    assert.deepEqual((await api(adminB, "GET", "/inventory/stock")).json.items, []);
    assert.deepEqual((await api(adminB, "GET", `/inventory/kardex?productId=${P1}`)).json.items, []);
    assert.deepEqual((await api(adminB, "GET", `/inventory/stock/lots?productId=${P1}`)).json, []);
    assert.equal((await adjust(adminB, W1, [{ productId: P1, quantity: 1, unitCost: 1 }])).status, 404, "ni el almacén ni el producto de A existen para B");
  });
  it("la conciliación de saldos y valoración contra el libro no encuentra diferencias", async () => {
    const rec = await reconciled();
    assert.deepEqual([rec.balances, rec.valuations], [[], []]);
  });
  it("la conciliación detecta un saldo alterado a mano", async () => {
    await withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE stock_balance SET physical_qty = physical_qty + 1 WHERE id = (SELECT id FROM stock_balance WHERE physical_qty > 0 ORDER BY id LIMIT 1)`));
    const rec = await reconciled();
    assert.equal(rec.balances.length, 1);
    await withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE stock_balance SET physical_qty = physical_qty - 1 WHERE id = (SELECT id FROM stock_balance WHERE physical_qty > 1 ORDER BY id LIMIT 1)`));
  });
});

describe("integridad en la base de datos", () => {
  it("el libro de movimientos y las políticas son append-only incluso con el usuario de la aplicación", async () => {
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of ["DELETE FROM stock_movement", "UPDATE stock_movement SET note = 'x'", "TRUNCATE stock_movement", "DELETE FROM valuation_policy", "DELETE FROM lot", "DELETE FROM stock_adjustment"]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
    } finally { await app.$disconnect(); }
  });
  it("la base rechaza stock negativo y movimientos con signo incoherente", async () => {
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE stock_balance SET physical_qty = -1 WHERE id = (SELECT id FROM stock_balance LIMIT 1)`)), /check|restricci/i);
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(
      `INSERT INTO stock_movement (id, tenant_id, branch_id, warehouse_id, product_id, lot_id, type, quantity, unit_cost, total_cost, occurred_at)
       SELECT gen_random_uuid(), tenant_id, branch_id, warehouse_id, product_id, lot_id, 'RECEIPT', -1, 1, -1, now() FROM stock_movement WHERE lot_id IS NOT NULL LIMIT 1`)), /check|restricci/i);
  });
  it("un almacén con existencias no se puede desactivar", async () => {
    const r = await api(admin, "PATCH", `/inventory/warehouses/${W1}`, { status: "INACTIVE" });
    assert.equal(r.status, 409); assert.equal(r.json.code, "WAREHOUSE_HAS_STOCK");
    const empty = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "VACIO", name: "Vacío" })).json.id;
    assert.equal((await api(admin, "PATCH", `/inventory/warehouses/${empty}`, { status: "INACTIVE" })).status, 200);
    assert.equal((await adjust(admin, empty, [{ productId: P1, quantity: 1, unitCost: 1 }])).json.code, "WAREHOUSE_INACTIVE");
  });
  it("los ajustes y cambios de política quedan auditados", async () => {
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    for (const a of ["warehouse.created", "inventory.adjusted", "inventory.reversed", "inventory.policy_changed"]) assert.ok(acts.has(a), a);
  });
});
