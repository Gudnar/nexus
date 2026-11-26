import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addMember, createDb, withTenant } from "@erp/db";
import { PasswordService } from "../src/auth/password.service";
import { Clock } from "../src/access/clock";
import { call, owner, PW, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string, clock: Clock;
let W1: string, W3: string, UND: string;
let L1: string, L2: string, LUSD: string;
let P1: string, P2: string, P3: string, PEX: string, PSV: string, PUSD: string;
let CUST: string, CRED: string;

type M = "GET" | "POST" | "PATCH" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });
const isoDay = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const stock = async (productId: string, warehouseId = W1) => {
  const [row] = (await api(admin, "GET", `/inventory/stock?productId=${productId}&warehouseId=${warehouseId}`)).json.items;
  return row ? [row.physicalQty, row.value] : ["0", "0"];
};
const draft = async (lines: object[], extra: object = {}, token = admin, warehouseId = W1) => {
  const r = await api(token, "POST", "/sales/orders", { warehouseId, lines, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const confirm = (id: string, payments: object[] = [], token = admin) => api(token, "POST", `/sales/orders/${id}/confirm`, { payments });
const product = async (body: object) => { const r = await api(admin, "POST", "/catalog/products", { baseUnitId: UND, ...body }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id as string; };
const setPrice = async (listId: string, productId: string, tiers: object[]) => assert.equal((await api(admin, "PUT", `/pricing/lists/${listId}/prices/${productId}`, { tiers })).status, 200);
const reconciled = async () => { const r = (await api(admin, "GET", "/inventory/reconciliation")).json; return [r.balances.length, r.valuations.length]; };

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  [admin, adminB, manager, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local")]);
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  W3 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a3, code: "W3", name: "Sur" })).json.id;

  // Impuestos: IVA 13 % y dos perfiles (gravado / exento con motivo).
  const iva = (await api(admin, "POST", "/taxes/codes", { code: "IVA", name: "IVA", rate: { rate: 13, validFrom: "2020-01-01" } })).json.id;
  const gravado = (await api(admin, "POST", "/taxes/profiles", { code: "GRAV", name: "Gravado", rules: [{ taxCodeId: iva }] })).json.id;
  const exento = (await api(admin, "POST", "/taxes/profiles", { code: "EXEN", name: "Exento", rules: [{ taxCodeId: iva, exemptionReason: "Exportación" }] })).json.id;

  P1 = await product({ code: "P1", name: "Producto gravado", taxProfileId: gravado });
  P2 = await product({ code: "P2", name: "Producto sin impuesto" });
  P3 = await product({ code: "P3", name: "Producto con precio IVA incluido", taxProfileId: gravado });
  PEX = await product({ code: "PEX", name: "Producto exento", taxProfileId: exento });
  PSV = await product({ code: "PSV", name: "Servicio", kind: "SERVICE" });
  PUSD = await product({ code: "PUSD", name: "Producto en dólares" });

  L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  L2 = (await api(admin, "POST", "/pricing/lists", { code: "IVAINC", name: "IVA incluido", priceMode: "WITH_TAX", priority: -1 })).json.id;
  LUSD = (await api(admin, "POST", "/pricing/lists", { code: "USD", name: "Dólares", priceMode: "WITHOUT_TAX", currency: "USD", priority: -2 })).json.id;
  await setPrice(L1, P1, [{ minQuantity: 1, maxQuantity: 10, unitPrice: 10 }, { minQuantity: 10, unitPrice: 8 }]);
  await setPrice(L1, P2, [{ minQuantity: 1, unitPrice: 20 }]);
  await setPrice(L1, PEX, [{ minQuantity: 1, unitPrice: 50 }]);
  await setPrice(L1, PSV, [{ minQuantity: 1, unitPrice: 100 }]);
  await setPrice(L2, P3, [{ minQuantity: 1, unitPrice: 113 }]);
  await setPrice(LUSD, PUSD, [{ minQuantity: 1, unitPrice: 5 }]);

  const adj = (productId: string, quantity: number, unitCost: number) => api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId, quantity, unitCost }] });
  await adj(P1, 50, 5); await adj(P1, 50, 6); await adj(P2, 20, 3); await adj(P3, 10, 40); await adj(PEX, 10, 20); await adj(PUSD, 10, 1);

  CUST = (await api(admin, "POST", "/sales/customers", { name: "Cliente Uno", taxId: "1020304" })).json.id;
  CRED = (await api(admin, "POST", "/sales/customers", { name: "Cliente a crédito", taxId: "999", creditLimit: 100, paymentTermsDays: 30 })).json.id;
});
after(async () => { clock.set(null); await teardown(); });

describe("clientes", () => {
  it("código automático correlativo, NIT único sin distinguir mayúsculas y datos normalizados", async () => {
    const r = await api(admin, "POST", "/sales/customers", { name: "Con datos", taxId: " ABC-1 ", email: " VENTAS@X.COM ", creditLimit: 500 });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.code, /^C-\d{6}$/);
    assert.deepEqual([r.json.taxId, r.json.email, r.json.creditLimit, r.json.outstanding], ["ABC-1", "ventas@x.com", "500", "0"]);
    assert.equal((await api(admin, "POST", "/sales/customers", { name: "Otro", taxId: "abc-1" })).json.code, "DUPLICATE_CUSTOMER");
    assert.equal((await api(adminB, "POST", "/sales/customers", { name: "En B", taxId: "abc-1" })).status, 201, "el NIT solo es único dentro de una empresa");
    assert.equal((await api(admin, "POST", "/sales/customers", { name: "X", email: "no-es-correo" })).status, 400);
  });
  it("lista con búsqueda; permisos; la empresa B no ve los de A", async () => {
    assert.ok((await api(admin, "GET", "/sales/customers?q=uno")).json.some((c: { name: string }) => c.name === "Cliente Uno"));
    assert.equal((await api(cashier, "GET", "/sales/customers")).status, 200, "el cajero consulta clientes");
    // El cajero registra clientes desde el punto de venta; quien solo audita no.
    assert.equal((await api(cashier, "POST", "/sales/customers", { name: "Cliente de mostrador" })).status, 201);
    await addMember(owner, { tenantId: world.tenantA, email: "auditor@test.local", name: "Auditor", passwordHash: await world.app.get(PasswordService).hash(PW), roleCode: "auditor", branches: [{ branchId: world.a1 }] });
    const auditor = await tokenFor("auditor@test.local");
    assert.equal((await api(auditor, "POST", "/sales/customers", { name: "Intruso" })).status, 403);
    assert.ok(!(await api(adminB, "GET", "/sales/customers")).json.some((c: { name: string }) => c.name === "Cliente Uno"));
    assert.equal((await api(adminB, "GET", `/sales/customers/${CUST}`)).status, 404);
  });
});

describe("borrador: precio, descuento e impuestos en la línea", () => {
  it("12 unidades con tramo por umbral (todo a 8) e IVA 13 %: neto 96, impuesto 12,48, total 108,48; sin código hasta confirmar", async () => {
    const s = await draft([{ productId: P1, quantity: 12 }]);
    assert.equal(s.code, null);
    assert.deepEqual([s.status, s.netTotal, s.taxTotal, s.total, s.discountTotal], ["DRAFT", "96", "12.48", "108.48", "0"]);
    const l = s.lines[0];
    assert.deepEqual([l.listUnitPrice, l.netAmount, l.taxAmount, l.totalAmount, l.priceListCode, l.priceMode], ["8", "96", "12.48", "108.48", "GEN", "WITHOUT_TAX"]);
    assert.deepEqual(l.taxes.map((t: { code: string; rate: string; amount: string }) => [t.code, t.rate, t.amount]), [["IVA", "13", "12.48"]]);
  });
  it("el descuento exige permiso y los impuestos se recalculan sobre lo realmente cobrado", async () => {
    const lines = [{ productId: P1, quantity: 12, discountPct: 10 }];
    const no = await api(cashier, "POST", "/sales/orders", { warehouseId: W1, lines });
    assert.equal(no.status, 403); assert.equal(no.json.code, "DISCOUNT_FORBIDDEN");
    const s = await draft(lines);
    assert.deepEqual([s.netTotal, s.taxTotal, s.total, s.discountTotal], ["86.4", "11.23", "97.63", "10.85"]);
    assert.equal((await api(admin, "POST", "/sales/orders", { warehouseId: W1, lines: [{ productId: P1, quantity: 1, discountPct: 101 }] })).status, 400);
  });
  it("lista con IVA incluido: el total es lo que dice la lista y el desglose no lo altera", async () => {
    const s = await draft([{ productId: P3, quantity: 2 }], { priceListId: L2 });
    assert.deepEqual([s.lines[0].priceMode, s.netTotal, s.taxTotal, s.total], ["WITH_TAX", "200", "26", "226"]);
  });
  it("producto exento: impuesto 0 con el motivo en la foto; servicio: se cotiza sin stock", async () => {
    const s = await draft([{ productId: PEX, quantity: 1 }, { productId: PSV, quantity: 1 }]);
    const ex = s.lines.find((l: { productCode: string }) => l.productCode === "PEX");
    assert.deepEqual([ex.taxAmount, ex.taxes[0].exempt, ex.taxes[0].exemptionReason], ["0", true, "Exportación"]);
    assert.equal(s.total, "150");
  });
  it("valida duplicados, decimales, producto sin precio, moneda mezclada y almacén", async () => {
    const mk = (lines: object[], extra: object = {}) => api(admin, "POST", "/sales/orders", { warehouseId: W1, lines, ...extra });
    assert.equal((await mk([{ productId: P1, quantity: 1 }, { productId: P1, quantity: 2 }])).json.code, "DUPLICATE_PRODUCT");
    assert.equal((await mk([{ productId: P1, quantity: 1.5 }])).json.code, "INVALID_QUANTITY");
    const sinPrecio = await product({ code: "SINP", name: "Sin precio" });
    assert.equal((await mk([{ productId: sinPrecio, quantity: 1 }])).status, 404);
    assert.equal((await mk([{ productId: P1, quantity: 1 }, { productId: PUSD, quantity: 1 }], { priceListId: null })).json.code, "MIXED_CURRENCY");
    assert.equal((await mk([{ productId: P1, quantity: 1 }], { customerId: "00000000-0000-4000-8000-000000000000" })).status, 404);
    assert.equal((await mk([])).status, 400);
  });
  it("se edita solo en borrador y se descarta sin dejar rastro de stock", async () => {
    const s = await draft([{ productId: P2, quantity: 1 }]);
    const u = await api(admin, "PATCH", `/sales/orders/${s.id}`, { lines: [{ productId: P2, quantity: 3 }], note: "Corregida" });
    assert.deepEqual([u.status, u.json.total, u.json.note], [200, "60", "Corregida"]);
    const before = await stock(P2);
    const d = await api(admin, "POST", `/sales/orders/${s.id}/discard`);
    assert.equal(d.json.status, "CANCELLED");
    assert.deepEqual(await stock(P2), before);
    assert.equal((await api(admin, "PATCH", `/sales/orders/${s.id}`, { note: "tarde" })).json.code, "SALE_NOT_EDITABLE");
    assert.equal((await confirm(s.id)).json.code, "INVALID_STATE");
  });
});

describe("confirmar: stock, costo, correlativo y cobros", () => {
  let sale: any;
  it("confirmar descuenta stock FIFO con lote y costo por línea, asigna el correlativo y cobra con pago mixto", async () => {
    const [q0, v0] = await stock(P1);
    const d = await draft([{ productId: P1, quantity: 12 }], { customerId: CUST });
    const c = await confirm(d.id, [{ method: "CASH", amount: 100 }, { method: "QR", amount: 8.48, reference: "QR-1" }]);
    assert.equal(c.status, 200, JSON.stringify(c.json));
    sale = c.json;
    assert.match(sale.code, /^V-\d{6}$/);
    assert.deepEqual([sale.status, sale.paymentStatus, sale.total, sale.paidTotal, sale.balance], ["CONFIRMED", "PAID", "108.48", "108.48", "0"]);
    assert.deepEqual(sale.payments.map((p: { method: string; amount: string }) => [p.method, p.amount]), [["CASH", "100"], ["QR", "8.48"]]);
    const l = sale.lines[0];
    assert.equal(l.costTotal, "60");
    assert.deepEqual(l.lots.map((x: { quantity: string; unitCost: string }) => [x.quantity, x.unitCost]), [["12", "5"]]);
    assert.deepEqual(await stock(P1), [String(Number(q0) - 12), String(Number(v0) - 60)]);
    assert.match(l.lots[0].lotCode, /^L-\d{6}$/);
  });
  it("el kardex deja la salida por venta y la conciliación cuadra", async () => {
    const k = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&limit=1`)).json.items[0];
    assert.deepEqual([k.type, k.quantity, k.reasonCode], ["ISSUE", "-12", "SALE"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });
  it("no se confirma dos veces ni se edita una venta confirmada", async () => {
    assert.equal((await confirm(sale.id)).json.code, "INVALID_STATE");
    assert.equal((await api(admin, "PATCH", `/sales/orders/${sale.id}`, { note: "x" })).json.code, "SALE_NOT_EDITABLE");
    assert.equal((await api(admin, "POST", `/sales/orders/${sale.id}/discard`)).json.code, "INVALID_STATE");
  });
  it("sin stock suficiente: 409, el borrador sigue siendo borrador y no sale nada", async () => {
    const [q, v] = await stock(P3);
    const sinPrecio = await api(admin, "POST", "/sales/orders", { warehouseId: W1, priceListId: L1, lines: [{ productId: P3, quantity: 5 }] });
    assert.equal(sinPrecio.status, 404, "P3 no tiene precio en la lista general");
    const d2 = await draft([{ productId: P1, quantity: 1000 }], { customerId: CUST });
    const r = await confirm(d2.id);
    assert.equal(r.status, 409); assert.equal(r.json.code, "INSUFFICIENT_STOCK");
    assert.equal((await api(admin, "GET", `/sales/orders/${d2.id}`)).json.status, "DRAFT");
    assert.deepEqual(await stock(P3), [q, v]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });
  it("una línea sin stock deshace TODA la venta (todo o nada)", async () => {
    const [q] = await stock(P2);
    const d = await draft([{ productId: P2, quantity: 1 }, { productId: P1, quantity: 1000 }], { customerId: CUST });
    const r = await confirm(d.id);
    assert.equal(r.status, 409); assert.equal(r.json.code, "INSUFFICIENT_STOCK");
    assert.equal((await stock(P2))[0], q, "P2 tampoco salió");
    assert.deepEqual(await reconciled(), [0, 0]);
  });
  it("los servicios se venden sin tocar el stock", async () => {
    const d = await draft([{ productId: PSV, quantity: 2 }]);
    const c = await confirm(d.id, [{ method: "CASH", amount: 200 }]);
    assert.deepEqual([c.status, c.json.paymentStatus, c.json.lines[0].costTotal, c.json.lines[0].lots], [200, "PAID", null, []]);
  });
  it("cobros: no superan el total; sin cobro y sin cliente no hay crédito", async () => {
    const d = await draft([{ productId: P2, quantity: 1 }]);
    assert.equal((await confirm(d.id, [{ method: "CASH", amount: 21 }])).json.code, "OVERPAYMENT");
    const noCust = await confirm(d.id);
    assert.equal(noCust.status, 409); assert.equal(noCust.json.code, "CUSTOMER_REQUIRED_FOR_CREDIT");
    assert.equal((await api(admin, "GET", `/sales/orders/${d.id}`)).json.status, "DRAFT");
  });
  it("sin código hasta confirmar: los correlativos no tienen huecos aunque haya borradores descartados y fallos", async () => {
    const codes = (await api(admin, "GET", "/sales/orders?status=CONFIRMED")).json.map((s: { code: string }) => Number(s.code.slice(2))).sort((a: number, b: number) => a - b);
    assert.deepEqual(codes, codes.map((_: number, i: number) => i + 1));
  });
});

describe("crédito y cobros posteriores", () => {
  it("la venta a crédito queda por cobrar, se cobra por partes y respeta el saldo", async () => {
    const d = await draft([{ productId: P2, quantity: 2 }], { customerId: CUST });
    const c = (await confirm(d.id)).json;
    assert.deepEqual([c.paymentStatus, c.total, c.balance], ["UNPAID", "40", "40"]);
    assert.equal((await api(admin, "GET", `/sales/customers/${CUST}`)).json.outstanding, "40");
    const p1 = await api(cashier, "POST", `/sales/orders/${c.id}/payments`, { method: "TRANSFER", amount: 15, reference: "T-1" });
    assert.deepEqual([p1.status, p1.json.paymentStatus, p1.json.balance], [200, "PARTIAL", "25"]);
    assert.equal((await api(admin, "POST", `/sales/orders/${c.id}/payments`, { method: "CASH", amount: 26 })).json.code, "OVERPAYMENT");
    const p2 = await api(admin, "POST", `/sales/orders/${c.id}/payments`, { method: "CASH", amount: 25 });
    assert.deepEqual([p2.json.paymentStatus, p2.json.balance, p2.json.payments.length], ["PAID", "0", 2]);
    assert.equal((await api(admin, "GET", `/sales/customers/${CUST}`)).json.outstanding, "0");
    assert.equal((await api(admin, "POST", `/sales/orders/${c.id}/payments`, { method: "CASH", amount: 1 })).json.code, "OVERPAYMENT");
  });
  it("el límite de crédito del cliente se respeta (con lo ya adeudado)", async () => {
    const mk = async (qty: number) => confirm((await draft([{ productId: P2, quantity: qty }], { customerId: CRED })).id);
    assert.equal((await mk(2)).status, 200);                               // 40
    assert.equal((await mk(3)).status, 200);                               // 60 → deuda 100 (= límite)
    const over = await mk(1);                                              // 20 → 120
    assert.equal(over.status, 409); assert.equal(over.json.code, "CREDIT_LIMIT_EXCEEDED");
    const paid = await confirm((await draft([{ productId: P2, quantity: 1 }], { customerId: CRED })).id, [{ method: "CASH", amount: 20 }]);
    assert.equal(paid.status, 200, "pagando al contado no usa crédito");
  });
  it("cobrar exige permiso y una venta confirmada", async () => {
    const d = await draft([{ productId: P2, quantity: 1 }], { customerId: CUST });
    assert.equal((await api(admin, "POST", `/sales/orders/${d.id}/payments`, { method: "CASH", amount: 1 })).json.code, "INVALID_STATE");
    assert.equal((await api(manager, "POST", `/sales/orders/${d.id}/payments`, { method: "CASH", amount: 0 })).status, 400);
  });
});

describe("la foto del cálculo es inmutable", () => {
  it("cambiar la lista o la tasa después no altera una venta confirmada", async () => {
    const d = await draft([{ productId: P1, quantity: 12 }]);
    const c = (await confirm(d.id, [{ method: "CASH", amount: 108.48 }])).json;
    await setPrice(L1, P1, [{ minQuantity: 1, unitPrice: 99 }]);
    const again = (await api(admin, "GET", `/sales/orders/${c.id}`)).json;
    assert.deepEqual([again.total, again.lines[0].listUnitPrice, again.lines[0].taxes[0].rate], ["108.48", "8", "13"]);
    await setPrice(L1, P1, [{ minQuantity: 1, maxQuantity: 10, unitPrice: 10 }, { minQuantity: 10, unitPrice: 8 }]);
  });
  it("un borrador SÍ se reprecia al confirmar (precio vigente del momento)", async () => {
    const d = await draft([{ productId: P1, quantity: 1 }]);
    assert.equal(d.total, "11.3");
    await setPrice(L1, P1, [{ minQuantity: 1, unitPrice: 20 }]);
    const c = await confirm(d.id, [{ method: "CASH", amount: 22.6 }]);
    assert.equal(c.json.total, "22.6");
    await setPrice(L1, P1, [{ minQuantity: 1, maxQuantity: 10, unitPrice: 10 }, { minQuantity: 10, unitPrice: 8 }]);
  });
  it("la base impide tocar las líneas de una venta confirmada y borrar ventas o cobros, incluso con el usuario de la aplicación", async () => {
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE sale_line SET net_amount = 1 WHERE sale_id IN (SELECT id FROM sale WHERE status = 'CONFIRMED')`)), /no se modifica|check/i);
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`DELETE FROM sale_line WHERE sale_id IN (SELECT id FROM sale WHERE status = 'CONFIRMED')`)), /no se modifica|check/i);
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of ["DELETE FROM sale", "DELETE FROM payment", "UPDATE payment SET amount = 1", "DELETE FROM sale_line_allocation", "DELETE FROM quote", "DELETE FROM customer"]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
    } finally { await app.$disconnect(); }
  });
  it("la base exige que toda venta confirmada tenga su código y que lo cobrado no supere el total", async () => {
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE sale SET code = NULL WHERE status = 'CONFIRMED'`)), /check|restricci/i);
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE sale SET paid_total = total + 1 WHERE status = 'CONFIRMED'`)), /check|restricci/i);
  });
});

describe("anulación de ventas", () => {
  it("anular devuelve el stock a su lote y costo originales y registra quién y por qué", async () => {
    const [q0, v0] = await stock(P1);
    const credit = await draft([{ productId: P1, quantity: 5 }], { customerId: CUST });
    const conf = (await confirm(credit.id)).json;
    assert.deepEqual(await stock(P1), [String(Number(q0) - 5), String(Number(v0) - Number(conf.lines[0].costTotal))]);
    const v = await api(manager, "POST", `/sales/orders/${conf.id}/void`, { reason: "Error de digitación" });
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.deepEqual([v.json.status, v.json.cancelReason], ["CANCELLED", "Error de digitación"]);
    assert.deepEqual(await stock(P1), [q0, v0]);
    assert.equal((await api(admin, "GET", `/sales/customers/${CUST}`)).json.outstanding, "0", "lo anulado no es deuda");
    assert.deepEqual(await reconciled(), [0, 0]);
  });
  it("no se anula con cobros, ni dos veces, ni sin permiso", async () => {
    const d = await draft([{ productId: P2, quantity: 1 }]);
    const paid = (await confirm(d.id, [{ method: "CASH", amount: 20 }])).json;
    assert.equal((await api(admin, "POST", `/sales/orders/${paid.id}/void`, { reason: "intento" })).json.code, "HAS_PAYMENTS");
    const credit = (await confirm((await draft([{ productId: P2, quantity: 1 }], { customerId: CUST })).id)).json;
    assert.equal((await api(cashier, "POST", `/sales/orders/${credit.id}/void`, { reason: "intento" })).status, 403);
    assert.equal((await api(admin, "POST", `/sales/orders/${credit.id}/void`, { reason: "x" })).status, 400);
    assert.equal((await api(admin, "POST", `/sales/orders/${credit.id}/void`, { reason: "Cliente desistió" })).status, 200);
    assert.equal((await api(admin, "POST", `/sales/orders/${credit.id}/void`, { reason: "otra vez" })).json.code, "INVALID_STATE");
    const [a, b] = await Promise.all([1, 2].map(async () => api(admin, "POST", `/sales/orders/${paid.id}/void`, { reason: "paralelo" })));
    assert.deepEqual([a!.json.code, b!.json.code], ["HAS_PAYMENTS", "HAS_PAYMENTS"]);
  });
});

describe("concurrencia", () => {
  it("dos ventas simultáneas que juntas exceden el stock: solo una se confirma", async () => {
    const p = await product({ code: "RACE", name: "Carrera" });
    await setPrice(L1, p, [{ minQuantity: 1, unitPrice: 10 }]);
    await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: p, quantity: 20, unitCost: 2 }] });
    const [a, b] = await Promise.all([draft([{ productId: p, quantity: 15 }]), draft([{ productId: p, quantity: 15 }])]);
    const rs = await Promise.all([confirm(a.id, [{ method: "CASH", amount: 150 }]), confirm(b.id, [{ method: "CASH", amount: 150 }])]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(await stock(p), ["5", "10"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });
  it("confirmar la misma venta dos veces a la vez: una sola vez", async () => {
    const d = await draft([{ productId: P2, quantity: 1 }], { customerId: CUST });
    const [a, b] = await Promise.all([confirm(d.id), confirm(d.id)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal((await api(admin, "GET", `/sales/orders/${d.id}`)).json.lines[0].lots.length, 1, "una sola asignación de lote");
  });
});

describe("cotizaciones", () => {
  const mkQuote = (lines: object[], extra: object = {}) => api(admin, "POST", "/sales/quotes", { branchId: world.a1, customerId: CUST, validUntil: isoDay(10), lines, ...extra });

  it("crea con precio e impuestos fijados, exige cliente o prospecto y una vigencia futura", async () => {
    const q = await mkQuote([{ productId: P1, quantity: 10 }]);
    assert.equal(q.status, 201, JSON.stringify(q.json));
    assert.match(q.json.code, /^CT-\d{6}$/);
    assert.deepEqual([q.json.status, q.json.netTotal, q.json.taxTotal, q.json.total, q.json.expired], ["DRAFT", "80", "10.4", "90.4", false]);
    assert.equal((await api(admin, "POST", "/sales/quotes", { branchId: world.a1, validUntil: isoDay(10), lines: [{ productId: P1, quantity: 1 }] })).status, 400);
    assert.equal((await api(admin, "POST", "/sales/quotes", { branchId: world.a1, prospectName: "Prospecto SA", validUntil: isoDay(10), lines: [{ productId: P1, quantity: 1 }] })).status, 201);
    assert.equal((await mkQuote([{ productId: P1, quantity: 1 }], { validUntil: isoDay(-3) })).json.code, "INVALID_VALIDITY");
  });

  it("flujo borrador → enviada → aceptada; rechazar y cancelar; transiciones inválidas", async () => {
    const q = (await mkQuote([{ productId: P2, quantity: 1 }])).json;
    assert.equal((await api(admin, "POST", `/sales/quotes/${q.id}/accept`)).json.code, "INVALID_STATE", "no se acepta sin enviar");
    assert.equal((await api(admin, "POST", `/sales/quotes/${q.id}/send`)).json.status, "SENT");
    assert.equal((await api(admin, "PATCH", `/sales/quotes/${q.id}`, { note: "tarde" })).json.code, "QUOTE_NOT_EDITABLE");
    assert.equal((await api(admin, "POST", `/sales/quotes/${q.id}/accept`)).json.status, "ACCEPTED");
    const r = (await mkQuote([{ productId: P2, quantity: 1 }])).json;
    await api(admin, "POST", `/sales/quotes/${r.id}/send`);
    assert.equal((await api(admin, "POST", `/sales/quotes/${r.id}/reject`)).json.status, "REJECTED");
    assert.equal((await api(admin, "POST", `/sales/quotes/${r.id}/accept`)).json.code, "INVALID_STATE");
    const c = (await mkQuote([{ productId: P2, quantity: 1 }])).json;
    assert.equal((await api(admin, "POST", `/sales/quotes/${c.id}/cancel`)).json.status, "CANCELLED");
  });

  it("convertir conserva el precio acordado aunque la lista cambie, es idempotente y no reserva stock", async () => {
    const q = (await mkQuote([{ productId: P1, quantity: 10 }])).json; // 10 u a 8 = 80 + IVA = 90,40
    await api(admin, "POST", `/sales/quotes/${q.id}/send`); await api(admin, "POST", `/sales/quotes/${q.id}/accept`);
    await setPrice(L1, P1, [{ minQuantity: 1, unitPrice: 50 }]); // la lista sube
    const [stockBefore] = await stock(P1);
    const [a, b] = await Promise.all([1, 2].map(() => api(admin, "POST", `/sales/quotes/${q.id}/convert`, { warehouseId: W1 })));
    assert.deepEqual([a!.status, b!.status], [200, 200]);
    assert.equal(a!.json.id, b!.json.id, "la misma venta");
    assert.deepEqual([a!.json.status, a!.json.total, a!.json.quote.code], ["DRAFT", "90.4", q.code]);
    assert.equal((await stock(P1))[0], stockBefore, "convertir no mueve stock");
    const salesFromQuote = (await api(admin, "GET", "/sales/orders")).json.filter((s: { id: string }) => s.id === a!.json.id);
    assert.equal(salesFromQuote.length, 1);
    assert.equal((await api(admin, "POST", `/sales/quotes/${q.id}/convert`, { warehouseId: W1 })).json.id, a!.json.id, "otra vez: devuelve la misma");
    const c = await confirm(a!.json.id, [{ method: "CASH", amount: 90.4 }]);
    assert.deepEqual([c.status, c.json.total, c.json.paymentStatus], [200, "90.4", "PAID"], "se confirma con el precio de la cotización");
    assert.equal((await api(admin, "POST", `/sales/quotes/${q.id}/cancel`)).json.code, "ALREADY_CONVERTED");
    await setPrice(L1, P1, [{ minQuantity: 1, maxQuantity: 10, unitPrice: 10 }, { minQuantity: 10, unitPrice: 8 }]);
  });

  it("no se convierte una no aceptada, de otra sucursal, ni una vencida; al confirmar se vuelve a validar el stock", async () => {
    const q = (await mkQuote([{ productId: P2, quantity: 1 }])).json;
    assert.equal((await api(admin, "POST", `/sales/quotes/${q.id}/convert`, { warehouseId: W1 })).json.code, "INVALID_STATE");
    await api(admin, "POST", `/sales/quotes/${q.id}/send`); await api(admin, "POST", `/sales/quotes/${q.id}/accept`);
    assert.equal((await api(admin, "POST", `/sales/quotes/${q.id}/convert`, { warehouseId: W3 })).json.code, "BRANCH_MISMATCH");
    // vence
    const v = (await mkQuote([{ productId: P2, quantity: 1 }], { validUntil: isoDay(1) })).json;
    await api(admin, "POST", `/sales/quotes/${v.id}/send`); await api(admin, "POST", `/sales/quotes/${v.id}/accept`);
    clock.set(new Date(Date.now() + 3 * 86_400_000));
    assert.equal((await api(admin, "POST", `/sales/quotes/${v.id}/convert`, { warehouseId: W1 })).json.code, "QUOTE_EXPIRED");
    const d = (await mkQuote([{ productId: P2, quantity: 1 }], { validUntil: isoDay(5) })).json; // creada con el reloj adelantado
    clock.set(null);
    // stock: una cotización aceptada por más de lo que hay se convierte pero NO se confirma
    const big = (await mkQuote([{ productId: P2, quantity: 500 }])).json;
    await api(admin, "POST", `/sales/quotes/${big.id}/send`); await api(admin, "POST", `/sales/quotes/${big.id}/accept`);
    const sale = (await api(admin, "POST", `/sales/quotes/${big.id}/convert`, { warehouseId: W1 })).json;
    assert.equal((await confirm(sale.id)).json.code, "INSUFFICIENT_STOCK");
    void d;
  });

  it("una cotización vencida se marca como vencida y no se puede enviar ni aceptar", async () => {
    const q = (await mkQuote([{ productId: P2, quantity: 1 }], { validUntil: isoDay(1) })).json;
    await api(admin, "POST", `/sales/quotes/${q.id}/send`);
    clock.set(new Date(Date.now() + 5 * 86_400_000));
    const g = (await api(admin, "GET", `/sales/quotes/${q.id}`)).json;
    assert.deepEqual([g.status, g.expired], ["SENT", true]);
    assert.equal((await api(admin, "POST", `/sales/quotes/${q.id}/accept`)).json.code, "QUOTE_EXPIRED");
    clock.set(null);
  });

  it("alcance: el gerente cotiza en A1/A2 pero no en A3; la empresa B no ve nada", async () => {
    const mk = (token: string, branchId: string) => api(token, "POST", "/sales/quotes", { branchId, customerId: CUST, validUntil: isoDay(5), lines: [{ productId: P2, quantity: 1 }] });
    assert.equal((await mk(manager, world.a1)).status, 201);
    assert.equal((await mk(manager, world.a3)).status, 403);
    const list = (await api(admin, "GET", "/sales/quotes")).json;
    assert.equal((await api(adminB, "GET", `/sales/quotes/${list[0].id}`)).status, 404);
    assert.deepEqual((await api(adminB, "GET", "/sales/quotes")).json, []);
  });
});

describe("alcance, permisos y trazabilidad", () => {
  it("el gerente no vende desde un almacén de A3; el cajero vende en su sucursal pero no anula; B no ve ventas de A", async () => {
    assert.equal((await api(manager, "POST", "/sales/orders", { warehouseId: W3, lines: [{ productId: P2, quantity: 1 }] })).status, 403);
    const d = await api(cashier, "POST", "/sales/orders", { warehouseId: W1, lines: [{ productId: P2, quantity: 1 }] });
    assert.equal(d.status, 201);
    assert.equal((await api(cashier, "POST", `/sales/orders/${d.json.id}/confirm`, { payments: [{ method: "CASH", amount: 20 }] })).status, 200);
    assert.deepEqual((await api(adminB, "GET", "/sales/orders")).json, []);
    assert.equal((await api(adminB, "GET", `/sales/orders/${d.json.id}`)).status, 404);
    assert.equal((await confirm(d.json.id, [], adminB)).status, 404);
  });
  it("la conciliación de inventario sigue sin diferencias tras todas las ventas", async () => {
    assert.deepEqual(await reconciled(), [0, 0]);
  });
  it("todo queda auditado", async () => {
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    for (const a of ["customer.created", "sale.drafted", "sale.draft_updated", "sale.discarded", "sale.confirmed", "sale.payment_recorded", "sale.voided", "quote.created", "quote.sent", "quote.accepted", "quote.rejected", "quote.cancelled", "quote.converted"]) assert.ok(acts.has(a), a);
  });
});
