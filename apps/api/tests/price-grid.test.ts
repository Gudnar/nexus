import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { withTenant } from "@erp/db";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, cashier: string;
let LIST: string, BEB: string, BEBSUB: string, ABA: string;
let P1: string, P2: string, P3: string, P4: string;
type M = "GET" | "POST" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const grid = (qs = "", token = admin) => api(token, "GET", `/pricing/lists/${LIST}/grid${qs}`);
const bulk = (items: unknown[], token = admin) => api(token, "POST", `/pricing/lists/${LIST}/prices/bulk`, { items });
const quote = async (productId: string, quantity: number) => (await api(admin, "POST", "/pricing/quote", { productId, quantity, branchId: world.a1 })).json;
const tiersOf = (rows: any[], id: string) => rows.find((r) => r.productId === id).tiers.map((t: any) => [Number(t.minQuantity), Number(t.unitPrice)]);

before(async () => {
  await setup();
  [admin, adminB, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("cajero@test.local")]);
  const UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  BEB = (await api(admin, "POST", "/catalog/categories", { code: "BEB", name: "Bebidas" })).json.id;
  BEBSUB = (await api(admin, "POST", "/catalog/categories", { code: "GAS", name: "Gaseosas", parentId: BEB })).json.id;
  ABA = (await api(admin, "POST", "/catalog/categories", { code: "ABA", name: "Abarrotes" })).json.id;
  const mk = async (code: string, name: string, categoryId: string | null) => (await api(admin, "POST", "/catalog/products", { code, name, baseUnitId: UND, ...(categoryId ? { categoryId } : {}) })).json.id;
  P1 = await mk("GAS-1", "Gaseosa 500 ml", BEBSUB);
  P2 = await mk("AGU-1", "Agua 600 ml", BEB);
  P3 = await mk("ARR-1", "Arroz 1 kg", ABA);
  P4 = await mk("SIN-1", "Sin categoría", null);
  LIST = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  await call("PUT", `/api/v1/pricing/lists/${LIST}/prices/${P1}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } });
});
after(teardown);

describe("hoja de precios: lectura", () => {
  it("lista todos los productos activos con sus escalas, tengan o no precio", async () => {
    const r = await grid();
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.priceMode, r.json.scalingMode, r.json.currency, r.json.truncated], ["WITHOUT_TAX", "TIER_THRESHOLD", "BOB", false]);
    assert.deepEqual(r.json.items.map((i: any) => i.code), ["AGU-1", "ARR-1", "GAS-1", "SIN-1"]);
    assert.deepEqual(tiersOf(r.json.items, P1), [[1, 10]]);
    assert.deepEqual(tiersOf(r.json.items, P2), []);
    assert.equal(r.json.items.find((i: any) => i.code === "GAS-1").category, "Gaseosas");
  });
  it("filtra por categoría incluyendo sus subcategorías, y por texto", async () => {
    assert.deepEqual((await grid(`?categoryId=${BEB}`)).json.items.map((i: any) => i.code), ["AGU-1", "GAS-1"]);
    assert.deepEqual((await grid(`?categoryId=${BEBSUB}`)).json.items.map((i: any) => i.code), ["GAS-1"]);
    assert.deepEqual((await grid(`?q=arroz`)).json.items.map((i: any) => i.code), ["ARR-1"]);
    assert.equal((await grid("?categoryId=no-es-uuid")).status, 400);
  });
  it("quien solo lee precios puede ver la hoja pero no guardar", async () => {
    assert.equal((await grid("", cashier)).status, 200);
    assert.equal((await bulk([{ productId: P1, tiers: [{ minQuantity: 1, unitPrice: 5 }] }], cashier)).status, 403);
  });
  it("otra empresa no ve la lista", async () => {
    assert.equal((await grid("", adminB)).status, 404);
  });
});

describe("hoja de precios: guardado masivo", () => {
  it("guarda varios productos de una vez, con escalas distintas, y el cotizador las aplica", async () => {
    const r = await bulk([
      { productId: P1, tiers: [{ minQuantity: 1, unitPrice: 10 }, { minQuantity: 6, unitPrice: 9 }, { minQuantity: 13, unitPrice: 8.5 }] },
      { productId: P2, tiers: [{ minQuantity: 1, unitPrice: 4 }] },
      { productId: P3, tiers: [{ minQuantity: 12, unitPrice: 7 }, { minQuantity: 1, unitPrice: 8 }] }, // desordenado a propósito
    ]);
    assert.deepEqual([r.status, r.json.updated, r.json.unchanged], [200, 2 + 1, 0], JSON.stringify(r.json));
    assert.deepEqual([5, 6, 12, 13, 30].map(async () => 0).length, 5);
    const prices = await Promise.all([1, 5, 6, 12, 13, 30].map(async (q) => Number((await quote(P1, q)).unitPrice ?? (await quote(P1, q)).listUnitPrice)));
    assert.deepEqual(prices, [10, 10, 9, 9, 8.5, 8.5]);
    assert.deepEqual([Number((await quote(P2, 3)).unitPrice ?? (await quote(P2, 3)).listUnitPrice), Number((await quote(P3, 12)).unitPrice ?? (await quote(P3, 12)).listUnitPrice), Number((await quote(P3, 5)).unitPrice ?? (await quote(P3, 5)).listUnitPrice)], [4, 7, 8]);
    const g = (await grid()).json.items;
    assert.deepEqual(tiersOf(g, P3), [[1, 8], [12, 7]]); // quedan ordenadas
  });
  it("el máximo de cada tramo se deduce del mínimo del siguiente (sin huecos)", async () => {
    const rows = await withTenant(owner, world.tenantA, (tx) => tx.productPriceTier.findMany({ where: { productPrice: { productId: P1 } }, orderBy: { minQuantity: "asc" } }));
    assert.deepEqual(rows.map((t: any) => [Number(t.minQuantity), t.maxQuantity === null ? null : Number(t.maxQuantity)]), [[1, 6], [6, 13], [13, null]]);
  });
  it("lo que no cambió se informa como sin cambios y no ensucia el historial", async () => {
    const before = await withTenant(owner, world.tenantA, (tx) => tx.priceHistory.count());
    const r = await bulk([
      { productId: P2, tiers: [{ minQuantity: 1, unitPrice: 4 }] },
      { productId: P4, tiers: [{ minQuantity: 1, unitPrice: 2.5 }] },
    ]);
    assert.deepEqual([r.json.updated, r.json.unchanged], [1, 1]);
    assert.equal(await withTenant(owner, world.tenantA, (tx) => tx.priceHistory.count()), before + 1);
    const h = (await api(admin, "GET", `/pricing/lists/${LIST}/prices/${P4}/history`)).json;
    assert.ok(JSON.stringify(h).includes("2.5"));
  });
  it("todo o nada: si un producto no es válido no se guarda ninguno, y el mensaje dice cuál", async () => {
    const r = await bulk([
      { productId: P2, tiers: [{ minQuantity: 1, unitPrice: 99 }] },
      { productId: P3, tiers: [{ minQuantity: 1, unitPrice: 5 }, { minQuantity: 1, unitPrice: 6 }] }, // mismo mínimo
    ]);
    assert.deepEqual([r.status, r.json.code], [400, "INVALID_TIERS"]);
    assert.ok(r.json.errors.some((e: string) => e.startsWith("ARR-1:")), JSON.stringify(r.json.errors));
    assert.deepEqual(tiersOf((await grid()).json.items, P2), [[1, 4]]); // el válido tampoco se aplicó
  });
  it("rechaza productos repetidos, inexistentes, vacíos y precios negativos", async () => {
    assert.equal((await bulk([{ productId: P1, tiers: [{ minQuantity: 1, unitPrice: 1 }] }, { productId: P1, tiers: [{ minQuantity: 1, unitPrice: 2 }] }])).json.code, "DUPLICATE_PRODUCT");
    assert.equal((await bulk([{ productId: "00000000-0000-4000-8000-000000000001", tiers: [{ minQuantity: 1, unitPrice: 1 }] }])).status, 404);
    assert.equal((await bulk([])).status, 400);
    assert.equal((await bulk([{ productId: P1, tiers: [] }])).status, 400);
    assert.equal((await bulk([{ productId: P1, tiers: [{ minQuantity: 1, unitPrice: -1 }] }])).status, 400);
  });
  it("queda auditado y otra empresa no puede tocar la lista", async () => {
    assert.ok((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.count({ where: { action: "price.bulk_updated" } }))) >= 2);
    assert.equal((await api(adminB, "POST", `/pricing/lists/${LIST}/prices/bulk`, { items: [{ productId: P1, tiers: [{ minQuantity: 1, unitPrice: 1 }] }] })).status, 404);
  });
});
