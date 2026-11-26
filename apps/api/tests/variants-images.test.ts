import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { withTenant } from "@erp/db";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, cashier: string, UND: string, CAT: string;
type M = "GET" | "POST" | "PUT" | "DELETE";
const api = (token: string, method: M, url: string, body?: unknown) => call(method as any, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });

// Cloudinary de mentira: guarda lo que recibe.
let fake: Server, fakeBase: string;
const seen: { ping: string[]; destroy: Record<string, string>[] } = { ping: [], destroy: [] };
const SECRET = "s3cr3t-de-prueba-123456";

before(async () => {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (req.url === "/v1_1/demo/ping") {
        seen.ping.push(req.headers.authorization ?? "");
        const ok = req.headers.authorization === "Basic " + Buffer.from(`123456789012345:${SECRET}`).toString("base64");
        res.writeHead(ok ? 200 : 401).end(JSON.stringify({ status: ok ? "OK" : "error" }));
      } else if (req.url === "/v1_1/demo/image/destroy") {
        seen.destroy.push(Object.fromEntries(new URLSearchParams(body)));
        res.writeHead(200).end(JSON.stringify({ result: "ok" }));
      } else res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  fakeBase = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  process.env.CLOUDINARY_API_BASE = fakeBase;
  process.env.CLOUDINARY_RES_BASE = "https://res.test.local";

  await setup();
  [admin, adminB, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("cajero@test.local")]);
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  CAT = (await api(admin, "POST", "/catalog/categories", { code: "ROP", name: "Ropa" })).json.id;
});
after(async () => { await new Promise((r) => fake.close(r)); delete process.env.CLOUDINARY_API_BASE; delete process.env.CLOUDINARY_RES_BASE; await teardown(); });

const cloud = (extra: object = {}) => ({ cloudName: "demo", apiKey: "123456789012345", apiSecret: SECRET, folder: "nexus/productos", enabled: true, ...extra });
const url = (n: string) => `https://res.test.local/demo/image/upload/v1/nexus/productos/${n}.jpg`;
const img = (n: string) => ({ url: url(n), publicId: `nexus/productos/${n}`, bytes: 120000, width: 800, height: 800 });

describe("integración con Cloudinary", () => {
  it("solo quien administra integraciones la ve o la cambia", async () => {
    for (const [m, u] of [["GET", "/integrations"], ["PUT", "/integrations/cloudinary"], ["POST", "/integrations/cloudinary/test"]] as const) assert.equal((await api(cashier, m, u, m === "PUT" ? cloud() : undefined)).status, 403, `${m} ${u}`);
    const r = await api(admin, "GET", "/integrations");
    assert.deepEqual([r.status, r.json[0].provider, r.json[0].configured, r.json[0].enabled, r.json[0].secretSet], [200, "CLOUDINARY", false, false, false]);
  });
  it("valida los datos y exige el secreto la primera vez", async () => {
    for (const bad of [cloud({ cloudName: "a b" }), cloud({ apiKey: "abc" }), cloud({ folder: "../x" }), cloud({ apiSecret: "corto" })]) assert.equal((await api(admin, "PUT", "/integrations/cloudinary", bad)).status, 400, JSON.stringify(bad));
    const r = await api(admin, "PUT", "/integrations/cloudinary", cloud({ apiSecret: undefined }));
    assert.deepEqual([r.status, r.json.code], [400, "SECRET_REQUIRED"]);
  });
  it("guarda sin devolver nunca el secreto, que queda cifrado", async () => {
    const r = await api(admin, "PUT", "/integrations/cloudinary", cloud());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.configured, r.json.enabled, r.json.secretSet, r.json.config], [true, true, true, { cloudName: "demo", apiKey: "123456789012345", folder: "nexus/productos" }]);
    assert.ok(!JSON.stringify(r.json).includes(SECRET) && !JSON.stringify((await api(admin, "GET", "/integrations")).json).includes(SECRET));
    const row = await withTenant(owner, world.tenantA, (tx) => tx.tenantIntegration.findFirst());
    assert.ok(row && !String(row.secretEnc).includes(SECRET) && String(row.secretEnc).startsWith("v1."));
    const audit = JSON.stringify(await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ where: { action: "integration.saved" } })));
    assert.ok(audit.includes("demo") && !audit.includes(SECRET));
  });
  it("al editar sin escribir el secreto se conserva el guardado", async () => {
    const r = await api(admin, "PUT", "/integrations/cloudinary", cloud({ apiSecret: undefined, folder: "nexus/productos" }));
    assert.deepEqual([r.status, r.json.secretSet], [200, true]);
  });
  it("probar la conexión: correcta, y con claves malas lo dice", async () => {
    const ok = await api(admin, "POST", "/integrations/cloudinary/test");
    assert.deepEqual([ok.status, ok.json.ok], [200, true]);
    await api(admin, "PUT", "/integrations/cloudinary", cloud({ apiKey: "999999999999999" }));
    const bad = await api(admin, "POST", "/integrations/cloudinary/test");
    assert.equal(bad.json.ok, false);
    assert.match(bad.json.message, /rechazó las credenciales/);
    await api(admin, "PUT", "/integrations/cloudinary", cloud());
  });
  it("otra empresa tiene sus propias integraciones", async () => {
    assert.equal((await api(adminB, "GET", "/integrations")).json[0].configured, false);
  });
});

describe("fotos de producto", () => {
  let P: string, other: string;
  const ids: string[] = [];
  before(async () => {
    P = (await api(admin, "POST", "/catalog/products", { code: "FOT-1", name: "Producto con fotos", baseUnitId: UND })).json.id;
    other = (await api(admin, "POST", "/catalog/products", { code: "FOT-2", name: "Otro", baseUnitId: UND })).json.id;
  });

  it("firma la subida con el secreto, que el navegador nunca conoce", async () => {
    const r = await api(admin, "POST", `/catalog/products/${P}/images/signature`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const expected = createHash("sha1").update(`folder=nexus/productos&timestamp=${r.json.timestamp}${SECRET}`).digest("hex");
    assert.equal(r.json.signature, expected);
    assert.deepEqual([r.json.cloudName, r.json.apiKey, r.json.folder, r.json.uploadUrl], ["demo", "123456789012345", "nexus/productos", `${fakeBase}/v1_1/demo/image/upload`]);
    assert.ok(!JSON.stringify(r.json).includes(SECRET));
    assert.equal((await api(cashier, "POST", `/catalog/products/${P}/images/signature`)).status, 403);
  });
  it("solo acepta fotos de TU nube y de tu carpeta", async () => {
    for (const bad of [{ ...img("a"), url: "https://evil.example.com/demo/image/upload/a.jpg" }, { ...img("a"), url: "https://res.test.local/otra-nube/image/upload/a.jpg" }, { ...img("a"), publicId: "otra/carpeta/a" }]) {
      assert.deepEqual([(await api(admin, "POST", `/catalog/products/${P}/images`, bad)).status, (await api(admin, "POST", `/catalog/products/${P}/images`, bad)).json.code], [400, "IMAGE_NOT_ALLOWED"]);
    }
    assert.equal((await api(admin, "POST", `/catalog/products/${P}/images`, { ...img("a"), bytes: 9_000_000 })).json.code, "IMAGE_TOO_BIG");
  });
  it("la primera foto es la principal; las siguientes no, y no se repiten", async () => {
    const a = await api(admin, "POST", `/catalog/products/${P}/images`, img("a"));
    const b = await api(admin, "POST", `/catalog/products/${P}/images`, img("b"));
    assert.deepEqual([a.status, a.json.isPrimary, b.json.isPrimary, a.json.thumbUrl.includes("c_fill,w_96,h_96")], [200, true, false, true]);
    ids.push(a.json.id, b.json.id);
    assert.equal((await api(admin, "POST", `/catalog/products/${P}/images`, img("a"))).json.code, "IMAGE_EXISTS");
    assert.equal((await api(cashier, "POST", `/catalog/products/${P}/images`, img("c"))).status, 403);
  });
  it("la foto principal aparece en el listado de productos", async () => {
    const list = (await api(cashier, "GET", "/catalog/products?q=FOT-")).json.items;
    const p = list.find((x: any) => x.code === "FOT-1"), o = list.find((x: any) => x.code === "FOT-2");
    assert.deepEqual([p.imageUrl, o.imageUrl], [url("a"), null]);
    assert.ok(p.thumbUrl.includes("c_fill"));
    assert.equal((await api(cashier, "GET", `/catalog/products/${P}/images`)).json.length, 2);
  });
  it("cambiar la principal deja solo una", async () => {
    const r = await api(admin, "POST", `/catalog/products/${P}/images/${ids[1]}/primary`);
    assert.deepEqual(r.json.map((i: any) => i.isPrimary), [false, true]);
    assert.equal((await api(admin, "GET", "/catalog/products?q=FOT-1")).json.items[0].imageUrl, url("b"));
    assert.equal((await api(admin, "POST", `/catalog/products/${other}/images/${ids[0]}/primary`)).status, 404);
  });
  it("máximo 6 fotos por producto", async () => {
    for (const n of ["c", "d", "e", "f"]) assert.equal((await api(admin, "POST", `/catalog/products/${P}/images`, img(n))).status, 200);
    assert.equal((await api(admin, "POST", `/catalog/products/${P}/images`, img("g"))).json.code, "IMAGE_LIMIT");
    assert.equal((await api(admin, "POST", `/catalog/products/${P}/images/signature`)).json.code, "IMAGE_LIMIT");
  });
  it("al quitar la principal otra la reemplaza, y la foto se borra también de Cloudinary", async () => {
    seen.destroy.length = 0;
    const r = await api(admin, "DELETE", `/catalog/products/${P}/images/${ids[1]}`);
    assert.equal(r.status, 204);
    const left = (await api(admin, "GET", `/catalog/products/${P}/images`)).json;
    assert.equal(left.length, 5);
    assert.equal(left.filter((i: any) => i.isPrimary).length, 1);
    assert.equal(seen.destroy.length, 1);
    const d = seen.destroy[0]!;
    assert.equal(d.public_id, "nexus/productos/b");
    assert.equal(d.signature, createHash("sha1").update(`public_id=nexus/productos/b&timestamp=${d.timestamp}${SECRET}`).digest("hex"));
    assert.equal((await api(admin, "DELETE", `/catalog/products/${P}/images/${ids[1]}`)).status, 404);
  });
  it("sin la integración activa no se sube nada", async () => {
    await api(admin, "PUT", "/integrations/cloudinary", cloud({ apiSecret: undefined, enabled: false }));
    assert.equal((await api(admin, "POST", `/catalog/products/${other}/images/signature`)).json.code, "INTEGRATION_NOT_READY");
    assert.equal((await api(admin, "POST", `/catalog/products/${other}/images`, img("z"))).json.code, "INTEGRATION_NOT_READY");
    await api(admin, "PUT", "/integrations/cloudinary", cloud({ apiSecret: undefined }));
  });
});

describe("variantes de producto", () => {
  let G: any;
  const opts = [{ name: "Talla", values: ["S", "M", "L"] }, { name: "Color", values: ["Rojo", "Azul"] }];
  const base = (extra: object = {}) => ({ name: "Polera", baseCode: "POL", options: opts, baseUnitId: UND, categoryId: CAT, ...extra });

  it("crea una variante por cada combinación, con su propio código y nombre", async () => {
    const r = await api(admin, "POST", "/catalog/product-groups", base());
    assert.equal(r.status, 201, JSON.stringify(r.json));
    G = r.json;
    assert.equal(G.variants.length, 6);
    assert.deepEqual(G.variants.map((v: any) => v.code), ["POL-L-AZU", "POL-L-ROJ", "POL-M-AZU", "POL-M-ROJ", "POL-S-AZU", "POL-S-ROJ"]);
    const v = G.variants.find((x: any) => x.code === "POL-M-ROJ");
    assert.deepEqual([v.name, v.variantLabel, v.values], ["Polera - M / Rojo", "M / Rojo", { Talla: "M", Color: "Rojo" }]);
  });
  it("cada variante es un producto normal, agrupado, con la categoría heredada", async () => {
    const list = (await api(cashier, "GET", "/catalog/products?q=POL-")).json.items;
    assert.equal(list.length, 6);
    const p = list.find((x: any) => x.code === "POL-S-ROJ");
    assert.deepEqual([p.group, p.variantLabel, p.category.name, p.baseUnit.code], [{ id: G.id, name: "Polera" }, "S / Rojo", "Ropa", "UND"]);
    const detail = (await api(admin, "GET", `/catalog/products/${p.id}`)).json;
    assert.equal(detail.group.id, G.id);
  });
  it("cada variante tiene su propio precio, código de barras y existencias", async () => {
    const a = G.variants.find((x: any) => x.code === "POL-S-ROJ").id, b = G.variants.find((x: any) => x.code === "POL-S-AZU").id;
    const L = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
    await call("PUT", `/api/v1/pricing/lists/${L}/prices/${a}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 80 }] } });
    await call("PUT", `/api/v1/pricing/lists/${L}/prices/${b}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 90 }] } });
    const WH = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Tienda" })).json.id;
    await api(admin, "POST", "/inventory/adjustments", { warehouseId: WH, reason: "Carga", lines: [{ productId: a, quantity: 10, unitCost: 40 }, { productId: b, quantity: 3, unitCost: 45 }] });
    const q = async (id: string) => Number((await api(admin, "POST", "/pricing/quote", { productId: id, quantity: 1, branchId: world.a1 })).json.unitPrice);
    assert.deepEqual([await q(a), await q(b)], [80, 90]);
    const stock = (await api(admin, "GET", "/inventory/stock")).json.items;
    assert.deepEqual([stock.find((s: any) => s.productId === a).physicalQty, stock.find((s: any) => s.productId === b).physicalQty], ["10", "3"]);
    assert.equal((await call("PATCH", `/api/v1/catalog/products/${b}`, { token: admin, body: { barcodes: [{ barcode: "7771234567890" }] } })).status, 200);
    // desactivar una variante no toca a las demás
    assert.equal((await call("PATCH", `/api/v1/catalog/products/${b}`, { token: admin, body: { status: "INACTIVE" } })).status, 200);
    assert.equal((await api(admin, "GET", `/catalog/product-groups/${G.id}`)).json.variants.filter((v: any) => v.status === "ACTIVE").length, 5);
  });
  it("no repite el prefijo ni acepta combinaciones inválidas", async () => {
    assert.equal((await api(admin, "POST", "/catalog/product-groups", base())).json.code, "CODE_TAKEN");
    assert.equal((await api(admin, "POST", "/catalog/product-groups", base({ baseCode: "X1", options: [{ name: "Talla", values: ["S", "s"] }] }))).status, 400);
    assert.equal((await api(admin, "POST", "/catalog/product-groups", base({ baseCode: "X2", options: [{ name: "Talla", values: ["S"] }, { name: "talla", values: ["M"] }] }))).status, 400);
    assert.equal((await api(admin, "POST", "/catalog/product-groups", base({ baseCode: "X3", options: [] }))).status, 400);
    const many = [{ name: "A", values: Array.from({ length: 11 }, (_, i) => `a${i}`) }, { name: "B", values: Array.from({ length: 10 }, (_, i) => `b${i}`) }];
    assert.equal((await api(admin, "POST", "/catalog/product-groups", base({ baseCode: "X4", options: many }))).status, 400); // 110 > 100
    assert.equal((await api(cashier, "POST", "/catalog/product-groups", base({ baseCode: "X5" }))).status, 403);
  });
  it("valores parecidos no chocan: «Azul claro» y «Azul oscuro» reciben códigos distintos", async () => {
    const r = await api(admin, "POST", "/catalog/product-groups", { name: "Gorra", baseCode: "GOR", baseUnitId: UND, options: [{ name: "Color", values: ["Azul claro", "Azul oscuro"] }] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const codes = r.json.variants.map((v: any) => v.code);
    assert.equal(new Set(codes).size, 2, codes.join());
  });
  it("todo o nada: si algo falla no queda ninguna variante a medias", async () => {
    await api(admin, "POST", "/catalog/products", { code: "NEO-S", name: "Ocupa el código", baseUnitId: UND });
    const r = await api(admin, "POST", "/catalog/product-groups", { name: "Neo", baseCode: "NEO", baseUnitId: UND, options: [{ name: "Talla", values: ["S", "M"] }] });
    assert.equal(r.json.code, "CODE_TAKEN");
    assert.equal((await api(admin, "GET", "/catalog/products?q=NEO-M")).json.items.length, 0);
    assert.equal(await withTenant(owner, world.tenantA, (tx) => tx.productGroup.count({ where: { name: "Neo" } })), 0);
  });
  it("agrega una variante nueva, incluso con un valor nuevo, y no repite combinaciones", async () => {
    const r = await api(admin, "POST", `/catalog/product-groups/${G.id}/variants`, { values: { Talla: "XL", Color: "Rojo" } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.variants.length, 7);
    assert.ok(r.json.variants.some((v: any) => v.code === "POL-XL-ROJ"));
    assert.deepEqual(r.json.options.find((o: any) => o.name === "Talla").values, ["S", "M", "L", "XL"]);
    assert.equal((await api(admin, "POST", `/catalog/product-groups/${G.id}/variants`, { values: { Talla: "xl", Color: "rojo" } })).json.code, "VARIANT_EXISTS");
    assert.equal((await api(admin, "POST", `/catalog/product-groups/${G.id}/variants`, { values: { Talla: "S" } })).json.code, "VALUE_REQUIRED");
    assert.equal((await api(admin, "POST", `/catalog/product-groups/${G.id}/variants`, { values: { Talla: "S", Color: "Rojo", Marca: "X" } })).json.code, "OPTION_UNKNOWN");
  });
  it("la variante muestra su foto en la familia y otra empresa no la ve", async () => {
    const v = G.variants[0].id;
    await api(admin, "POST", `/catalog/products/${v}/images`, img("polera"));
    const g = (await api(admin, "GET", `/catalog/product-groups/${G.id}`)).json;
    assert.equal(g.variants.find((x: any) => x.id === v).imageUrl, url("polera"));
    assert.equal((await api(adminB, "GET", `/catalog/product-groups/${G.id}`)).status, 404);
    assert.equal((await api(adminB, "POST", `/catalog/product-groups/${G.id}/variants`, { values: { Talla: "S", Color: "Verde" } })).status, 404);
  });
});
