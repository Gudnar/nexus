import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createDb, uuidv7, withTenant } from "@erp/db";
import { Clock } from "../src/access/clock";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string;
let clock: Clock;
let UND: string;
const AT = "2026-11-23";

type M = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });
const ok = async (r: Promise<{ status: number; json: any }>, status = 201) => {
  const x = await r;
  assert.equal(x.status, status, JSON.stringify(x.json));
  return x.json;
};

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  admin = await tokenFor("admin.a@test.local");
  adminB = await tokenFor("admin.b@test.local");
  manager = await tokenFor("multi@test.local", "empresa-a");
  cashier = await tokenFor("cajero@test.local");
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
});
after(teardown);
afterEach(() => clock.set(null));

const tiers3 = [
  { minQuantity: 1, maxQuantity: 10, unitPrice: 10 },
  { minQuantity: 10, maxQuantity: 50, unitPrice: 9 },
  { minQuantity: 50, unitPrice: 8 },
];
const list = (over: object = {}) => ({ code: `L${uuidv7().slice(-6)}`, name: "Lista", priceMode: "WITHOUT_TAX", ...over });
let seq = 0;
async function newProduct(over: object = {}) {
  return ok(api(admin, "POST", "/catalog/products", { name: `Prod ${++seq}`, baseUnitId: UND, ...over }));
}
const quote = (body: object, token = admin) => api(token, "POST", "/pricing/quote", { at: AT, ...body });

describe("impuestos: tributos y tasas por vigencia", () => {
  it("crea un tributo con su tasa inicial; rechaza duplicados y tasas inválidas", async () => {
    const iva = await ok(api(admin, "POST", "/taxes/codes", { code: "iva", name: "IVA", jurisdiction: "BO", rate: { rate: 13, validFrom: "2020-01-01" } }));
    assert.equal(iva.code, "IVA");
    assert.equal(Number(iva.currentRate), 13);
    assert.equal((await api(admin, "POST", "/taxes/codes", { code: "IVA", name: "Otro", rate: { rate: 5, validFrom: "2020-01-01" } })).json.code, "CODE_TAKEN");
    assert.equal((await api(admin, "POST", "/taxes/codes", { code: "X", name: "Xx", rate: { rate: 101, validFrom: "2020-01-01" } })).status, 400);
    assert.equal((await api(admin, "POST", "/taxes/codes", { code: "X", name: "Xx", rate: { rate: -1, validFrom: "2020-01-01" } })).status, 400);
    assert.equal((await api(admin, "POST", "/taxes/codes", { code: "X", name: "Xx", rate: { rate: 1.1234567, validFrom: "2020-01-01" } })).status, 400);
    assert.equal((await api(admin, "POST", "/taxes/codes", { code: "X", name: "Xx", rate: { rate: 1, validFrom: "01/01/2020" } })).status, 400);
    await ok(api(admin, "POST", "/taxes/codes", { code: "IT", name: "Impuesto a las transacciones", rate: { rate: 3, validFrom: "2020-01-01" } }));
  });

  it("una tasa nueva cierra la anterior el día previo y no altera el pasado", async () => {
    const codes = (await api(admin, "GET", "/taxes/codes")).json;
    const iva = codes.find((c: { code: string }) => c.code === "IVA");
    const after = await ok(api(admin, "POST", `/taxes/codes/${iva.id}/rates`, { rate: 14, validFrom: "2026-06-01" }), 201);
    assert.deepEqual(after.rates.map((r: { rate: string; validFrom: string; validTo: string | null }) => [Number(r.rate), r.validFrom, r.validTo]), [
      [13, "2020-01-01", "2026-05-31"], [14, "2026-06-01", null],
    ]);
    clock.set(new Date("2026-11-23T16:00:00Z"));
    assert.equal(Number((await api(admin, "GET", "/taxes/codes")).json.find((c: { code: string }) => c.code === "IVA").currentRate), 14);
    clock.set(new Date("2026-01-10T16:00:00Z"));
    assert.equal(Number((await api(admin, "GET", "/taxes/codes")).json.find((c: { code: string }) => c.code === "IVA").currentRate), 13);
  });

  it("no admite tasas que se solapen o empiecen antes de la vigente", async () => {
    const iva = (await api(admin, "GET", "/taxes/codes")).json.find((c: { code: string }) => c.code === "IVA");
    for (const validFrom of ["2026-06-01", "2026-03-01", "2019-01-01"]) {
      const r = await api(admin, "POST", `/taxes/codes/${iva.id}/rates`, { rate: 15, validFrom });
      assert.equal(r.status, 409, validFrom);
      assert.equal(r.json.code, "RATE_OVERLAP");
    }
  });

  it("perfiles fiscales: reglas por tributo, exenciones con motivo, sin duplicados", async () => {
    const codes = (await api(admin, "GET", "/taxes/codes")).json;
    const iva = codes.find((c: { code: string }) => c.code === "IVA").id;
    const it = codes.find((c: { code: string }) => c.code === "IT").id;
    const general = await ok(api(admin, "POST", "/taxes/profiles", { code: "general", name: "General", rules: [{ taxCodeId: iva, priority: 1 }, { taxCodeId: it, priority: 2 }] }));
    assert.deepEqual(general.rules.map((r: { taxCode: string }) => r.taxCode), ["IVA", "IT"]);
    assert.equal((await api(admin, "POST", "/taxes/profiles", { code: "DUP", name: "Dup", rules: [{ taxCodeId: iva }, { taxCodeId: iva }] })).json.code, "RULE_DUPLICATE");
    assert.equal((await api(admin, "POST", "/taxes/profiles", { code: "GHOST", name: "Fantasma", rules: [{ taxCodeId: uuidv7() }] })).status, 404);
    assert.equal((await api(admin, "POST", "/taxes/profiles", { code: "GENERAL", name: "Otra" })).json.code, "CODE_TAKEN");
    await ok(api(admin, "POST", "/taxes/profiles", { code: "EXPORT", name: "Exportación", rules: [{ taxCodeId: iva, exemptionReason: "Exportación de bienes" }] }));
    assert.equal((await api(admin, "POST", "/taxes/profiles", { code: "SHORT", name: "Motivo corto", rules: [{ taxCodeId: iva, exemptionReason: "x" }] })).status, 400);
    const upd = await ok(api(admin, "PATCH", `/taxes/profiles/${general.id}`, { rules: [{ taxCodeId: iva }] }), 200);
    assert.equal(upd.rules.length, 1);
    await ok(api(admin, "PATCH", `/taxes/profiles/${general.id}`, { rules: [{ taxCodeId: iva, priority: 1 }, { taxCodeId: it, priority: 2 }] }), 200);
  });

  it("solo un perfil de productos puede asignarse a un producto", async () => {
    const cust = await ok(api(admin, "POST", "/taxes/profiles", { code: "CLI", name: "Perfil de clientes", appliesTo: "CUSTOMER" }));
    const r = await api(admin, "POST", "/catalog/products", { name: "Con perfil ajeno", baseUnitId: UND, taxProfileId: cust.id });
    assert.equal(r.json.code, "TAX_PROFILE_KIND");
    const profiles = (await api(admin, "GET", "/taxes/profiles")).json;
    const ok1 = await ok(api(admin, "POST", "/catalog/products", { name: "Con perfil", baseUnitId: UND, taxProfileId: profiles.find((p: { code: string }) => p.code === "GENERAL").id }));
    assert.equal(ok1.taxProfile.code, "GENERAL");
    assert.equal((await api(admin, "GET", "/taxes/profiles")).json.find((p: { code: string }) => p.code === "GENERAL").products, 1);
  });

  it("permisos: el cajero lee pero no modifica; B no ve los de A", async () => {
    assert.equal((await api(cashier, "GET", "/taxes/codes")).status, 200);
    assert.equal((await api(cashier, "POST", "/taxes/codes", { code: "Z", name: "Zz", rate: { rate: 1, validFrom: "2020-01-01" } })).status, 403);
    assert.deepEqual((await api(adminB, "GET", "/taxes/codes")).json, []);
    assert.deepEqual((await api(adminB, "GET", "/taxes/profiles")).json, []);
  });
});

describe("listas de precios", () => {
  it("crea listas con ámbito, modalidad y vigencia; valida las combinaciones", async () => {
    const branch = world.a2;
    const g = await ok(api(admin, "POST", "/pricing/lists", list({ code: "general", name: "General", scalingMode: "TIER_THRESHOLD" })));
    assert.equal(g.code, "GENERAL");
    assert.equal(g.scope, "TENANT");
    assert.equal(g.currency, "BOB");
    await ok(api(admin, "POST", "/pricing/lists", list({ scope: "BRANCH", branchId: branch })));
    await ok(api(admin, "POST", "/pricing/lists", list({ scope: "CHANNEL", channel: "POS", priceMode: "WITH_TAX" })));
    const bad = (over: object) => api(admin, "POST", "/pricing/lists", list(over));
    assert.equal((await bad({ scope: "BRANCH" })).status, 400, "sucursal obligatoria");
    assert.equal((await bad({ scope: "TENANT", branchId: branch })).status, 400, "sucursal solo para su ámbito");
    assert.equal((await bad({ scope: "CHANNEL" })).status, 400, "canal obligatorio");
    assert.equal((await bad({ validFrom: "2026-12-01", validTo: "2026-11-01" })).status, 400);
    assert.equal((await bad({ currency: "bolivianos" })).status, 400);
    assert.equal((await bad({ priceMode: "OTRA" })).status, 400);
    assert.equal((await bad({ code: "GENERAL" })).json.code, "CODE_TAKEN");
    assert.equal((await bad({ scope: "BRANCH", branchId: world.b1 })).status, 404, "sucursal de otra empresa");
  });

  it("la modalidad no cambia cuando la lista ya tiene precios", async () => {
    const l = await ok(api(admin, "POST", "/pricing/lists", list({ code: "LOCK" })));
    const p = await newProduct();
    assert.equal((await api(admin, "PATCH", `/pricing/lists/${l.id}`, { priceMode: "WITH_TAX" })).json.priceMode, "WITH_TAX", "sin precios sí se puede");
    await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${p.id}`, { tiers: [{ minQuantity: 1, unitPrice: 5 }] }), 200);
    const r = await api(admin, "PATCH", `/pricing/lists/${l.id}`, { priceMode: "WITHOUT_TAX" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "MODE_LOCKED");
    assert.equal((await api(admin, "PATCH", `/pricing/lists/${l.id}`, { name: "Renombrada", priority: 3 })).json.name, "Renombrada");
  });

  it("el cajero lee las listas pero no las modifica; el gerente sí", async () => {
    assert.equal((await api(cashier, "GET", "/pricing/lists")).status, 200);
    assert.equal((await api(cashier, "POST", "/pricing/lists", list())).status, 403);
    assert.equal((await api(manager, "POST", "/pricing/lists", list())).status, 201);
  });
});

describe("precios por tramos", () => {
  it("guarda tramos válidos y los lista; rechaza huecos, solapes y precios negativos", async () => {
    const l = await ok(api(admin, "POST", "/pricing/lists", list({ code: "TRAMOS" })));
    const p = await newProduct({ code: "TR-1" });
    await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${p.id}`, { tiers: tiers3 }), 200);
    const rows = (await api(admin, "GET", `/pricing/lists/${l.id}/prices`)).json;
    assert.equal(rows.items.length, 1);
    assert.deepEqual(rows.items[0].tiers.map((t: { minQuantity: string; maxQuantity: string | null; unitPrice: string }) => [Number(t.minQuantity), t.maxQuantity === null ? null : Number(t.maxQuantity), Number(t.unitPrice)]), [[1, 10, 10], [10, 50, 9], [50, null, 8]]);

    const bad = async (tiers: object[]) => api(admin, "PUT", `/pricing/lists/${l.id}/prices/${p.id}`, { tiers });
    const gap = await bad([{ minQuantity: 1, maxQuantity: 10, unitPrice: 10 }, { minQuantity: 12, unitPrice: 9 }]);
    assert.equal(gap.status, 400);
    assert.equal(gap.json.code, "INVALID_TIERS");
    assert.ok(gap.json.errors.length > 0);
    assert.equal((await bad([{ minQuantity: 1, maxQuantity: 10, unitPrice: 10 }, { minQuantity: 8, unitPrice: 9 }])).json.code, "INVALID_TIERS");
    assert.equal((await bad([{ minQuantity: 1, maxQuantity: 10, unitPrice: 10 }])).json.code, "INVALID_TIERS", "el último debe quedar abierto");
    assert.equal((await bad([{ minQuantity: 1, unitPrice: -5 }])).status, 400);
    assert.equal((await bad([])).status, 400);
    // los tramos rechazados no dejaron nada a medias
    assert.equal((await api(admin, "GET", `/pricing/lists/${l.id}/prices`)).json.items[0].tiers.length, 3);
  });

  it("cada cambio queda en el historial con el antes y el después; se puede quitar un precio", async () => {
    const l = await ok(api(admin, "POST", "/pricing/lists", list({ code: "HIST" })));
    const p = await newProduct();
    await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${p.id}`, { tiers: [{ minQuantity: 1, unitPrice: 5 }] }), 200);
    await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${p.id}`, { tiers: [{ minQuantity: 1, unitPrice: 7.5 }] }), 200);
    assert.equal((await api(admin, "DELETE", `/pricing/lists/${l.id}/prices/${p.id}`)).status, 204);
    const h = (await api(admin, "GET", `/pricing/lists/${l.id}/prices/${p.id}/history`)).json;
    assert.equal(h.length, 3);
    assert.equal(h[2].before, null, "el alta no tiene 'antes'");
    assert.equal(Number(h[1].before[0].price), 5);
    assert.equal(Number(h[1].after[0].price), 7.5);
    assert.equal(h[0].after, null, "el retiro no tiene 'después'");
    assert.equal((await api(admin, "DELETE", `/pricing/lists/${l.id}/prices/${p.id}`)).status, 404);
  });

  it("el historial es append-only para la aplicación (solo SELECT e INSERT)", async () => {
    const l = (await api(admin, "GET", "/pricing/lists")).json.find((x: { code: string }) => x.code === "HIST");
    const app = createDb(process.env.DATABASE_URL);
    try {
      const before = await withTenant(app, world.tenantA, (tx) => tx.priceHistory.count({ where: { priceListId: l.id } }));
      assert.equal(before, 3);
      await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.priceHistory.updateMany({ where: { priceListId: l.id }, data: { actorId: null } })), /permission denied|denegado/i);
      await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.priceHistory.deleteMany({ where: { priceListId: l.id } })), /permission denied|denegado/i);
      assert.equal(await withTenant(app, world.tenantA, (tx) => tx.priceHistory.count({ where: { priceListId: l.id } })), 3, "el historial sigue intacto");
    } finally {
      await app.$disconnect();
    }
  });

  it("el cajero no puede cambiar precios", async () => {
    const l = (await api(admin, "GET", "/pricing/lists")).json[0];
    const p = await newProduct();
    assert.equal((await api(cashier, "PUT", `/pricing/lists/${l.id}/prices/${p.id}`, { tiers: [{ minQuantity: 1, unitPrice: 1 }] })).status, 403);
    assert.equal((await api(cashier, "GET", `/pricing/lists/${l.id}/prices/${p.id}/history`)).status, 403);
  });

  it("pagina y busca productos dentro de una lista", async () => {
    const l = await ok(api(admin, "POST", "/pricing/lists", list({ code: "PAG" })));
    for (let i = 1; i <= 6; i++) {
      const p = await newProduct({ code: `PG-${i}`, name: `Paginado ${i}` });
      await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${p.id}`, { tiers: [{ minQuantity: 1, unitPrice: i }] }), 200);
    }
    const first = (await api(admin, "GET", `/pricing/lists/${l.id}/prices?limit=4`)).json;
    assert.equal(first.items.length, 4);
    const second = (await api(admin, "GET", `/pricing/lists/${l.id}/prices?limit=4&cursor=${first.nextCursor}`)).json;
    assert.deepEqual([...first.items, ...second.items].map((i: { code: string }) => i.code), ["PG-1", "PG-2", "PG-3", "PG-4", "PG-5", "PG-6"]);
    assert.equal(second.nextCursor, null);
    assert.equal((await api(admin, "GET", `/pricing/lists/${l.id}/prices?q=paginado 3`)).json.items.length, 1);
  });
});

describe("cotización: precio e impuestos", () => {
  let taxed: { id: string }, exempt: { id: string }, plain: { id: string };
  let L: { id: string };

  before(async () => {
    const profiles = (await api(admin, "GET", "/taxes/profiles")).json;
    const gen = profiles.find((p: { code: string }) => p.code === "GENERAL").id;
    const exp = profiles.find((p: { code: string }) => p.code === "EXPORT").id;
    taxed = await newProduct({ code: "Q-TAX", taxProfileId: gen });
    exempt = await newProduct({ code: "Q-EXE", taxProfileId: exp });
    plain = await newProduct({ code: "Q-PLN" });
    L = await ok(api(admin, "POST", "/pricing/lists", list({ code: "Q-SIN", name: "Sin impuestos", priority: 10 })));
    for (const p of [taxed, exempt, plain]) await ok(api(admin, "PUT", `/pricing/lists/${L.id}/prices/${p.id}`, { tiers: tiers3 }), 200);
  });

  it("lista SIN impuestos: los tributos se suman (a la tasa vigente en la fecha)", async () => {
    // 10 u × 9,00 = 90,00 → IVA 14 % (desde 2026-06-01) = 12,60 · IT 3 % = 2,70
    const q = (await quote({ productId: taxed.id, quantity: 10 })).json;
    assert.equal(q.priceList.priceMode, "WITHOUT_TAX");
    assert.equal(q.lineAmount, "90.00");
    assert.equal(q.unitPrice, "9");
    assert.equal(q.tax.net, "90.00");
    assert.deepEqual(q.tax.taxes.map((t: { code: string; amount: string }) => [t.code, t.amount]), [["IVA", "12.60"], ["IT", "2.70"]]);
    assert.equal(q.tax.total, "105.30");
    // antes del cambio de tasa (13 %): se respeta la vigencia
    const old = (await quote({ productId: taxed.id, quantity: 10, at: "2026-03-01" })).json;
    assert.equal(old.tax.taxes[0].amount, "11.70");
    assert.equal(old.tax.total, "104.40");
  });

  it("producto exento: el tributo no suma pero queda el motivo; sin perfil: sin impuestos", async () => {
    const e = (await quote({ productId: exempt.id, quantity: 10 })).json;
    assert.equal(e.tax.taxes[0].exempt, true);
    assert.equal(e.tax.taxes[0].exemptionReason, "Exportación de bienes");
    assert.equal(e.tax.total, "90.00");
    const p = (await quote({ productId: plain.id, quantity: 10 })).json;
    assert.deepEqual([p.tax.taxes.length, p.tax.total], [0, "90.00"]);
  });

  it("lista CON impuestos: el importe ya los incluye y se desglosa", async () => {
    const w = await ok(api(admin, "POST", "/pricing/lists", list({ code: "Q-CON", priceMode: "WITH_TAX", priority: 20 })));
    await ok(api(admin, "PUT", `/pricing/lists/${w.id}/prices/${taxed.id}`, { tiers: [{ minQuantity: 1, unitPrice: 117 }] }), 200);
    const q = (await quote({ productId: taxed.id, quantity: 1 })).json;
    assert.equal(q.priceList.code, "Q-CON");
    assert.equal(q.lineAmount, "117.00");
    assert.equal(q.tax.total, "117.00", "el total es exactamente el precio de la lista");
    assert.equal(q.tax.net, "100.00");
    assert.deepEqual(q.tax.taxes.map((t: { amount: string }) => t.amount), ["14.00", "3.00"]);
    await ok(api(admin, "PATCH", `/pricing/lists/${w.id}`, { status: "INACTIVE" }), 200);
  });

  it("tramo vs progresivo según la lista", async () => {
    const pr = await ok(api(admin, "POST", "/pricing/lists", list({ code: "Q-PRO", scalingMode: "PROGRESSIVE", priority: 30 })));
    await ok(api(admin, "PUT", `/pricing/lists/${pr.id}/prices/${plain.id}`, { tiers: tiers3 }), 200);
    const q = (await quote({ productId: plain.id, quantity: 25 })).json;
    assert.equal(q.priceList.scalingMode, "PROGRESSIVE");
    assert.equal(q.lineAmount, "234.00", "9 × 10 + 16 × 9");
    assert.deepEqual(q.breakdown.map((b: { quantity: string; unitPrice: string }) => [Number(b.quantity), Number(b.unitPrice)]), [[9, 10], [16, 9]]);
    const t = (await quote({ productId: plain.id, quantity: 25, priceListId: L.id })).json;
    assert.equal(t.lineAmount, "225.00", "25 × 9 por tramo");
    assert.equal(t.resolvedBy, "EXPLICIT");
    await ok(api(admin, "PATCH", `/pricing/lists/${pr.id}`, { status: "INACTIVE" }), 200);
  });

  it("redondea al número de decimales de la lista", async () => {
    const r = await ok(api(admin, "POST", "/pricing/lists", list({ code: "Q-RED", roundingDecimals: 0, priority: 40 })));
    await ok(api(admin, "PUT", `/pricing/lists/${r.id}/prices/${plain.id}`, { tiers: [{ minQuantity: 1, unitPrice: 3.3333 }] }), 200);
    const q = (await quote({ productId: plain.id, quantity: 3 })).json; // 9,9999 → 10
    assert.equal(q.lineAmount, "10");
    await ok(api(admin, "PATCH", `/pricing/lists/${r.id}`, { status: "INACTIVE" }), 200);
  });

  it("errores: producto inexistente/inactivo, cantidad inválida, sin tasa vigente", async () => {
    assert.equal((await quote({ productId: uuidv7(), quantity: 1 })).status, 404);
    assert.equal((await quote({ productId: plain.id, quantity: 0 })).status, 400);
    assert.equal((await quote({ productId: plain.id, quantity: -2 })).status, 400);
    const noRate = await quote({ productId: taxed.id, quantity: 1, at: "2019-05-01" });
    assert.equal(noRate.status, 409);
    assert.equal(noRate.json.code, "NO_TAX_RATE");
    const gone = await newProduct();
    await ok(api(admin, "PATCH", `/catalog/products/${gone.id}`, { status: "INACTIVE" }), 200);
    assert.equal((await quote({ productId: gone.id, quantity: 1 })).json.code, "PRODUCT_INACTIVE");
    const unpriced = await newProduct();
    assert.equal((await quote({ productId: unpriced.id, quantity: 1 })).status, 404);
  });
});

describe("cotización: qué lista se elige", () => {
  let prod: { id: string };
  const mk = async (code: string, over: object, price: number) => {
    const l = await ok(api(admin, "POST", "/pricing/lists", list({ code, ...over })));
    await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${prod.id}`, { tiers: [{ minQuantity: 1, unitPrice: price }] }), 200);
    return l;
  };

  before(async () => {
    // desactiva las listas de los bloques anteriores para aislar la precedencia
    for (const l of (await api(admin, "GET", "/pricing/lists")).json) await api(admin, "PATCH", `/pricing/lists/${l.id}`, { status: "INACTIVE" });
    prod = await newProduct({ code: "PREC-1" });
  });

  it("general < canal < sucursal; y la lista explícita manda sobre todo", async () => {
    const gen = await mk("P-GEN", {}, 10);
    await mk("P-POS", { scope: "CHANNEL", channel: "POS" }, 9.5);
    await mk("P-A2", { scope: "BRANCH", branchId: world.a2 }, 9);
    assert.deepEqual([(await quote({ productId: prod.id, quantity: 1 })).json.resolvedBy, (await quote({ productId: prod.id, quantity: 1 })).json.lineAmount], ["GENERAL", "10.00"]);
    const ch = (await quote({ productId: prod.id, quantity: 1, channel: "POS" })).json;
    assert.deepEqual([ch.resolvedBy, ch.lineAmount], ["CHANNEL", "9.50"]);
    const br = (await quote({ productId: prod.id, quantity: 1, branchId: world.a2 })).json;
    assert.deepEqual([br.resolvedBy, br.lineAmount], ["BRANCH", "9.00"]);
    const both = (await quote({ productId: prod.id, quantity: 1, branchId: world.a2, channel: "POS" })).json;
    assert.equal(both.resolvedBy, "BRANCH", "la sucursal es más específica que el canal");
    const other = (await quote({ productId: prod.id, quantity: 1, branchId: world.a1 })).json;
    assert.equal(other.resolvedBy, "GENERAL", "la lista de A2 no aplica a A1");
    const ex = (await quote({ productId: prod.id, quantity: 1, branchId: world.a2, priceListId: gen.id })).json;
    assert.deepEqual([ex.resolvedBy, ex.lineAmount], ["EXPLICIT", "10.00"]);
  });

  it("dentro del mismo ámbito gana la mayor prioridad", async () => {
    await mk("P-GEN-VIP", { priority: 5 }, 8);
    assert.equal((await quote({ productId: prod.id, quantity: 1 })).json.lineAmount, "8.00");
  });

  it("si la lista preferida no tiene el producto o la cantidad, se pasa a la siguiente", async () => {
    const other = await newProduct({ code: "PREC-2" });
    const l = (await api(admin, "GET", "/pricing/lists")).json.find((x: { code: string }) => x.code === "P-A2");
    // PREC-2 solo tiene precio en la lista general
    const gen = (await api(admin, "GET", "/pricing/lists")).json.find((x: { code: string }) => x.code === "P-GEN");
    await ok(api(admin, "PUT", `/pricing/lists/${gen.id}/prices/${other.id}`, { tiers: [{ minQuantity: 1, unitPrice: 4 }] }), 200);
    assert.equal((await quote({ productId: other.id, quantity: 1, branchId: world.a2 })).json.resolvedBy, "GENERAL");
    // la lista de A2 exige mínimo 5: con 3 unidades cae a la general
    await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${prod.id}`, { tiers: [{ minQuantity: 5, unitPrice: 1 }] }), 200);
    assert.equal((await quote({ productId: prod.id, quantity: 3, branchId: world.a2 })).json.resolvedBy, "GENERAL");
    assert.equal((await quote({ productId: prod.id, quantity: 5, branchId: world.a2 })).json.resolvedBy, "BRANCH");
  });

  it("por debajo del mínimo de TODAS las listas: BELOW_MINIMUM", async () => {
    const solo = await newProduct({ code: "PREC-3" });
    const l = await ok(api(admin, "POST", "/pricing/lists", list({ code: "P-MIN", priority: 99 })));
    await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${solo.id}`, { tiers: [{ minQuantity: 12, unitPrice: 2 }] }), 200);
    const r = await quote({ productId: solo.id, quantity: 6 });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "BELOW_MINIMUM");
    await api(admin, "PATCH", `/pricing/lists/${l.id}`, { status: "INACTIVE" });
  });

  it("respeta la vigencia de la lista y su estado", async () => {
    const prod2 = await newProduct({ code: "PREC-4" });
    const l = await ok(api(admin, "POST", "/pricing/lists", list({ code: "P-VIG", priority: 50, validFrom: "2026-12-01", validTo: "2026-12-31" })));
    await ok(api(admin, "PUT", `/pricing/lists/${l.id}/prices/${prod2.id}`, { tiers: [{ minQuantity: 1, unitPrice: 1 }] }), 200);
    assert.equal((await quote({ productId: prod2.id, quantity: 1, at: "2026-11-30" })).status, 404, "aún no vigente");
    assert.equal((await quote({ productId: prod2.id, quantity: 1, at: "2026-12-15" })).json.priceList.code, "P-VIG");
    assert.equal((await quote({ productId: prod2.id, quantity: 1, at: "2027-01-01" })).status, 404, "ya venció");
    const bad = await quote({ productId: prod2.id, quantity: 1, at: "2026-11-30", priceListId: l.id });
    assert.equal(bad.json.code, "LIST_NOT_APPLICABLE");
  });

  it("el cajero cotiza en su sucursal, pero no en una ajena", async () => {
    assert.equal((await quote({ productId: prod.id, quantity: 1, branchId: world.a1 }, cashier)).status, 200);
    const r = await quote({ productId: prod.id, quantity: 1, branchId: world.a2 }, cashier);
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "BRANCH_FORBIDDEN");
  });
});

describe("aislamiento e integridad", () => {
  it("la empresa B no ve listas ni precios de A y no puede cotizar sus productos", async () => {
    assert.deepEqual((await api(adminB, "GET", "/pricing/lists")).json, []);
    const lists = (await api(admin, "GET", "/pricing/lists")).json;
    assert.equal((await api(adminB, "GET", `/pricing/lists/${lists[0].id}/prices`)).status, 404);
    const p = (await api(admin, "GET", "/catalog/products?limit=1")).json.items[0];
    assert.equal((await api(adminB, "POST", "/pricing/quote", { productId: p.id, quantity: 1 })).status, 404);
  });

  it("la base rechaza datos imposibles (tramos, ámbito, tasas) y mezclar empresas", async () => {
    const lists = (await api(admin, "GET", "/pricing/lists")).json;
    const pp = (await api(admin, "GET", `/pricing/lists/${lists.find((l: { code: string }) => l.code === "TRAMOS").id}/prices`)).json.items[0];
    const run = (sql: string) => withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(sql));
    await assert.rejects(run(`UPDATE product_price_tier SET min_quantity = 0 WHERE min_quantity = 1`));
    await assert.rejects(run(`UPDATE product_price_tier SET unit_price = -1 WHERE min_quantity = 1`));
    await assert.rejects(run(`UPDATE price_list SET scope = 'BRANCH', branch_id = NULL WHERE code = 'TRAMOS'`));
    await assert.rejects(run(`UPDATE tax_rate SET rate = 150`));
    await assert.rejects(run(`UPDATE tax_rate SET valid_to = '2000-01-01'`));
    // una lista de A no puede apuntar a una sucursal de B
    const idsA = await owner.priceList.findFirst({ where: { code: "TRAMOS" } });
    void idsA;
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.priceList.updateMany({ where: { code: "TRAMOS" }, data: { scope: "BRANCH", branchId: world.b1 } })));
    void pp;
  });

  it("los cambios de precios, listas e impuestos quedan auditados", async () => {
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    for (const a of ["tax.code_created", "tax.rate_added", "tax.profile_created", "pricelist.created", "pricelist.updated", "price.updated", "price.removed"]) assert.ok(acts.has(a), a);
  });
});
