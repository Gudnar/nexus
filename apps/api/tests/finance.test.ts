import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createDb, withTenant } from "@erp/db";
import { Clock } from "../src/access/clock";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string, clock: Clock;
let UND: string, W1: string, W3: string, P: string;
let C30: string, C0: string, S30: string, S0: string;

type M = "GET" | "POST" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const isoDay = (n: number) => days(n).toLocaleDateString("sv", { timeZone: "America/La_Paz" }); // fecha local de la empresa, no UTC

const creditSale = async (customerId: string, qty: number, warehouseId = W1) => {
  const d = await api(admin, "POST", "/sales/orders", { warehouseId, customerId, lines: [{ productId: P, quantity: qty }] });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  const c = await api(admin, "POST", `/sales/orders/${d.json.id}/confirm`, { payments: [] });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  return c.json;
};
const receipt = async (supplierId: string, qty: number, unitCost: number, warehouseId = W1) => {
  const r = await api(admin, "POST", "/purchasing/receipts", { supplierId, warehouseId, supplierRef: `GR-${Math.random().toString(36).slice(2, 7)}`, lines: [{ productId: P, quantity: qty, unitCost }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const receivables = async (token = admin) => (await api(token, "GET", "/finance/receivables")).json;
const payables = async (token = admin) => (await api(token, "GET", "/finance/payables")).json;
const payableRows = async (supplierId: string) => (await api(admin, "GET", `/finance/payables/suppliers/${supplierId}`)).json;
const pay = (token: string, body: object) => api(token, "POST", "/finance/supplier-payments", body);
const row = (rep: { customers?: any[]; suppliers?: any[] }, id: string) => (rep.customers ?? rep.suppliers)!.find((c) => (c.customerId ?? c.supplierId) === id);

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  [admin, adminB, manager, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local")]);
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  W3 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a3, code: "W3", name: "Sur" })).json.id;
  const L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  P = (await api(admin, "POST", "/catalog/products", { code: "P1", name: "Producto", baseUnitId: UND })).json.id;
  await call("PUT", `/api/v1/pricing/lists/${L1}/prices/${P}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } });
  for (const w of [W1, W3]) await api(admin, "POST", "/inventory/adjustments", { warehouseId: w, reason: "Carga", lines: [{ productId: P, quantity: 1000, unitCost: 5 }] });
  C30 = (await api(admin, "POST", "/sales/customers", { name: "Cliente a 30 días", taxId: "30", paymentTermsDays: 30 })).json.id;
  C0 = (await api(admin, "POST", "/sales/customers", { name: "Cliente al contado", taxId: "0" })).json.id;
  S30 = (await api(admin, "POST", "/purchasing/suppliers", { code: "S30", name: "Proveedor a 30 días", paymentTermsDays: 30 })).json.id;
  S0 = (await api(admin, "POST", "/purchasing/suppliers", { code: "S0", name: "Proveedor al contado" })).json.id;
});
afterEach(() => clock.set(null));
after(async () => { clock.set(null); await teardown(); });

describe("cuentas por cobrar", () => {
  let sale30: any;
  it("una venta a crédito queda por cobrar con vencimiento según el plazo del cliente", async () => {
    sale30 = await creditSale(C30, 5);
    const r = await receivables();
    const c = row(r, C30);
    assert.deepEqual([c.outstanding, c.overdue, c.documents, c.oldestDue, c.buckets.current], ["50", "0", 1, isoDay(30), "50"]);
    assert.deepEqual([r.totals.outstanding, r.totals.current], ["50", "50"]);
    const detail = (await api(admin, "GET", `/finance/receivables/customers/${C30}`)).json;
    assert.deepEqual([detail.length, detail[0].code, detail[0].balance, detail[0].dueDate, detail[0].daysOverdue], [1, sale30.code, "50", isoDay(30), 0]);
  });

  it("la antigüedad de saldos reparte lo vencido por tramos según pasan los días", async () => {
    clock.set(days(40)); // venció hace 10 días
    let c = row(await receivables(), C30);
    assert.deepEqual([c.buckets.current, c.buckets.d1_30, c.overdue], ["0", "50", "50"]);
    clock.set(days(30 + 45));
    c = row(await receivables(), C30);
    assert.equal(c.buckets.d31_60, "50");
    clock.set(days(30 + 75));
    assert.equal(row(await receivables(), C30).buckets.d61_90, "50");
    clock.set(days(30 + 200));
    const r = await receivables();
    assert.deepEqual([row(r, C30).buckets.d90plus, r.totals.d90plus, r.totals.overdue], ["50", "50", "50"]);
    assert.equal((await api(admin, "GET", `/finance/receivables/customers/${C30}`)).json[0].daysOverdue, 200);
  });

  it("un cliente al contado (0 días) vence el mismo día: al día siguiente ya está vencido", async () => {
    await creditSale(C0, 2);
    assert.equal(row(await receivables(), C0).buckets.current, "20");
    clock.set(days(1));
    assert.deepEqual([row(await receivables(), C0).buckets.d1_30, row(await receivables(), C0).overdue], ["20", "20"]);
  });

  it("los cobros, las devoluciones y las anulaciones bajan o quitan el saldo", async () => {
    const s = await creditSale(C30, 4); // +40 → 90 en total para C30
    assert.equal(row(await receivables(), C30).outstanding, "90");
    await api(admin, "POST", `/sales/orders/${s.id}/payments`, { method: "TRANSFER", amount: 15 });
    assert.equal(row(await receivables(), C30).outstanding, "75");
    await api(admin, "POST", `/sales/orders/${s.id}/returns`, { reason: "Devolución", lines: [{ saleLineId: s.lines[0].id, quantity: 1 }] }); // −10 (no hay efectivo por reintegrar)
    assert.equal(row(await receivables(), C30).outstanding, "65");
    await api(admin, "POST", `/sales/orders/${s.id}/payments`, { method: "TRANSFER", amount: 15 }); // saldo de la venta: 40 − 10 − 15 = 15 → queda en 0
    assert.equal(row(await receivables(), C30).outstanding, "50", "esa venta quedó saldada y sale del reporte");
    const detail = (await api(admin, "GET", `/finance/receivables/customers/${C30}`)).json;
    assert.deepEqual(detail.map((d: { code: string }) => d.code), [sale30.code]);
    // anulada
    const v = await creditSale(C30, 1);
    assert.equal(row(await receivables(), C30).outstanding, "60");
    await api(admin, "POST", `/sales/orders/${v.id}/void`, { reason: "Error" });
    assert.equal(row(await receivables(), C30).outstanding, "50");
  });

  it("los borradores y las ventas de contado no aparecen; ni los clientes sin deuda", async () => {
    await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: C0, lines: [{ productId: P, quantity: 9 }] }); // borrador
    const cash = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: C0, lines: [{ productId: P, quantity: 1 }] });
    await api(admin, "POST", `/sales/orders/${cash.json.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 10 }] });
    assert.equal(row(await receivables(), C0).outstanding, "20", "solo la venta a crédito de antes");
  });

  it("respeta el alcance por sucursal y las empresas", async () => {
    const s3 = await creditSale(C30, 3, W3); // sucursal A3
    assert.equal(row(await receivables(), C30).outstanding, "80");
    assert.equal(row(await receivables(manager), C30).outstanding, "50", "el gerente (A1, A2) no ve la deuda de A3");
    assert.equal((await receivables(cashier)).customers.length >= 1, true);
    assert.deepEqual((await receivables(adminB)).customers, []);
    assert.equal((await api(adminB, "GET", `/finance/receivables/customers/${C30}`)).status, 404);
    await api(admin, "POST", `/sales/orders/${s3.id}/void`, { reason: "Limpieza" });
  });

  it("ordena por lo vencido y consolida los totales", async () => {
    clock.set(days(60));
    const r = await receivables();
    assert.equal(r.customers[0].customerId, C30, "el que más debe vencido va primero");
    const sum = ["current", "d1_30", "d31_60", "d61_90", "d90plus"].reduce((s, k) => s + Number(r.totals[k]), 0);
    assert.equal(sum, Number(r.totals.outstanding));
  });
});

describe("cuentas por pagar", () => {
  it("cada recepción genera la deuda con el proveedor y su vencimiento según el plazo", async () => {
    const r = await receipt(S30, 10, 5);
    const rows = await payableRows(S30);
    assert.deepEqual([rows.length, rows[0].receiptCode, rows[0].total, rows[0].paid, rows[0].balance, rows[0].dueDate, rows[0].status], [1, r.code, "50", "0", "50", isoDay(30), "OPEN"]);
    const rep = await payables();
    assert.deepEqual([row(rep, S30).outstanding, rep.totals.outstanding], ["50", "50"]);
    const rc = await receipt(S0, 4, 5);
    assert.equal((await payableRows(S0))[0].dueDate, isoDay(0), "proveedor al contado: vence hoy");
    void rc;
  });

  it("la antigüedad por pagar cambia con los días", async () => {
    clock.set(days(30 + 10));
    assert.equal(row(await payables(), S30).buckets.d1_30, "50");
    clock.set(days(30 + 100));
    assert.equal(row(await payables(), S30).buckets.d90plus, "50");
  });

  it("una recepción contra una orden muestra su orden; anular una recepción sin pagos anula la deuda", async () => {
    const o = (await api(admin, "POST", "/purchasing/orders", { supplierId: S30, warehouseId: W1, lines: [{ productId: P, quantity: 6, unitCost: 5 }] })).json;
    await api(admin, "POST", `/purchasing/orders/${o.id}/issue`);
    const r = (await api(admin, "POST", "/purchasing/receipts", { orderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: 6 }] })).json;
    const list = await payableRows(S30);
    const mine = list.find((x: { receiptCode: string }) => x.receiptCode === r.code);
    assert.deepEqual([mine.orderCode, mine.total], [o.code, "30"]);
    const before = row(await payables(), S30).outstanding;
    assert.equal((await api(admin, "POST", `/purchasing/receipts/${r.id}/void`, { reason: "Error de carga" })).status, 200);
    assert.equal((await payableRows(S30)).find((x: { receiptCode: string }) => x.receiptCode === r.code).status, "VOID");
    assert.equal(Number(row(await payables(), S30).outstanding), Number(before) - 30);
  });

  it("alcance y empresas", async () => {
    assert.deepEqual((await payables(adminB)).suppliers, []);
    assert.equal((await api(adminB, "GET", `/finance/payables/suppliers/${S30}`)).status, 404);
    assert.equal((await api(cashier, "GET", "/finance/payables")).status, 403, "el cajero no ve compras");
  });
});

describe("pagos a proveedores", () => {
  let SP: string, A: any, B: any;
  before(async () => {
    SP = (await api(admin, "POST", "/purchasing/suppliers", { code: "SP", name: "Proveedor de pagos", paymentTermsDays: 10 })).json.id;
    A = await receipt(SP, 10, 5); // 50, vence hoy+10
    B = await receipt(SP, 6, 5);  // 30, vence hoy+10 (misma fecha: se paga por antigüedad de creación/id)
  });

  it("sin asignaciones se paga primero lo que vence antes y el pago queda repartido", async () => {
    const r = await pay(admin, { supplierId: SP, method: "TRANSFER", amount: 60, reference: "T-1" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.code, /^PG-\d{6}$/);
    assert.deepEqual(r.json.allocations.map((a: { receiptCode: string; amount: string }) => [a.receiptCode, a.amount]), [[A.code, "50"], [B.code, "10"]]);
    const rows = await payableRows(SP);
    assert.deepEqual(rows.map((x: { receiptCode: string; paid: string; status: string }) => [x.receiptCode, x.paid, x.status]), [[A.code, "50", "PAID"], [B.code, "10", "OPEN"]]);
    assert.equal(row(await payables(), SP).outstanding, "20");
    assert.equal((await api(admin, "GET", `/finance/supplier-payments?supplierId=${SP}`)).json[0].code, r.json.code);
  });

  it("con asignaciones explícitas: deben sumar el pago y no pasar del saldo", async () => {
    const rows = await payableRows(SP);
    const open = rows.find((x: { status: string }) => x.status === "OPEN");
    assert.equal((await pay(admin, { supplierId: SP, method: "TRANSFER", amount: 10, allocations: [{ payableId: open.id, amount: 5 }] })).json.code, "ALLOCATION_MISMATCH");
    assert.equal((await pay(admin, { supplierId: SP, method: "TRANSFER", amount: 25, allocations: [{ payableId: open.id, amount: 25 }] })).json.code, "OVERPAYMENT");
    assert.equal((await pay(admin, { supplierId: SP, method: "TRANSFER", amount: 10, allocations: [{ payableId: open.id, amount: 5 }, { payableId: open.id, amount: 5 }] })).json.code, "DUPLICATE_ALLOCATION");
    const ok = await pay(admin, { supplierId: SP, method: "QR", amount: 20, allocations: [{ payableId: open.id, amount: 20 }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal((await payableRows(SP)).find((x: { id: string }) => x.id === open.id).status, "PAID");
    assert.equal(row(await payables(), SP), undefined, "ya no se le debe nada");
  });

  it("no se paga más de lo que se debe ni una deuda de otro proveedor o ya pagada", async () => {
    assert.equal((await pay(admin, { supplierId: SP, method: "TRANSFER", amount: 1 })).json.code, "OVERPAYMENT");
    const other = (await payableRows(S30))[0];
    const paidOne = (await payableRows(SP))[0];
    assert.equal((await pay(admin, { supplierId: S30, method: "TRANSFER", amount: 1, allocations: [{ payableId: paidOne.id, amount: 1 }] })).json.code, "PAYABLE_NOT_PAYABLE");
    assert.equal((await pay(admin, { supplierId: SP, method: "TRANSFER", amount: 1, allocations: [{ payableId: other.id, amount: 1 }] })).json.code, "PAYABLE_NOT_PAYABLE");
    assert.equal((await pay(admin, { supplierId: "00000000-0000-4000-8000-000000000000", method: "TRANSFER", amount: 1 })).status, 404);
    assert.equal((await pay(admin, { supplierId: SP, method: "TRANSFER", amount: 0 })).status, 400);
  });

  it("una recepción con pagos aplicados no se anula", async () => {
    assert.equal((await api(admin, "POST", `/purchasing/receipts/${A.id}/void`, { reason: "intento" })).json.code, "HAS_PAYMENTS");
  });

  it("permisos: el cajero no paga; el gerente sí; B no ve nada", async () => {
    const S = (await api(admin, "POST", "/purchasing/suppliers", { code: "SQ", name: "Otro", paymentTermsDays: 5 })).json.id;
    await receipt(S, 2, 5);
    assert.equal((await pay(cashier, { supplierId: S, method: "TRANSFER", amount: 1 })).status, 403);
    assert.equal((await pay(manager, { supplierId: S, method: "TRANSFER", amount: 3 })).status, 201);
    assert.equal((await pay(adminB, { supplierId: S, method: "TRANSFER", amount: 1 })).status, 404);
    assert.deepEqual((await api(adminB, "GET", "/finance/supplier-payments")).json, []);
  });

  it("dos pagos simultáneos que juntos exceden la deuda: solo uno se aplica", async () => {
    const S = (await api(admin, "POST", "/purchasing/suppliers", { code: "SC", name: "Concurrencia" })).json.id;
    await receipt(S, 10, 5); // debe 50
    const rs = await Promise.all([pay(admin, { supplierId: S, method: "TRANSFER", amount: 40 }), pay(admin, { supplierId: S, method: "TRANSFER", amount: 40 })]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await payableRows(S))[0].paid, "40");
  });
});

describe("pagos en efectivo y caja", () => {
  it("con caja en la sucursal, pagar en efectivo exige un turno abierto y sale del efectivo de la caja", async () => {
    const S = (await api(admin, "POST", "/purchasing/suppliers", { code: "SK", name: "Proveedor en efectivo" })).json.id;
    await receipt(S, 40, 5); // debe 200
    const reg = (await api(admin, "POST", "/cash/registers", { branchId: world.a1, code: "CAJA1", name: "Caja 1" })).json.id;
    const noSession = await pay(admin, { supplierId: S, method: "CASH", amount: 30 });
    assert.equal(noSession.status, 409); assert.equal(noSession.json.code, "CASH_SESSION_REQUIRED");
    assert.equal((await payableRows(S))[0].paid, "0", "no se aplicó nada");
    const session = (await api(admin, "POST", "/cash/sessions", { registerId: reg, denominations: { "100": 1 } })).json;
    assert.equal((await pay(admin, { supplierId: S, method: "CASH", amount: 250 })).json.code, "OVERPAYMENT");
    const ok = await pay(admin, { supplierId: S, method: "CASH", amount: 60 });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    const after = (await api(admin, "GET", `/cash/sessions/${session.id}`)).json;
    assert.equal(after.expectedCash, "40", "100 de fondo − 60 pagados al proveedor");
    assert.deepEqual([after.movements[0].type, after.movements[0].amount], ["SUPPLIER_PAYMENT", "-60"]);
    // no se paga más efectivo del que hay en la caja
    const tooMuch = await pay(admin, { supplierId: S, method: "CASH", amount: 40.5 });
    assert.equal(tooMuch.status, 409); assert.equal(tooMuch.json.code, "INSUFFICIENT_CASH");
    // transferencias no necesitan efectivo, pero se registran en el turno aparte
    assert.equal((await pay(admin, { supplierId: S, method: "TRANSFER", amount: 10 })).status, 201);
    const detail = (await api(admin, "GET", `/cash/sessions/${session.id}`)).json;
    assert.equal(detail.expectedCash, "40", "la transferencia no toca el efectivo");
    assert.ok(detail.totals.some((t: { method: string; outflow: string }) => t.method === "TRANSFER" && t.outflow === "10"));
  });
});

describe("integridad y trazabilidad", () => {
  it("la base: los pagos no se editan ni se borran, y la deuda no se paga de más", async () => {
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of ["DELETE FROM supplier_payment", "UPDATE supplier_payment SET amount = 1", "DELETE FROM supplier_payment_allocation", "UPDATE supplier_payment_allocation SET amount = 1", "DELETE FROM payable"]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
    } finally { await app.$disconnect(); }
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE payable SET paid_total = total + 1 WHERE status = 'OPEN'`)), /check|restricci/i);
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE payable SET status = 'PAID' WHERE status = 'OPEN'`)), /check|restricci/i);
  });
  it("la conciliación de inventario cuadra y todo queda auditado", async () => {
    const r = (await api(admin, "GET", "/inventory/reconciliation")).json;
    assert.deepEqual([r.balances.length, r.valuations.length], [0, 0]);
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    assert.ok(acts.has("supplier.payment_recorded"));
  });
});
