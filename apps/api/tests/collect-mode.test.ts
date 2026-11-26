import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addMember } from "@erp/db";
import { PasswordService } from "../src/auth/password.service";
import { call, owner, PW, setup, teardown, tokenFor, world } from "./support";

let admin: string, cashier: string, seller: string, adminB: string;
let W1: string, P: string, CUST: string;
type M = "GET" | "POST" | "PUT" | "PATCH";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const draft = async (token: string, qty = 2) => (await api(token, "POST", "/sales/orders", { warehouseId: W1, customerId: CUST, lines: [{ productId: P, quantity: qty }] })).json;

before(async () => {
  await setup();
  const hash = await world.app.get(PasswordService).hash(PW);
  await addMember(owner, { tenantId: world.tenantA, email: "vendedor@test.local", name: "Vendedor", passwordHash: hash, roleCode: "seller", branches: [{ branchId: world.a1 }] });
  [admin, cashier, seller, adminB] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("cajero@test.local"), tokenFor("vendedor@test.local"), tokenFor("admin.b@test.local")]);
  const UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  const L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  P = (await api(admin, "POST", "/catalog/products", { code: "P1", name: "Producto", baseUnitId: UND })).json.id;
  await call("PUT", `/api/v1/pricing/lists/${L1}/prices/${P}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } });
  await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: P, quantity: 100, unitCost: 5 }] });
  CUST = (await api(admin, "POST", "/sales/customers", { name: "Ana Quispe", taxId: "1" })).json.id;
});
after(teardown);

describe("dónde se cobra: punto de venta o caja", () => {
  it("por defecto se cobra en el punto de venta y el vendedor puede confirmar", async () => {
    assert.deepEqual((await api(seller, "GET", "/sales/settings")).json, { collectMode: "AT_POS" });
    const d = await draft(seller);
    const r = await api(seller, "POST", `/sales/orders/${d.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 20 }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  });

  it("solo quien administra la empresa cambia el modo", async () => {
    assert.equal((await api(cashier, "PUT", "/sales/settings", { collectMode: "AT_CASHIER" })).status, 403);
    assert.equal((await api(admin, "PUT", "/sales/settings", { collectMode: "OTRO" })).status, 400);
    const r = await api(admin, "PUT", "/sales/settings", { collectMode: "AT_CASHIER" });
    assert.equal(r.status, 200);
    assert.deepEqual((await api(seller, "GET", "/sales/settings")).json, { collectMode: "AT_CASHIER" });
  });

  it("el cajero, el gerente y el administrador traen el permiso; el vendedor no", async () => {
    const perms = async (t: string) => (await api(t, "GET", "/me")).json.permissions as string[];
    assert.ok((await perms(cashier)).includes("sales.collect_pending"));
    assert.ok((await perms(admin)).includes("sales.collect_pending"));
    assert.ok(!(await perms(seller)).includes("sales.collect_pending"));
  });

  it("con cobro en caja, el vendedor guarda pero no puede confirmar", async () => {
    const d = await draft(seller);
    assert.equal(d.status, "DRAFT");
    const r = await api(seller, "POST", `/sales/orders/${d.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 20 }] });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "COLLECT_BY_CASHIER");
    assert.equal((await api(admin, "GET", `/sales/orders/${d.id}`)).json.status, "DRAFT");
  });

  it("el cajero ve la venta guardada entre las pendientes y la cobra", async () => {
    const d = await draft(seller, 3);
    const list = (await api(cashier, "GET", "/sales/search?status=DRAFT&pageSize=100")).json;
    assert.ok(list.items.some((s: { id: string }) => s.id === d.id));
    const r = await api(cashier, "POST", `/sales/orders/${d.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 30 }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status, "CONFIRMED");
    assert.equal(Number(r.json.balance), 0);
    const after = (await api(cashier, "GET", "/sales/search?status=DRAFT&pageSize=100")).json;
    assert.ok(!after.items.some((s: { id: string }) => s.id === d.id));
  });

  it("el cajero puede cobrar a crédito dejando saldo", async () => {
    const d = await draft(seller, 1);
    const r = await api(cashier, "POST", `/sales/orders/${d.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 4 }], dueDate: "2099-01-01" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(Number(r.json.balance), 6);
  });

  it("volver al cobro en el punto de venta devuelve el permiso de confirmar al vendedor", async () => {
    await api(admin, "PUT", "/sales/settings", { collectMode: "AT_POS" });
    const d = await draft(seller);
    assert.equal((await api(seller, "POST", `/sales/orders/${d.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 20 }] })).status, 200);
  });

  it("cada empresa tiene su propio modo", async () => {
    await api(admin, "PUT", "/sales/settings", { collectMode: "AT_CASHIER" });
    assert.deepEqual((await api(adminB, "GET", "/sales/settings")).json, { collectMode: "AT_POS" });
    await api(admin, "PUT", "/sales/settings", { collectMode: "AT_POS" });
  });
});
