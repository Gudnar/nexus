import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDb, withTenant } from "@erp/db";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string;
let W1: string, UND: string, L1: string, GRAV: string, CUST: string;

type M = "GET" | "POST" | "PATCH" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });
const isoDay = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const stock = async (productId: string) => {
  const [row] = (await api(admin, "GET", `/inventory/stock?productId=${productId}&warehouseId=${W1}`)).json.items;
  return row ? [row.physicalQty, row.value] : ["0", "0"];
};
/** Producto gravado (IVA 13 %) con precio de lista 10 y lotes de entrada [cantidad, costo]. */
const fresh = async (code: string, lots: [number, number][], price = 10) => {
  const r = await api(admin, "POST", "/catalog/products", { code, name: `Producto ${code}`, baseUnitId: UND, taxProfileId: GRAV });
  assert.equal(r.status, 201);
  assert.equal((await api(admin, "PUT", `/pricing/lists/${L1}/prices/${r.json.id}`, { tiers: [{ minQuantity: 1, unitPrice: price }] })).status, 200);
  for (const [quantity, unitCost] of lots) await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: r.json.id, quantity, unitCost }] });
  return r.json.id as string;
};
const sell = async (lines: object[], payments: object[] = [], extra: object = {}, token = admin) => {
  const d = await api(token, "POST", "/sales/orders", { warehouseId: W1, lines, ...extra });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  const c = await api(token, "POST", `/sales/orders/${d.json.id}/confirm`, { payments });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  return c.json;
};
const giveBack = (saleId: string, lines: object[], extra: object = {}, token = admin) => api(token, "POST", `/sales/orders/${saleId}/returns`, { reason: "Devolución de prueba", lines, ...extra });
const getSale = async (id: string) => (await api(admin, "GET", `/sales/orders/${id}`)).json;
const reconciled = async () => { const r = (await api(admin, "GET", "/inventory/reconciliation")).json; return [r.balances.length, r.valuations.length]; };

before(async () => {
  await setup();
  [admin, adminB, manager, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local")]);
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  const iva = (await api(admin, "POST", "/taxes/codes", { code: "IVA", name: "IVA", rate: { rate: 13, validFrom: "2020-01-01" } })).json.id;
  GRAV = (await api(admin, "POST", "/taxes/profiles", { code: "GRAV", name: "Gravado", rules: [{ taxCodeId: iva }] })).json.id;
  L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  CUST = (await api(admin, "POST", "/sales/customers", { name: "Cliente Uno", taxId: "1" })).json.id;
});
after(teardown);

describe("sobreprecio con motivo", () => {
  it("cambia el precio unitario con permiso y motivo; la foto conserva el precio de lista y el aplicado", async () => {
    const p = await fresh("OV1", [[20, 5]]);
    const s = (await api(admin, "POST", "/sales/orders", { warehouseId: W1, lines: [{ productId: p, quantity: 2, unitPrice: 7, overrideReason: "Cliente frecuente" }] })).json;
    const l = s.lines[0];
    assert.deepEqual([l.listUnitPrice, l.appliedUnitPrice, l.overrideReason, l.netAmount, l.taxAmount, l.totalAmount], ["10", "7", "Cliente frecuente", "14", "1.82", "15.82"]);
    assert.deepEqual([s.total, s.discountTotal], ["15.82", "0"], "un precio menor no cuenta como descuento");
  });
  it("exige permiso y motivo; se puede subir sobre la lista; se combina con descuento", async () => {
    const p = await fresh("OV2", [[20, 5]]);
    const mk = (token: string, line: object) => api(token, "POST", "/sales/orders", { warehouseId: W1, lines: [{ productId: p, quantity: 1, ...line }] });
    assert.equal((await mk(cashier, { unitPrice: 5, overrideReason: "x y z" })).json.code, "OVERRIDE_FORBIDDEN");
    assert.equal((await mk(admin, { unitPrice: 5 })).status, 400, "sin motivo");
    assert.equal((await mk(admin, { overrideReason: "solo motivo" })).status, 400, "motivo sin precio");
    assert.equal((await mk(admin, { unitPrice: -1, overrideReason: "negativo" })).status, 400);
    const up = (await mk(admin, { unitPrice: 15, overrideReason: "Pedido urgente" })).json;
    assert.equal(up.lines[0].netAmount, "15");
    const combo = (await mk(admin, { unitPrice: 20, overrideReason: "Precio acordado", discountPct: 10 })).json;
    assert.deepEqual([combo.lines[0].netAmount, combo.discountTotal], ["18", "2.26"], "20 − 10 % = 18; descuento = 22,60 − 20,34");
  });
  it("el sobreprecio sobrevive a editar el borrador y a la confirmación (no vuelve al precio de lista), también si confirma otro usuario", async () => {
    const p = await fresh("OV3", [[20, 5]]);
    const d = (await api(admin, "POST", "/sales/orders", { warehouseId: W1, lines: [{ productId: p, quantity: 2, unitPrice: 7, overrideReason: "Negociado", discountPct: 5 }] })).json;
    const e = await api(admin, "PATCH", `/sales/orders/${d.id}`, { note: "con nota" });
    assert.equal(e.json.lines[0].appliedUnitPrice, "7");
    const c = await api(cashier, "POST", `/sales/orders/${d.id}/confirm`, { payments: [] }); // el cajero no tiene permisos de descuento ni de sobreprecio
    assert.equal(c.status, 409, "sin cliente no hay crédito, pero NO falla por permisos");
    assert.equal(c.json.code, "CUSTOMER_REQUIRED_FOR_CREDIT");
    const ok = await api(cashier, "POST", `/sales/orders/${d.id}/confirm`, { payments: [{ method: "CASH", amount: 15.03 }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual([ok.json.lines[0].appliedUnitPrice, ok.json.lines[0].overrideReason, ok.json.lines[0].discountPct], ["7", "Negociado", "5"]);
  });
  it("una cotización con sobreprecio lo conserva al convertirse en venta", async () => {
    const p = await fresh("OV4", [[20, 5]]);
    const q = (await api(admin, "POST", "/sales/quotes", { branchId: world.a1, customerId: CUST, validUntil: isoDay(5), lines: [{ productId: p, quantity: 1, unitPrice: 6, overrideReason: "Oferta" }] })).json;
    await api(admin, "POST", `/sales/quotes/${q.id}/send`); await api(admin, "POST", `/sales/quotes/${q.id}/accept`);
    const sale = (await api(admin, "POST", `/sales/quotes/${q.id}/convert`, { warehouseId: W1 })).json;
    assert.deepEqual([sale.lines[0].appliedUnitPrice, sale.lines[0].overrideReason, sale.total], ["6", "Oferta", "6.78"]);
  });
  it("la base exige motivo cuando hay precio cambiado a mano", async () => {
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE sale_line SET applied_unit_price = 1, override_reason = NULL WHERE sale_id IN (SELECT id FROM sale WHERE status = 'DRAFT')`)), /check|restricci/i);
  });
});

describe("devoluciones parciales", () => {
  it("devolver 1 de 4 reintegra el dinero (con método), reingresa el stock a su lote y deja la venta como foto", async () => {
    const p = await fresh("D1", [[20, 5], [20, 6]]);
    const sale = await sell([{ productId: p, quantity: 4 }], [{ method: "CASH", amount: 45.2 }]);
    assert.equal(sale.total, "45.2");
    assert.deepEqual(await stock(p), ["36", "200"]);
    const noMethod = await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 1 }]);
    assert.equal(noMethod.status, 409); assert.equal(noMethod.json.code, "REFUND_METHOD_REQUIRED");
    assert.deepEqual(await stock(p), ["36", "200"], "nada cambió");
    const r = await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 1 }], { refund: { method: "CASH" } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.code, /^DV-\d{6}$/);
    assert.deepEqual([r.json.netTotal, r.json.taxTotal, r.json.total, r.json.refundTotal], ["10", "1.3", "11.3", "11.3"]);
    assert.deepEqual(await stock(p), ["37", "205"], "vuelve 1 unidad al costo original (5)");
    const after = await getSale(sale.id);
    assert.deepEqual([after.total, after.returnedTotal, after.refundedTotal, after.paymentStatus, after.balance], ["45.2", "11.3", "11.3", "PAID", "0"]);
    assert.deepEqual([after.lines[0].returnedQty, after.returns.length, after.returns[0].code], ["1", 1, r.json.code]);
    const k = (await api(admin, "GET", `/inventory/kardex?productId=${p}&limit=1`)).json.items[0];
    assert.deepEqual([k.type, k.quantity, k.reasonCode, k.unitCost], ["ADJUSTMENT_IN", "1", "SALE_RETURN", "5"]);
  });

  it("devolver lo que queda: la última parte absorbe el redondeo y no se devuelve de más", async () => {
    const p = await fresh("D2", [[20, 5]]);
    const sale = await sell([{ productId: p, quantity: 4 }], [{ method: "CASH", amount: 45.2 }]);
    await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 1 }], { refund: { method: "CASH" } });
    const rest = await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 3 }], { refund: { method: "TRANSFER", reference: "T-9" } });
    assert.deepEqual([rest.json.total, rest.json.refundTotal], ["33.9", "33.9"]);
    const after = await getSale(sale.id);
    assert.deepEqual([after.returnedTotal, after.refundedTotal, after.paymentStatus, after.balance], ["45.2", "45.2", "PAID", "0"]);
    const over = await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 1 }], { refund: { method: "CASH" } });
    assert.equal(over.status, 409); assert.equal(over.json.code, "OVER_RETURN");
    assert.deepEqual(await stock(p), ["20", "100"], "todo volvió");
  });

  it("venta a crédito: la devolución reduce la deuda sin reintegrar dinero, y el saldo restante se cobra", async () => {
    const p = await fresh("D3", [[20, 5]]);
    const sale = await sell([{ productId: p, quantity: 5 }], [], { customerId: CUST });
    assert.deepEqual([sale.paymentStatus, sale.balance], ["UNPAID", "56.5"]);
    const r = await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 2 }]);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.refundTotal, "0");
    const a = await getSale(sale.id);
    assert.deepEqual([a.balance, a.returnedTotal, a.paymentStatus], ["33.9", "22.6", "UNPAID"]);
    assert.equal((await api(admin, "GET", `/sales/customers/${CUST}`)).json.outstanding, "33.9");
    assert.equal((await api(admin, "POST", `/sales/orders/${sale.id}/payments`, { method: "CASH", amount: 40 })).json.code, "OVERPAYMENT", "el tope es el saldo neto");
    const paid = await api(admin, "POST", `/sales/orders/${sale.id}/payments`, { method: "CASH", amount: 33.9 });
    assert.deepEqual([paid.json.paymentStatus, paid.json.balance], ["PAID", "0"]);
    assert.equal((await api(admin, "GET", `/sales/customers/${CUST}`)).json.outstanding, "0");
  });

  it("con cobro parcial: primero se baja la deuda y solo se reintegra lo cobrado de más", async () => {
    const p = await fresh("D4", [[20, 5]]);
    const sale = await sell([{ productId: p, quantity: 10 }], [{ method: "CASH", amount: 50 }], { customerId: CUST }); // total 113, cobrado 50
    const r1 = await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 5 }]);
    assert.equal(r1.status, 201, JSON.stringify(r1.json));
    assert.deepEqual([r1.json.total, r1.json.refundTotal], ["56.5", "0"], "sigue debiendo 6,5: no hay nada que reintegrar");
    assert.deepEqual([(await getSale(sale.id)).balance, (await getSale(sale.id)).paymentStatus], ["6.5", "PARTIAL"]);
    assert.equal((await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 5 }])).json.code, "REFUND_METHOD_REQUIRED", "ahora hay 50 cobrados y 0 por pagar");
    const r2 = await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 5 }], { refund: { method: "QR" } });
    assert.deepEqual([r2.json.total, r2.json.refundTotal], ["56.5", "50"]);
    const a = await getSale(sale.id);
    assert.deepEqual([a.returnedTotal, a.refundedTotal, a.paymentStatus, a.balance], ["113", "50", "PAID", "0"]);
  });

  it("el stock vuelve a los lotes de los que salió, al costo original de cada uno, aunque la venta haya usado dos lotes", async () => {
    const p = await fresh("D5", [[20, 5], [20, 6]]);
    const sale = await sell([{ productId: p, quantity: 25 }], [], { customerId: CUST }); // lote A 20 @5 + lote B 5 @6
    assert.deepEqual(sale.lines[0].lots.map((l: { quantity: string; unitCost: string }) => [l.quantity, l.unitCost]), [["20", "5"], ["5", "6"]]);
    assert.deepEqual(await stock(p), ["15", "90"]);
    await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 10 }]);
    assert.deepEqual(await stock(p), ["25", "140"], "10 u. al costo 5");
    await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 12 }]); // 10 del lote A y 2 del B
    assert.deepEqual(await stock(p), ["37", "202"], "10×5 + 2×6");
    await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 3 }]);
    assert.deepEqual(await stock(p), ["40", "220"], "= el stock inicial: 20×5 + 20×6");
    assert.equal((await api(admin, "GET", `/inventory/stock/lots?productId=${p}&warehouseId=${W1}`)).json.length, 2, "los lotes no se duplican");
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("varias líneas en una devolución, servicios sin stock, y todo o nada", async () => {
    const a = await fresh("D6A", [[10, 5]]); const b = await fresh("D6B", [[10, 5]]);
    const sv = (await api(admin, "POST", "/catalog/products", { baseUnitId: UND, code: "D6S", name: "Servicio", kind: "SERVICE" })).json.id;
    await api(admin, "PUT", `/pricing/lists/${L1}/prices/${sv}`, { tiers: [{ minQuantity: 1, unitPrice: 100 }] });
    const sale = await sell([{ productId: a, quantity: 2 }, { productId: b, quantity: 2 }, { productId: sv, quantity: 1 }], [], { customerId: CUST });
    const ln = (code: string) => sale.lines.find((l: { productCode: string }) => l.productCode === code).id;
    const bad = await giveBack(sale.id, [{ saleLineId: ln("D6A"), quantity: 1 }, { saleLineId: ln("D6B"), quantity: 5 }]);
    assert.equal(bad.status, 409);
    assert.deepEqual(await stock(a), ["8", "40"], "la primera línea tampoco se devolvió");
    const ok = await giveBack(sale.id, [{ saleLineId: ln("D6A"), quantity: 1 }, { saleLineId: ln("D6S"), quantity: 1 }]);
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.lines.length, 2);
    assert.deepEqual(await stock(a), ["9", "45"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("valida líneas ajenas, repetidas, decimales y estado de la venta", async () => {
    const p = await fresh("D7", [[10, 5]]);
    const sale = await sell([{ productId: p, quantity: 2 }], [], { customerId: CUST });
    const other = await sell([{ productId: p, quantity: 1 }], [], { customerId: CUST });
    assert.equal((await giveBack(sale.id, [{ saleLineId: other.lines[0].id, quantity: 1 }])).json.code, "LINE_NOT_FOUND");
    assert.equal((await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 1 }, { saleLineId: sale.lines[0].id, quantity: 1 }])).json.code, "DUPLICATE_LINE");
    assert.equal((await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 0.5 }])).json.code, "INVALID_QUANTITY");
    assert.equal((await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 0 }])).status, 400);
    assert.equal((await giveBack(sale.id, [])).status, 400);
    const draft = (await api(admin, "POST", "/sales/orders", { warehouseId: W1, lines: [{ productId: p, quantity: 1 }] })).json;
    assert.equal((await giveBack(draft.id, [{ saleLineId: draft.lines[0].id, quantity: 1 }])).json.code, "INVALID_STATE");
  });
});

describe("restricciones de las devoluciones", () => {
  it("una venta con devoluciones ya no se anula completa", async () => {
    const p = await fresh("R1", [[10, 5]]);
    const sale = await sell([{ productId: p, quantity: 2 }], [], { customerId: CUST });
    await giveBack(sale.id, [{ saleLineId: sale.lines[0].id, quantity: 1 }]);
    assert.equal((await api(admin, "POST", `/sales/orders/${sale.id}/void`, { reason: "intento" })).json.code, "HAS_RETURNS");
  });
  it("se anula una venta cuyo cobro fue reintegrado por completo", async () => {
    const p = await fresh("R2", [[10, 5]]);
    const sale = await sell([{ productId: p, quantity: 1 }], [{ method: "CASH", amount: 11.3 }]);
    assert.equal((await api(admin, "POST", `/sales/orders/${sale.id}/void`, { reason: "intento" })).json.code, "HAS_PAYMENTS");
  });
  it("permisos y alcance: el cajero no devuelve; el gerente sí; B no ve nada", async () => {
    const p = await fresh("R3", [[10, 5]]);
    const sale = await sell([{ productId: p, quantity: 2 }], [], { customerId: CUST });
    const line = [{ saleLineId: sale.lines[0].id, quantity: 1 }];
    assert.equal((await giveBack(sale.id, line, {}, cashier)).status, 403);
    const m = await giveBack(sale.id, line, {}, manager);
    assert.equal(m.status, 201, JSON.stringify(m.json));
    assert.equal((await giveBack(sale.id, line, {}, adminB)).status, 404);
    assert.equal((await api(adminB, "GET", `/sales/returns/${m.json.id}`)).status, 404);
    assert.deepEqual((await api(adminB, "GET", "/sales/returns")).json, []);
    assert.equal((await api(cashier, "GET", `/sales/returns/${m.json.id}`)).status, 200, "el cajero puede consultar");
  });
  it("dos devoluciones simultáneas de lo mismo: solo una prospera", async () => {
    const p = await fresh("R4", [[10, 5]]);
    const sale = await sell([{ productId: p, quantity: 2 }], [], { customerId: CUST });
    const line = [{ saleLineId: sale.lines[0].id, quantity: 2 }];
    const rs = await Promise.all([giveBack(sale.id, line), giveBack(sale.id, line)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.deepEqual(await stock(p), ["10", "50"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });
  it("lista y detalle de devoluciones con sus líneas", async () => {
    const list = (await api(admin, "GET", "/sales/returns")).json;
    assert.ok(list.length >= 5);
    const one = (await api(admin, "GET", `/sales/returns/${list[0].id}`)).json;
    assert.ok(one.lines.length >= 1 && one.saleCode.startsWith("V-"));
    const bySale = (await api(admin, "GET", `/sales/returns?saleId=${one.saleId}`)).json;
    assert.ok(bySale.every((r: { saleId: string }) => r.saleId === one.saleId));
  });
  it("la base: las notas de crédito y reembolsos no se editan ni se borran; lo devuelto no supera lo vendido", async () => {
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of ["DELETE FROM sale_return", "DELETE FROM sale_return_line", "DELETE FROM refund", "UPDATE sale_return SET total = 1", "UPDATE refund SET amount = 1"]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
    } finally { await app.$disconnect(); }
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE sale SET returned_total = total + 1 WHERE status = 'CONFIRMED'`)), /check|restricci/i);
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE sale SET refunded_total = paid_total + 1 WHERE status = 'CONFIRMED'`)), /check|restricci/i);
  });
  it("la conciliación cuadra y todo queda auditado", async () => {
    assert.deepEqual(await reconciled(), [0, 0]);
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    assert.ok(acts.has("sale.returned"));
  });
});
