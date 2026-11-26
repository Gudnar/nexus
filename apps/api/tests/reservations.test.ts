import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { withTenant } from "@erp/db";
import { Clock } from "../src/access/clock";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string, clock: Clock;
let W1: string, W3: string, UND: string, L1: string, CUST: string;

type M = "GET" | "POST";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);
const isoDay = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** [físico, reservado, disponible] de un producto en el almacén. */
const levels = async (productId: string, warehouseId = W1) => {
  const [row] = (await api(admin, "GET", `/inventory/stock?productId=${productId}&warehouseId=${warehouseId}`)).json.items;
  return row ? [row.physicalQty, row.reservedQty, row.availableQty] : ["0", "0", "0"];
};
const fresh = async (code: string, lots: [number, number][] = [[10, 5], [10, 6]]) => {
  const r = await api(admin, "POST", "/catalog/products", { code, name: `Producto ${code}`, baseUnitId: UND });
  assert.equal(r.status, 201);
  assert.equal((await call("PUT", `/api/v1/pricing/lists/${L1}/prices/${r.json.id}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } })).status, 200);
  for (const [quantity, unitCost] of lots) await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: r.json.id, quantity, unitCost }] });
  return r.json.id as string;
};
const reserve = (productId: string, quantity: number, extra: object = {}, token = admin, warehouseId = W1) =>
  api(token, "POST", "/inventory/reservations", { warehouseId, lines: [{ productId, quantity }], ...extra });
const sellDraft = async (productId: string, quantity: number, extra: object = {}) => {
  const d = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CUST, lines: [{ productId, quantity }], ...extra });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  return d.json;
};
const confirm = (id: string) => api(admin, "POST", `/sales/orders/${id}/confirm`, { payments: [] });
const reconciled = async () => { const r = (await api(admin, "GET", "/inventory/reconciliation")).json; return [r.balances.length, r.valuations.length]; };

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  [admin, adminB, manager, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local")]);
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  W3 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a3, code: "W3", name: "Sur" })).json.id;
  L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  CUST = (await api(admin, "POST", "/sales/customers", { name: "Cliente", taxId: "1" })).json.id;
});
afterEach(() => clock.set(null)); // un fallo no debe dejar el reloj adelantado para las demás pruebas
after(async () => { clock.set(null); await teardown(); });

describe("reservar y liberar", () => {
  it("aparta por lote sin sacar nada: baja lo disponible, no lo físico", async () => {
    const p = await fresh("R1");
    const r = await reserve(p, 15, { note: "Pedido especial" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.code, /^RS-\d{6}$/);
    assert.equal(r.json.status, "ACTIVE");
    assert.deepEqual(r.json.lines.map((l: { quantity: string }) => l.quantity), ["10", "5"], "10 del lote más antiguo y 5 del siguiente");
    assert.deepEqual(await levels(p), ["20", "15", "5"]);
    const lots = (await api(admin, "GET", `/inventory/stock/lots?productId=${p}&warehouseId=${W1}`)).json;
    assert.deepEqual(lots.map((l: { reservedQty: string; availableQty: string }) => [l.reservedQty, l.availableQty]), [["10", "0"], ["5", "5"]]);
    assert.deepEqual(await reconciled(), [0, 0], "el libro de movimientos no se toca");
  });

  it("no se reserva más de lo disponible y no queda nada apartado a medias", async () => {
    const p = await fresh("R2");
    await reserve(p, 15);
    const over = await reserve(p, 6);
    assert.equal(over.status, 409); assert.equal(over.json.code, "INSUFFICIENT_STOCK");
    assert.deepEqual(await levels(p), ["20", "15", "5"]);
    const two = await api(admin, "POST", "/inventory/reservations", { warehouseId: W1, lines: [{ productId: p, quantity: 3 }, { productId: await fresh("R2B"), quantity: 99 }] });
    assert.equal(two.status, 409);
    assert.deepEqual(await levels(p), ["20", "15", "5"], "la primera línea tampoco se apartó");
  });

  it("otra venta no puede llevarse lo reservado, pero sí lo que queda libre", async () => {
    const p = await fresh("R3");
    await reserve(p, 15);
    const blocked = await confirm((await sellDraft(p, 6)).id);
    assert.equal(blocked.status, 409); assert.equal(blocked.json.code, "INSUFFICIENT_STOCK");
    const ok = await confirm((await sellDraft(p, 5)).id);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(await levels(p), ["15", "15", "0"]);
  });

  it("una transferencia o un ajuste de baja tampoco tocan lo reservado", async () => {
    const p = await fresh("R4");
    await reserve(p, 15);
    const t = (await api(admin, "POST", "/inventory/transfers", { fromWarehouseId: W1, toWarehouseId: W3, lines: [{ productId: p, quantity: 6 }] })).json;
    assert.equal((await api(admin, "POST", `/inventory/transfers/${t.id}/dispatch`)).json.code, "INSUFFICIENT_STOCK");
    const adj = await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Merma", lines: [{ productId: p, quantity: -6 }] });
    assert.equal(adj.json.code, "INSUFFICIENT_STOCK");
  });

  it("liberar devuelve lo apartado; no se libera dos veces ni en paralelo", async () => {
    const p = await fresh("R5");
    const r = (await reserve(p, 12)).json;
    const rel = await api(admin, "POST", `/inventory/reservations/${r.id}/release`);
    assert.deepEqual([rel.status, rel.json.status], [200, "RELEASED"]);
    assert.ok(rel.json.closedAt);
    assert.deepEqual(await levels(p), ["20", "0", "20"]);
    assert.equal((await api(admin, "POST", `/inventory/reservations/${r.id}/release`)).json.code, "INVALID_STATE");
    const r2 = (await reserve(p, 4)).json;
    const rs = await Promise.all([1, 2].map(() => api(admin, "POST", `/inventory/reservations/${r2.id}/release`)));
    assert.deepEqual(rs.map((x) => x.status).sort(), [200, 409]);
    assert.deepEqual(await levels(p), ["20", "0", "20"], "se liberó una sola vez (no queda negativo ni doble)");
  });

  it("valida productos, cantidades, vigencia y almacén", async () => {
    const p = await fresh("R6");
    const sv = (await api(admin, "POST", "/catalog/products", { baseUnitId: UND, code: "R6S", name: "Servicio", kind: "SERVICE" })).json.id;
    assert.equal((await reserve(sv, 1)).json.code, "NOT_STOCKABLE");
    assert.equal((await reserve(p, 1.5)).json.code, "INVALID_QUANTITY");
    assert.equal((await reserve(p, 0)).status, 400);
    assert.equal((await reserve(p, 1, { hours: 0 })).status, 400);
    assert.equal((await reserve(p, 1, { hours: 9999 })).status, 400);
    assert.equal((await api(admin, "POST", "/inventory/reservations", { warehouseId: W1, lines: [{ productId: p, quantity: 1 }, { productId: p, quantity: 2 }] })).json.code, "DUPLICATE_PRODUCT");
    assert.equal((await api(admin, "POST", "/inventory/reservations", { warehouseId: W1, lines: [] })).status, 400);
    assert.equal((await reserve(p, 1, {}, admin, "00000000-0000-4000-8000-000000000000")).status, 404);
  });

  it("alcance y permisos: el gerente no reserva en A3; el cajero no reserva; B no ve nada", async () => {
    const p = await fresh("R7");
    assert.equal((await reserve(p, 1, {}, manager, W3)).status, 403);
    assert.equal((await reserve(p, 1, {}, cashier)).status, 403);
    const r = (await reserve(p, 2, {}, manager)).json;
    assert.equal(r.status, "ACTIVE");
    assert.equal((await api(adminB, "GET", `/inventory/reservations/${r.id}`)).status, 404);
    assert.equal((await api(adminB, "POST", `/inventory/reservations/${r.id}/release`)).status, 404);
    assert.deepEqual((await api(adminB, "GET", "/inventory/reservations")).json, []);
    assert.ok((await api(admin, "GET", "/inventory/reservations?status=ACTIVE")).json.every((x: { status: string }) => x.status === "ACTIVE"));
  });
});

describe("vencimiento", () => {
  it("al vencer, lo apartado vuelve a estar disponible (se ve al consultar existencias)", async () => {
    const p = await fresh("V1");
    const r = (await reserve(p, 20, { hours: 24 })).json;
    assert.deepEqual(await levels(p), ["20", "20", "0"]);
    clock.set(hours(25));
    assert.deepEqual(await levels(p), ["20", "0", "20"], "vencida: ya no aparta");
    assert.deepEqual([(await api(admin, "GET", `/inventory/reservations/${r.id}`)).json.status], ["EXPIRED"]);
    assert.equal((await api(admin, "POST", `/inventory/reservations/${r.id}/release`)).json.code, "INVALID_STATE");
    clock.set(null);
  });

  it("una venta que necesita ese stock lo libera sola al vencer la reserva (sin que nadie consulte nada)", async () => {
    const p = await fresh("V2");
    await reserve(p, 20, { hours: 1 });
    const blocked = await confirm((await sellDraft(p, 1)).id);
    assert.equal(blocked.json.code, "INSUFFICIENT_STOCK", "mientras está vigente, nadie lo toca");
    clock.set(hours(2));
    const ok = await confirm((await sellDraft(p, 20)).id);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    clock.set(null);
    assert.deepEqual(await levels(p), ["0", "0", "0"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("reservar de nuevo tras el vencimiento funciona", async () => {
    const p = await fresh("V3");
    await reserve(p, 20, { hours: 1 });
    clock.set(hours(2));
    assert.equal((await reserve(p, 20, { hours: 5 })).status, 201);
    clock.set(null);
  });
});

describe("reserva de una cotización", () => {
  const mkQuote = async (productId: string, quantity: number, accepted = true) => {
    const q = (await api(admin, "POST", "/sales/quotes", { branchId: world.a1, customerId: CUST, validUntil: isoDay(5), lines: [{ productId, quantity }] })).json;
    await api(admin, "POST", `/sales/quotes/${q.id}/send`);
    if (accepted) await api(admin, "POST", `/sales/quotes/${q.id}/accept`);
    return q;
  };
  const reserveQuote = (id: string, extra: object = {}) => api(admin, "POST", `/sales/quotes/${id}/reserve`, { warehouseId: W1, ...extra });

  it("reserva el stock de la cotización, la muestra en su detalle y no permite duplicarla", async () => {
    const p = await fresh("Q1");
    const q = await mkQuote(p, 8);
    const r = await reserveQuote(q.id);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.reservation.status, r.json.reservation.code.startsWith("RS-")], ["ACTIVE", true]);
    assert.deepEqual(await levels(p), ["20", "8", "12"]);
    assert.equal((await reserveQuote(q.id)).json.code, "ALREADY_RESERVED");
    assert.deepEqual(await levels(p), ["20", "8", "12"]);
    const expires = new Date(r.json.reservation.expiresAt).getTime();
    assert.ok(expires <= Date.now() + 48 * 3_600_000 + 60_000, "48 h por defecto");
  });

  it("la vigencia de la reserva nunca pasa del fin de la cotización", async () => {
    const p = await fresh("Q2");
    const q = (await api(admin, "POST", "/sales/quotes", { branchId: world.a1, customerId: CUST, validUntil: isoDay(1), lines: [{ productId: p, quantity: 1 }] })).json;
    await api(admin, "POST", `/sales/quotes/${q.id}/send`);
    const r = await reserveQuote(q.id, { hours: 720 });
    assert.ok(new Date(r.json.reservation.expiresAt).getTime() <= Date.now() + 2 * 86_400_000, "limitada por validUntil");
  });

  it("solo se reserva una cotización enviada o aceptada, vigente y sin convertir", async () => {
    const p = await fresh("Q3");
    const draft = (await api(admin, "POST", "/sales/quotes", { branchId: world.a1, customerId: CUST, validUntil: isoDay(5), lines: [{ productId: p, quantity: 1 }] })).json;
    assert.equal((await reserveQuote(draft.id)).json.code, "INVALID_STATE");
    const q = await mkQuote(p, 1);
    await api(admin, "POST", `/sales/quotes/${q.id}/convert`, { warehouseId: W1 });
    assert.equal((await reserveQuote(q.id)).json.code, "ALREADY_CONVERTED");
  });

  it("no se reserva más de lo disponible", async () => {
    const p = await fresh("Q4");
    await reserve(p, 18);
    const q = await mkQuote(p, 5);
    assert.equal((await reserveQuote(q.id)).json.code, "INSUFFICIENT_STOCK");
  });

  it("cancelar o rechazar la cotización libera la reserva", async () => {
    const p = await fresh("Q5");
    const a = await mkQuote(p, 6); await reserveQuote(a.id);
    assert.deepEqual(await levels(p), ["20", "6", "14"]);
    await api(admin, "POST", `/sales/quotes/${a.id}/cancel`);
    assert.deepEqual(await levels(p), ["20", "0", "20"]);
    assert.equal((await api(admin, "GET", `/sales/quotes/${a.id}`)).json.reservation.status, "RELEASED");
    const b = await mkQuote(p, 7, false); await reserveQuote(b.id);
    await api(admin, "POST", `/sales/quotes/${b.id}/reject`);
    assert.deepEqual(await levels(p), ["20", "0", "20"]);
  });

  it("al confirmar la venta de la cotización se CONSUME la reserva: la propia venta se lleva el stock apartado", async () => {
    const p = await fresh("Q6", [[10, 5]]);
    const q = await mkQuote(p, 10); // reserva TODO el stock
    await reserveQuote(q.id);
    assert.deepEqual(await levels(p), ["10", "10", "0"]);
    const other = await confirm((await sellDraft(p, 1)).id);
    assert.equal(other.json.code, "INSUFFICIENT_STOCK", "otro cliente no puede");
    const sale = (await api(admin, "POST", `/sales/quotes/${q.id}/convert`, { warehouseId: W1 })).json;
    const done = await confirm(sale.id);
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.deepEqual(await levels(p), ["0", "0", "0"]);
    const detail = (await api(admin, "GET", `/sales/quotes/${q.id}`)).json;
    assert.equal(detail.reservation.status, "CONSUMED");
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("la reserva de cotización vencida se libera sola", async () => {
    const p = await fresh("Q8");
    const q = await mkQuote(p, 20);
    await reserveQuote(q.id, { hours: 1 });
    clock.set(hours(2));
    assert.deepEqual(await levels(p), ["20", "0", "20"]);
    clock.set(null);
  });
});

describe("concurrencia e integridad", () => {
  it("dos reservas simultáneas que juntas exceden lo disponible: solo una pasa", async () => {
    const p = await fresh("C1");
    const rs = await Promise.all([reserve(p, 15), reserve(p, 15)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.deepEqual(await levels(p), ["20", "15", "5"]);
  });

  it("una reserva y una venta a la vez sobre lo mismo: nunca se vende ni se aparta lo mismo dos veces", async () => {
    const p = await fresh("C2", [[10, 5]]);
    const d = await sellDraft(p, 10);
    const [a, b] = await Promise.all([reserve(p, 10), confirm(d.id)]);
    const lv = await levels(p);
    assert.ok(Number(lv[1]) <= Number(lv[0]), `reservado ${lv[1]} no puede superar el físico ${lv[0]}`);
    assert.ok(!(a.status === 201 && b.status === 200), "no se aparta y se vende lo mismo a la vez");
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("la base impide que lo reservado supere lo físico", async () => {
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE stock_balance SET reserved_qty = physical_qty + 1 WHERE id = (SELECT id FROM stock_balance LIMIT 1)`)), /check|restricci/i);
  });

  it("todo queda auditado", async () => {
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    for (const a of ["reservation.created", "reservation.released"]) assert.ok(acts.has(a), a);
  });
});
