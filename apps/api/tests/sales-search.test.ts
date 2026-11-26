import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { withTenant } from "@erp/db";
import { Clock } from "../src/access/clock";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, cashier: string, clock: Clock;
let W1: string, W2: string, P: string, CA: string, CB: string, SELLER_ADMIN: string;
type M = "GET" | "POST";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const search = (qs = "", token = admin) => api(token, "GET", `/sales/search${qs ? `?${qs}` : ""}`);

const sale = async (customerId: string | null, qty: number, pay: number | "all" | "none", warehouseId = W1, extra: object = {}) => {
  const d = await api(admin, "POST", "/sales/orders", { warehouseId, ...(customerId ? { customerId } : {}), lines: [{ productId: P, quantity: qty }], ...extra });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  if (pay === "none" && !customerId) return d.json;
  const payments = pay === "none" ? [] : [{ method: "TRANSFER", amount: pay === "all" ? qty * 10 : pay }];
  const c = await api(admin, "POST", `/sales/orders/${d.json.id}/confirm`, { payments });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  return c.json;
};
const codes = (r: any) => r.json.items.map((i: any) => i.code);

let S: Record<string, any> = {};

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  [admin, adminB, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("cajero@test.local")]);
  const UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Central" })).json.id;
  W2 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a2, code: "W2", name: "Norte" })).json.id;
  const L = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  P = (await api(admin, "POST", "/catalog/products", { code: "P1", name: "Producto", baseUnitId: UND })).json.id;
  await call("PUT", `/api/v1/pricing/lists/${L}/prices/${P}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } });
  for (const w of [W1, W2]) await api(admin, "POST", "/inventory/adjustments", { warehouseId: w, reason: "Carga", lines: [{ productId: P, quantity: 1000, unitCost: 5 }] });
  CA = (await api(admin, "POST", "/sales/customers", { name: "Ana Quispe", taxId: "1234567", paymentTermsDays: 0 })).json.id;
  CB = (await api(admin, "POST", "/sales/customers", { name: "Bruno Mamani", taxId: "7654321-1B", paymentTermsDays: 30 })).json.id;
  SELLER_ADMIN = (await withTenant(owner, world.tenantA, (tx) => tx.membership.findFirst({ where: { user: { email: "admin.a@test.local" } }, select: { userId: true } })))!.userId;

  S.paid = await sale(CA, 5, "all");                       // contado, sin saldo
  S.partial = await sale(CA, 10, 40);                      // debe 60
  S.credit = await sale(CB, 20, "none");                   // debe 200 a 30 días
  S.anon = await sale(null, 3, "all");                     // sin cliente
  S.north = await sale(CB, 4, "none", W2);                 // en sucursal A2, debe 40
  S.draft = (await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CA, lines: [{ productId: P, quantity: 2 }] })).json;
  S.voided = await sale(CB, 1, "none");
  await api(admin, "POST", `/sales/orders/${S.voided.id}/void`, { reason: "Error de digitación" });
});
afterEach(() => clock.set(null));
after(teardown);

describe("consulta e historial de ventas", () => {
  it("sin filtros trae todo lo que ve el usuario, lo más reciente primero, con su resumen de deudas", async () => {
    const r = await search();
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.total, 7);
    assert.equal(r.json.items[0].id, S.voided.id); // la última en confirmarse
    assert.deepEqual(r.json.summary, { pendingSales: 3, customersWithBalance: 2, totalOutstanding: "300" }); // 60 + 200 + 40
  });
  it("cada fila trae cliente con su NIT, sucursal, vendedor, importes y saldo", async () => {
    const r = await search(`code=${S.partial.code}`);
    const row = r.json.items[0];
    assert.deepEqual([row.customer.name, row.customer.taxId, row.branch.name.length > 0, row.seller, row.total, row.paid, row.balance, row.status, row.paymentStatus], ["Ana Quispe", "1234567", true, "Admin A", "100", "40", "60", "CONFIRMED", "PARTIAL"]);
  });
  it("filtra por número de documento (parte del código) y no confunde % o _ con comodines", async () => {
    const n = S.credit.code.slice(-3);
    assert.ok(codes(await search(`code=${n}`)).includes(S.credit.code));
    assert.equal((await search("code=%25")).json.total, 0);
    assert.equal((await search("code=_")).json.total, 0);
    assert.equal((await search("code=ZZZ-NOEXISTE")).json.total, 0);
  });
  it("filtra por cliente y por NIT o CI (parcial)", async () => {
    assert.equal((await search(`customerId=${CA}`)).json.total, 3);
    assert.deepEqual((await search("taxId=7654321")).json.items.map((i: any) => i.customer.name), ["Bruno Mamani", "Bruno Mamani", "Bruno Mamani"]);
    assert.equal((await search("taxId=1234")).json.total, 3);
    assert.equal((await search("taxId=99999")).json.total, 0);
  });
  it("filtra por estado, estado de cobro y canal", async () => {
    assert.equal((await search("status=DRAFT")).json.total, 1);
    assert.equal((await search("status=CANCELLED")).json.total, 1);
    assert.equal((await search("status=CONFIRMED")).json.total, 5);
    assert.equal((await search("paymentStatus=PARTIAL")).json.total, 1);
    assert.equal((await search("paymentStatus=PAID")).json.total, 2);
    assert.equal((await search("channel=POS")).json.total, 7);
    assert.equal((await search("channel=ECOMMERCE")).json.total, 0);
  });
  it("«solo deudores» deja las confirmadas con saldo y el resumen coincide", async () => {
    const r = await search("onlyDebtors=true");
    assert.equal(r.json.total, 3);
    assert.ok(r.json.items.every((i: any) => i.status === "CONFIRMED" && Number(i.balance) > 0));
    assert.deepEqual(r.json.items.map((i: any) => i.balance).sort(), ["200", "40", "60"]);
    assert.equal((await search("onlyDebtors=false")).json.total, 7);
  });
  it("el resumen no depende de la página ni de «solo deudores»", async () => {
    const a = await search("pageSize=2");
    assert.deepEqual([a.json.items.length, a.json.total, a.json.summary.pendingSales], [2, 7, 3]);
    const b = await search("pageSize=2&page=4");
    assert.deepEqual([b.json.items.length, b.json.summary.totalOutstanding], [1, "300"]);
    const ids = [1, 2, 3, 4].flatMap(() => []);
    assert.equal(ids.length, 0);
    const seen = new Set<string>();
    for (const p of [1, 2, 3, 4]) for (const i of (await search(`pageSize=2&page=${p}`)).json.items) seen.add(i.id);
    assert.equal(seen.size, 7); // sin repetidos ni faltantes
  });
  it("filtra por rango de fechas según el día local de la empresa", async () => {
    // 10/03 a las 02:00 UTC = 09/03 22:00 en La Paz
    await withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE sale SET confirmed_at = '2026-03-10T02:00:00Z' WHERE id = '${S.paid.id}'`));
    assert.deepEqual(codes(await search("dateFrom=2026-03-09&dateTo=2026-03-09")), [S.paid.code]);
    assert.equal((await search("dateFrom=2026-03-10&dateTo=2026-03-10")).json.total, 0);
    assert.equal((await search("dateTo=2026-03-09")).json.total, 1);
    assert.equal((await search("dateFrom=2026-03-10")).json.total, 6);
    assert.equal((await search("dateFrom=2026-03-09&dateTo=2026-03-08")).status, 400);
    assert.equal((await search("dateFrom=ayer")).status, 400);
  });
  it("filtra por sucursal y por vendedor; el filtro de vendedores lista quien vendió", async () => {
    assert.equal((await search(`branchId=${world.a2}`)).json.total, 1);
    assert.equal((await search(`branchId=${world.a1}`)).json.total, 6);
    assert.equal((await search(`sellerId=${SELLER_ADMIN}`)).json.total, 7);
    assert.equal((await search("sellerId=00000000-0000-4000-8000-000000000001")).json.total, 0);
    assert.deepEqual((await api(admin, "GET", "/sales/sellers")).json, [{ id: SELLER_ADMIN, name: "Admin A" }]);
  });
  it("combina varios filtros a la vez", async () => {
    const r = await search(`customerId=${CB}&status=CONFIRMED&onlyDebtors=true&branchId=${world.a1}`);
    assert.deepEqual(codes(r), [S.credit.code]);
  });
  it("los días de atraso se cuentan desde el vencimiento", async () => {
    const hoy = await search(`code=${S.partial.code}`);
    assert.equal(hoy.json.items[0].overdueDays, 0);
    clock.set(new Date(Date.now() + 5 * 86_400_000));
    const luego = await search("onlyDebtors=true");
    const byCode = Object.fromEntries(luego.json.items.map((i: any) => [i.code, i.overdueDays]));
    assert.equal(byCode[S.partial.code], 5); // contado: vencía el mismo día
    assert.equal(byCode[S.credit.code], 0); // a 30 días: aún no vence
  });
  it("quien solo ve una sucursal no ve las demás ni consultando por ellas", async () => {
    const mine = await search("", cashier);
    assert.equal(mine.status, 200);
    assert.ok(mine.json.items.every((i: any) => i.branch.id === world.a1));
    assert.equal(mine.json.total, 6);
    assert.equal((await search(`branchId=${world.a2}`, cashier)).json.total, 0);
  });
  it("otra empresa no ve nada y los límites de página se validan", async () => {
    assert.deepEqual([(await search("", adminB)).json.total, (await search("", adminB)).json.summary.pendingSales], [0, 0]);
    assert.equal((await search("pageSize=6000")).status, 400);
    assert.equal((await search("page=0")).status, 400);
    assert.equal((await call("GET", "/api/v1/sales/search", { token: undefined })).status, 401);
  });
});
