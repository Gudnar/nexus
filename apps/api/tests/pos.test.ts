import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { withTenant } from "@erp/db";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, cashier: string;
let W1: string, W2: string, WB: string, TAX: string;
let P1: string, P2: string, P3: string, PSRV: string, PINACT: string, CMAY: string, CNORM: string, LMAY: string, SUP: string;
type M = "GET" | "POST" | "PATCH" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method as any, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const search = (qs: string, token = admin) => api(token, "GET", `/sales/product-search?warehouseId=${W1}&${qs}`);
const preview = (lines: object[], extra: object = {}, token = admin) => api(token, "POST", "/sales/preview", { warehouseId: W1, lines, ...extra });
const num = (v: string) => Number(v);

before(async () => {
  await setup();
  [admin, adminB, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("cajero@test.local")]);
  const UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Tienda 1" })).json.id;
  W2 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a2, code: "W2", name: "Tienda 2" })).json.id;
  WB = (await api(adminB, "POST", "/inventory/warehouses", { branchId: world.b1, code: "WB", name: "Empresa B" })).json.id;
  const iva = await api(admin, "POST", "/taxes/codes", { code: "IVA", name: "IVA 13 %", rate: { rate: 13, validFrom: "2020-01-01" } });
  TAX = (await api(admin, "POST", "/taxes/profiles", { code: "GEN", name: "General", appliesTo: "PRODUCT", rules: [{ taxCodeId: iva.json.id, priority: 0 }] })).json.id;
  const mk = async (code: string, name: string, extra: object = {}) => (await api(admin, "POST", "/catalog/products", { code, name, baseUnitId: UND, taxProfileId: TAX, ...extra })).json.id;
  P1 = await mk("1010", "RIEL TELESCOPICA ECO 25cm", { barcodes: [{ barcode: "7770001010" }] });
  P2 = await mk("1011", "RIEL TELESCOPICA ECO 30cm");
  P3 = await mk("2020", "Tornillo de acero", { description: "Para madera y melamina" });
  PSRV = await mk("SRV-1", "Servicio de instalación", { kind: "SERVICE" });
  PINACT = await mk("9999", "Riel descontinuado");
  await call("PATCH", `/api/v1/catalog/products/${PINACT}`, { token: admin, body: { status: "INACTIVE" } });
  const GEN = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  LMAY = (await api(admin, "POST", "/pricing/lists", { code: "MAY", name: "Mayorista", priceMode: "WITH_TAX" })).json.id;
  const tiers = (a: number, b: number, c: number) => [{ minQuantity: 1, maxQuantity: 6, unitPrice: a }, { minQuantity: 6, maxQuantity: 13, unitPrice: b }, { minQuantity: 13, unitPrice: c }];
  const put = (l: string, p: string, t: object[]) => call("PUT", `/api/v1/pricing/lists/${l}/prices/${p}`, { token: admin, body: { tiers: t } });
  await put(GEN, P1, tiers(10, 9, 8.5)); await put(GEN, P2, [{ minQuantity: 1, unitPrice: 11 }]); await put(GEN, P3, [{ minQuantity: 1, unitPrice: 2 }]); await put(GEN, PSRV, [{ minQuantity: 1, unitPrice: 50 }]);
  await put(LMAY, P1, [{ minQuantity: 1, unitPrice: 7 }]);
  await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: P1, quantity: 135, unitCost: 4 }, { productId: P2, quantity: 20, unitCost: 5 }, { productId: P3, quantity: 500, unitCost: 1 }] });
  await api(admin, "POST", "/inventory/adjustments", { warehouseId: W2, reason: "Carga", lines: [{ productId: P1, quantity: 15, unitCost: 4 }] });
  SUP = (await api(admin, "POST", "/purchasing/suppliers", { code: "PRV-RIEL", name: "Importadora Rieles Andinos" })).json.id;
  await api(admin, "POST", "/purchasing/receipts", { supplierId: SUP, warehouseId: W1, supplierRef: "F-1", lines: [{ productId: P1, quantity: 1, unitCost: 4 }, { productId: P2, quantity: 1, unitCost: 5 }] });
  CNORM = (await api(admin, "POST", "/sales/customers", { name: "María Condori", taxId: "4455667", phone: "71234567" })).json.id;
  CMAY = (await api(admin, "POST", "/sales/customers", { name: "Ferretería El Tornillo", taxId: "1029384756", phone: "69988776", defaultPriceListId: LMAY })).json.id;
});
after(teardown);

describe("búsqueda de productos del punto de venta", () => {
  it("encuentra por descripción con varias palabras en cualquier orden y muestra existencias y escalas", async () => {
    const r = await search("q=riel+25");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.map((p: any) => p.code), ["1010"]);
    const p = r.json[0];
    assert.deepEqual([p.name, p.unit, p.stockHere, p.stockTotal], ["RIEL TELESCOPICA ECO 25cm", "UND", "136", "151"]);
    assert.deepEqual(p.price.tiers.map((t: any) => [t.min, t.max, t.price]), [["1", "6", "10"], ["6", "13", "9"], ["13", null, "8.5"]]);
    assert.deepEqual([p.price.listCode, p.price.priceMode, p.price.scalingMode], ["GEN", "WITHOUT_TAX", "TIER_THRESHOLD"]);
  });
  it("busca también en la descripción larga y en la categoría, ignorando mayúsculas y acentos", async () => {
    assert.deepEqual((await search("q=MELAMINA")).json.map((p: any) => p.code), ["2020"]);
    assert.deepEqual((await search("q=telescopica")).json.map((p: any) => p.code), ["1010", "1011"]);
  });
  it("por código (exacto primero), por código de barras y por proveedor", async () => {
    assert.deepEqual((await search("q=1010&fields=code")).json.map((p: any) => p.code), ["1010"]);
    assert.deepEqual((await search("q=101&fields=code")).json.map((p: any) => p.code), ["1010", "1011"]);
    assert.deepEqual((await search("q=7770001010&fields=barcode")).json.map((p: any) => p.code), ["1010"]);
    const sup = await search("q=rieles+andinos&fields=supplier");
    assert.deepEqual(sup.json.map((p: any) => p.code), ["1010", "1011"]);
    assert.deepEqual(sup.json[0].suppliers, ["Importadora Rieles Andinos"]);
    assert.equal((await search("q=rieles+andinos&fields=description")).json.length, 0); // sin marcar «proveedor» no busca ahí
    assert.deepEqual((await search("q=1010&fields=code,supplier")).json.map((p: any) => p.code), ["1010"]);
  });
  it("el código exacto sale antes que los que solo contienen el texto", async () => {
    const r = await search("q=1011&fields=code,description");
    assert.equal(r.json[0].code, "1011");
  });
  it("los servicios no llevan existencias y lo inactivo no aparece", async () => {
    const s = (await search("q=instalacion")).json[0];
    assert.deepEqual([s.code, s.kind, s.stockHere, s.stockTotal], ["SRV-1", "SERVICE", null, null]);
    assert.equal((await search("q=descontinuado")).json.length, 0);
  });
  it("con un cliente mayorista las escalas son las de su lista", async () => {
    const r = await search(`q=1010&fields=code&customerId=${CMAY}`);
    assert.deepEqual([r.json[0].price.listCode, r.json[0].price.priceMode, r.json[0].price.tiers[0].price], ["MAY", "WITH_TAX", "7"]);
    // un producto que su lista no tiene cae a la lista general
    assert.equal((await search(`q=2020&fields=code&customerId=${CMAY}`)).json[0].price.listCode, "GEN");
  });
  it("un producto sin precio igual aparece, sin escalas; el límite se respeta; el texto es obligatorio", async () => {
    const lonely = (await api(admin, "POST", "/catalog/products", { code: "SIN-PRECIO", name: "Producto sin precio", baseUnitId: (await api(admin, "GET", "/catalog/units")).json[0].id })).json.id;
    const r = await search("q=sin+precio");
    assert.deepEqual([r.json[0].id, r.json[0].price], [lonely, null]);
    assert.equal((await search("q=riel&limit=1")).json.length, 1);
    assert.equal((await search("q=")).status, 400);
  });
  it("respeta las sucursales: no se consulta el almacén de otra empresa ni uno sin acceso", async () => {
    assert.equal((await api(admin, "GET", `/sales/product-search?q=riel&warehouseId=${WB}`)).status, 404);
    assert.equal((await api(cashier, "GET", `/sales/product-search?q=riel&warehouseId=${W2}`)).status, 403); // el cajero solo opera en A1
    assert.equal((await search("q=riel", cashier)).status, 200);
    assert.equal((await api(adminB, "GET", `/sales/product-search?q=riel&warehouseId=${W1}`)).status, 404);
  });
});

describe("cálculo de la venta (precios por cantidad, CF y SF)", () => {
  it("elige el precio según la cantidad de cada producto", async () => {
    const at = async (q: number) => (await preview([{ productId: P1, quantity: q }], { withTax: false })).json.lines[0];
    assert.deepEqual([(await at(1)).unitPrice, (await at(5)).unitPrice, (await at(6)).unitPrice, (await at(12)).unitPrice, (await at(13)).unitPrice, (await at(30)).unitPrice], ["10", "10", "9", "9", "8.5", "8.5"]);
    const l6 = await at(6);
    assert.deepEqual([l6.tier, l6.totalAmount, l6.priceListCode], ["6", "54", "GEN"]);
  });
  it("con impuestos (CF) suma el IVA sobre una lista sin impuestos; sin impuestos (SF) cobra el precio tal cual", async () => {
    const cf = (await preview([{ productId: P1, quantity: 10 }], { withTax: true })).json;
    assert.deepEqual([cf.totals.net, cf.totals.tax, cf.totals.total], ["90", "11.7", "101.7"]);
    const sf = (await preview([{ productId: P1, quantity: 10 }], { withTax: false })).json;
    assert.deepEqual([sf.totals.net, sf.totals.tax, sf.totals.total], ["90", "0", "90"]);
  });
  it("con una lista que ya incluye impuestos, CF extrae el IVA y SF no lo extrae", async () => {
    const cf = (await preview([{ productId: P1, quantity: 10 }], { withTax: true, customerId: CMAY })).json; // 7 con IVA incluido
    assert.deepEqual([cf.totals.total, cf.totals.tax, cf.totals.net], ["70", "8.05", "61.95"]);
    const sf = (await preview([{ productId: P1, quantity: 10 }], { withTax: false, customerId: CMAY })).json;
    assert.deepEqual([sf.totals.total, sf.totals.tax], ["70", "0"]);
  });
  it("suma varias líneas, aplica descuentos y no guarda nada", async () => {
    const before = await withTenant(owner, world.tenantA, (tx) => tx.sale.count());
    const r = (await preview([{ productId: P1, quantity: 6 }, { productId: P2, quantity: 2, discountPct: 10 }], { withTax: false })).json;
    assert.deepEqual(r.lines.map((l: any) => [l.totalAmount, l.discountPct]), [["54", "0"], ["19.8", "10"]]);
    assert.deepEqual([r.totals.total, r.totals.discount], ["73.8", "2.2"]);
    assert.equal(await withTenant(owner, world.tenantA, (tx) => tx.sale.count()), before);
  });
  it("valida: producto repetido, sin permiso de descuento y almacén de otra empresa", async () => {
    assert.equal((await preview([{ productId: P1, quantity: 1 }, { productId: P1, quantity: 2 }])).json.code, "DUPLICATE_PRODUCT");
    assert.equal((await preview([{ productId: P1, quantity: 1, discountPct: 5 }], {}, cashier)).status, 403);
    assert.equal((await api(adminB, "POST", "/sales/preview", { warehouseId: W1, lines: [{ productId: P1, quantity: 1 }] })).status, 404);
  });
});

describe("guardar, editar y cobrar desde el punto de venta", () => {
  let sale: any;
  it("guarda un borrador sin impuestos con los datos del comprobante", async () => {
    const r = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CNORM, withTax: false, billingName: "María C. S.R.L.", billingTaxId: "4455667-1", note: "Entregar mañana", lines: [{ productId: P1, quantity: 10 }] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    sale = r.json;
    assert.deepEqual([sale.withTax, sale.billingName, sale.billingTaxId, sale.note, sale.total, sale.taxTotal, sale.status, sale.code], [false, "María C. S.R.L.", "4455667-1", "Entregar mañana", "90", "0", "DRAFT", null]);
    assert.deepEqual([sale.warehouseId, sale.branchId], [W1, world.a1]);
  });
  it("al editar el borrador pasa a con impuestos y se recalcula; después se vuelve a editar", async () => {
    const a = await api(admin, "PATCH", `/sales/orders/${sale.id}`, { withTax: true });
    assert.deepEqual([a.json.withTax, a.json.total, a.json.taxTotal], [true, "101.7", "11.7"]);
    const b = await api(admin, "PATCH", `/sales/orders/${sale.id}`, { withTax: false, lines: [{ productId: P1, quantity: 13 }, { productId: P2, quantity: 1 }] });
    assert.deepEqual([b.json.withTax, b.json.total, b.json.lines.length], [false, "121.5", 2]); // 13 × 8,5 + 11
  });
  it("al confirmar conserva sin impuestos y acepta varias formas de pago", async () => {
    const r = await api(admin, "POST", `/sales/orders/${sale.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 50, reference: "TRF-1" }, { method: "QR", amount: 71.5 }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.status, r.json.withTax, r.json.taxTotal, r.json.total, r.json.paymentStatus, r.json.payments.map((p: any) => p.method).sort()], ["CONFIRMED", false, "0", "121.5", "PAID", ["QR", "TRANSFER"]]);
    assert.ok(r.json.code);
  });
  it("una venta con impuestos confirmada conserva el IVA", async () => {
    const d = await api(admin, "POST", "/sales/orders", { warehouseId: W1, lines: [{ productId: P1, quantity: 10 }] });
    assert.equal(d.json.withTax, true);
    const c = await api(admin, "POST", `/sales/orders/${d.json.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 101.7 }] });
    assert.deepEqual([c.json.taxTotal, c.json.total, c.json.paymentStatus], ["11.7", "101.7", "PAID"]);
  });
  it("a crédito con fecha límite elegida; no se acepta una fecha pasada", async () => {
    const mkDraft = async () => (await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CNORM, withTax: false, lines: [{ productId: P2, quantity: 2 }] })).json.id;
    const bad = await api(admin, "POST", `/sales/orders/${await mkDraft()}/confirm`, { payments: [], dueDate: "2020-01-01" });
    assert.deepEqual([bad.status, bad.json.code], [400, "INVALID_DUE_DATE"]);
    const limit = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const ok = await api(admin, "POST", `/sales/orders/${await mkDraft()}/confirm`, { payments: [{ method: "TRANSFER", amount: 10 }], dueDate: limit });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual([ok.json.dueDate, ok.json.paymentStatus, ok.json.balance], [limit, "PARTIAL", "12"]);
    const noCust = await api(admin, "POST", "/sales/orders", { warehouseId: W1, lines: [{ productId: P2, quantity: 1 }] });
    assert.equal((await api(admin, "POST", `/sales/orders/${noCust.json.id}/confirm`, { payments: [] })).json.code, "CUSTOMER_REQUIRED_FOR_CREDIT");
  });
  it("la búsqueda de clientes encuentra por código, nombre, NIT y teléfono, y el cajero puede registrar clientes", async () => {
    const find = async (q: string) => (await api(cashier, "GET", `/sales/customers?q=${encodeURIComponent(q)}`)).json.map((c: any) => c.name);
    assert.deepEqual(await find("condori"), ["María Condori"]);
    assert.deepEqual(await find("4455"), ["María Condori"]);
    assert.deepEqual(await find("6998"), ["Ferretería El Tornillo"]);
    assert.deepEqual(await find("C-000002"), ["Ferretería El Tornillo"]);
    const r = await api(cashier, "POST", "/sales/customers", { name: "Cliente del mostrador", phone: "70000000", taxId: "9988776" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal((await api(cashier, "POST", "/sales/customers", { name: "Repetido", taxId: "9988776" })).json.code, "DUPLICATE_CUSTOMER");
  });
});

describe("detalle de la venta", () => {
  it("trae quién vendió, la sucursal, la ruta de la categoría de cada producto, el NIT y teléfono del cliente y quién cobró", async () => {
    const parent = (await api(admin, "POST", "/catalog/categories", { code: "FER", name: "FERRETERIA" })).json.id;
    const child = (await api(admin, "POST", "/catalog/categories", { code: "LIJ", name: "LIJAS DE AGUA", parentId: parent })).json.id;
    const UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
    const prod = (await api(admin, "POST", "/catalog/products", { code: "LA3M120", name: "LIJA DE AGUA 3M #120", baseUnitId: UND, categoryId: child })).json.id;
    await call("PUT", `/api/v1/pricing/lists/${LMAY}/prices/${prod}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 5 }] } });
    await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: prod, quantity: 10, unitCost: 2 }] });
    const d = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CMAY, withTax: false, lines: [{ productId: prod, quantity: 2 }, { productId: P3, quantity: 1 }] });
    assert.equal(d.status, 201, JSON.stringify(d.json));
    const c = await api(admin, "POST", `/sales/orders/${d.json.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 12, reference: "OP-1" }] });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const s = c.json;
    assert.deepEqual([s.seller, s.branchName], ["Admin A", "Central A"]);
    assert.deepEqual([s.customer.taxId, s.customer.phone, s.customer.code], ["1029384756", "69988776", "C-000002"]);
    assert.equal(s.lines.find((l: any) => l.productCode === "LA3M120").category, "FERRETERIA / LIJAS DE AGUA");
    assert.deepEqual(s.payments.map((p: any) => [p.method, p.reference, p.by]), [["TRANSFER", "OP-1", "Admin A"]]);
    const row = (await api(admin, "GET", `/sales/search?code=${s.code}`)).json.items[0];
    assert.deepEqual([row.customer.taxId, row.seller], ["1029384756", "Admin A"]);
  });
});
