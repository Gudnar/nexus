import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DocumentConfig } from "@erp/contracts";
import { createDb, withTenant } from "@erp/db";
import { renderDocument, esc } from "../src/documents/render-document";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, cashier: string;
let W1: string, P: string, CUST: string, SUP: string;

type M = "GET" | "POST" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const cfg = (extra: object = {}) => ({ paper: "THERMAL_80", marginMm: 4, fontSizePt: 9, copies: 1, headerLines: [], footerText: "", legalText: "", ...extra });
const ten = (fn: (tx: any) => Promise<any>): Promise<any> => withTenant(owner, world.tenantA, fn);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("sv", { timeZone: "America/La_Paz" });

const confirmedSale = async (qty = 3, payment = true) => {
  const d = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CUST, lines: [{ productId: P, quantity: qty }] });
  const c = await api(admin, "POST", `/sales/orders/${d.json.id}/confirm`, { payments: payment ? [{ method: "CASH", amount: qty * 10 }] : [] });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  return { id: d.json.id as string, code: c.json.code as string };
};
const render = (token: string, type: string, id: string, paper?: string) => api(token, "GET", `/documents/render/${type}/${id}${paper ? `?paper=${paper}` : ""}`);

before(async () => {
  await setup();
  [admin, adminB, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("cajero@test.local")]);
  const UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  const L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  P = (await api(admin, "POST", "/catalog/products", { code: "P1", name: "Gaseosa <b>500</b> & más", baseUnitId: UND })).json.id;
  await call("PUT", `/api/v1/pricing/lists/${L1}/prices/${P}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } });
  await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: P, quantity: 100, unitCost: 5 }] });
  CUST = (await api(admin, "POST", "/sales/customers", { name: "Cliente Uno", taxId: "1" })).json.id;
  SUP = (await api(admin, "POST", "/purchasing/suppliers", { code: "S1", name: "Proveedor Uno" })).json.id;
});
after(teardown);

describe("renderizador", () => {
  const data = () => ({
    title: "Recibo de venta", code: "V-1", date: "01/01/2026", company: { name: "Mi <Empresa>", taxId: "123" }, branch: null, party: { label: "Cliente", name: "Ana" }, meta: [],
    lines: [{ code: "A", name: "Item", qty: "1", unit: "UND", price: "10,00", discountPct: "0", total: "10,00" }], totals: [{ label: "Total", value: "10,00", strong: true }],
    taxes: [], payments: [], note: null, disclaimer: "Sin validez fiscal", currency: "BOB",
  });
  it("escapa el HTML de los datos", () => {
    assert.equal(esc(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
    const html = renderDocument(data(), DocumentConfig.parse(cfg()));
    assert.ok(html.includes("Mi &lt;Empresa&gt;") && !html.includes("<Empresa>"));
  });
  it("papel térmico: ancho fijo y alto libre; carta: tabla", () => {
    const t = renderDocument(data(), DocumentConfig.parse(cfg({ paper: "THERMAL_58" })));
    assert.match(t, /@page\{size:58mm auto/);
    assert.ok(!t.includes("<table"));
    const l = renderDocument(data(), DocumentConfig.parse(cfg({ paper: "LETTER" })));
    assert.match(l, /@page\{size:216mm 279mm/);
    assert.ok(l.includes("<table"));
  });
  it("copias y campos visibles", () => {
    const html = renderDocument({ ...data(), party: { label: "Cliente", name: "Ana" } }, DocumentConfig.parse(cfg({ copies: 3, show: { customer: false, unitPrice: true, discount: true, taxes: true, payments: true, notes: true } })));
    assert.equal(html.split('<section class="doc">').length - 1, 3);
    assert.ok(!html.includes("Ana"));
  });
  it("no incluye scripts ni recursos externos", () => {
    const html = renderDocument(data(), DocumentConfig.parse(cfg()));
    assert.ok(!/<script|src=|href=|url\(/i.test(html));
  });
});

describe("plantillas", () => {
  it("sin personalizar hay una por tipo con valores razonables", async () => {
    const r = await api(cashier, "GET", "/documents/templates");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.map((t: any) => [t.docType, t.customized, t.version, t.config.paper]), [["SALE_RECEIPT", false, 0, "THERMAL_80"], ["QUOTE", false, 0, "LETTER"], ["PURCHASE_ORDER", false, 0, "LETTER"], ["SUPPLIER_DEPOSIT", false, 0, "THERMAL_80"]]);
  });
  it("solo quien administra documentos las cambia", async () => {
    assert.equal((await api(cashier, "PUT", "/documents/templates/SALE_RECEIPT", cfg())).status, 403);
    assert.equal((await api(cashier, "POST", "/documents/printers", { name: "X1", kind: "BROWSER", paper: "LETTER" })).status, 403);
  });
  it("valida la configuración", async () => {
    for (const bad of [cfg({ copies: 0 }), cfg({ copies: 9 }), cfg({ fontSizePt: 3 }), cfg({ marginMm: 80 }), cfg({ paper: "A4" }), cfg({ headerLines: ["1", "2", "3", "4", "5", "6"] })]) {
      assert.equal((await api(admin, "PUT", "/documents/templates/SALE_RECEIPT", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await api(admin, "PUT", "/documents/templates/NOPE", cfg())).status, 400);
  });
  it("cada guardado crea una versión y queda auditado", async () => {
    const a = await api(admin, "PUT", "/documents/templates/SALE_RECEIPT", cfg({ footerText: "Gracias", headerLines: ["Av. Siempre Viva 742"] }));
    assert.deepEqual([a.status, a.json.version, a.json.customized], [200, 1, true]);
    const b = await api(admin, "PUT", "/documents/templates/SALE_RECEIPT", cfg({ footerText: "Vuelva pronto", copies: 2 }));
    assert.equal(b.json.version, 2);
    assert.equal(await ten((tx) => tx.documentTemplateVersion.count()), 2);
    assert.equal((await ten((tx) => tx.auditLog.count({ where: { action: "document.template_saved" } }))), 2);
  });
  it("la vista previa usa datos de ejemplo sin tocar nada", async () => {
    const r = await api(admin, "POST", "/documents/templates/QUOTE/preview", cfg({ paper: "LETTER", footerText: "Pie de prueba" }));
    assert.equal(r.status, 200);
    assert.ok(r.json.html.includes("Pie de prueba") && r.json.html.includes("EJEMPLO-000001") && r.json.html.includes("Producto de ejemplo"));
    assert.equal((await api(cashier, "POST", "/documents/templates/QUOTE/preview", cfg())).status, 403);
  });
  it("el historial de versiones es inmutable", async () => {
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of [`UPDATE document_template_version SET version = 9`, `DELETE FROM document_template_version`, `DELETE FROM document_template`]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
    } finally { await app.$disconnect(); }
  });
  it("otra empresa tiene sus propias plantillas", async () => {
    const r = await api(adminB, "GET", "/documents/templates");
    assert.ok(r.json.every((t: any) => !t.customized));
  });
});

describe("imprimir documentos", () => {
  let sale: { id: string; code: string };
  it("recibo de venta: empresa, código, líneas, pago, copias y leyenda no fiscal", async () => {
    sale = await confirmedSale(3);
    const r = await render(cashier, "SALE_RECEIPT", sale.id);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const h: string = r.json.html;
    assert.deepEqual([r.json.paper, r.json.copies], ["THERMAL_80", 2]);
    assert.ok(h.includes("Empresa A") && h.includes(sale.code) && h.includes("Cliente Uno") && h.includes("30,00") && h.includes("Efectivo"));
    assert.ok(h.includes("Vuelva pronto"));
    assert.ok(h.includes("No es una factura"));
    assert.equal(h.split('<section class="doc">').length - 1, 2);
    assert.ok(h.includes("Gaseosa &lt;b&gt;500&lt;/b&gt; &amp; más") && !h.includes("<b>500</b>"));
  });
  it("se puede elegir otro papel al imprimir", async () => {
    const r = await render(admin, "SALE_RECEIPT", sale.id, "LETTER");
    assert.deepEqual([r.json.paper, r.json.html.includes("<table")], ["LETTER", true]);
    assert.equal((await render(admin, "SALE_RECEIPT", sale.id, "A4")).status, 400);
  });
  it("una venta anulada se imprime marcada; un borrador no se imprime", async () => {
    const s = await confirmedSale(1, false);
    assert.equal((await api(admin, "POST", `/sales/orders/${s.id}/void`, { reason: "Error de digitación" })).status, 200);
    assert.ok((await render(admin, "SALE_RECEIPT", s.id)).json.html.includes("Recibo ANULADO"));
    const d = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CUST, lines: [{ productId: P, quantity: 1 }] });
    assert.deepEqual([(await render(admin, "SALE_RECEIPT", d.json.id)).status, (await render(admin, "SALE_RECEIPT", d.json.id)).json.code], [409, "NOT_CONFIRMED"]);
  });
  it("cotización con su vigencia", async () => {
    const q = await api(admin, "POST", "/sales/quotes", { branchId: world.a1, customerId: CUST, validUntil: day(10), lines: [{ productId: P, quantity: 2 }] });
    const r = await render(cashier, "QUOTE", q.json.id);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.html.includes(q.json.code) && r.json.html.includes("Válida hasta") && r.json.html.includes("20,00") && r.json.html.includes("Cotización sujeta"));
    assert.equal(r.json.paper, "LETTER");
  });
  it("orden de compra: solo emitida y solo con permiso de compras", async () => {
    const o = await api(admin, "POST", "/purchasing/orders", { supplierId: SUP, warehouseId: W1, lines: [{ productId: P, quantity: 10, unitCost: 5 }] });
    assert.equal((await render(admin, "PURCHASE_ORDER", o.json.id)).json.code, "NOT_ISSUED");
    await api(admin, "POST", `/purchasing/orders/${o.json.id}/issue`);
    const r = await render(admin, "PURCHASE_ORDER", o.json.id);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.html.includes("Proveedor Uno") && r.json.html.includes("50,00") && !r.json.html.includes("No es una factura"));
    assert.equal((await render(cashier, "PURCHASE_ORDER", o.json.id)).status, 403);
  });
  it("tipo inválido, documento inexistente o de otra empresa", async () => {
    assert.equal((await render(admin, "NOPE", sale.id)).status, 400);
    assert.equal((await render(admin, "SALE_RECEIPT", "00000000-0000-4000-8000-000000000001")).status, 404);
    assert.equal((await render(adminB, "SALE_RECEIPT", sale.id)).status, 404);
  });
  it("imprimir queda en la auditoría", async () => {
    assert.ok((await ten((tx) => tx.auditLog.count({ where: { action: "document.printed", entityId: sale.id } }))) >= 2);
  });
});

describe("impresoras", () => {
  it("registra, evita duplicados y mantiene una sola predeterminada por sucursal", async () => {
    const a = await api(admin, "POST", "/documents/printers", { name: "Caja 1", kind: "THERMAL", paper: "THERMAL_80", branchId: world.a1, isDefault: true });
    assert.deepEqual([a.status, a.json.isDefault], [200, true]);
    assert.equal((await api(admin, "POST", "/documents/printers", { name: "Caja 1", kind: "THERMAL", paper: "THERMAL_80" })).json.code, "PRINTER_EXISTS");
    const b = await api(admin, "POST", "/documents/printers", { name: "Caja 2", kind: "THERMAL", paper: "THERMAL_58", branchId: world.a1, isDefault: true });
    const list = (await api(cashier, "GET", "/documents/printers")).json;
    assert.deepEqual(list.filter((p: any) => p.isDefault).map((p: any) => p.id), [b.json.id]);
    assert.equal((await api(admin, "POST", "/documents/printers", { name: "Z", kind: "THERMAL", paper: "THERMAL_80" })).status, 400);
    assert.equal((await api(admin, "POST", "/documents/printers", { name: "Fantasma", kind: "LASER", paper: "LETTER", branchId: "00000000-0000-4000-8000-000000000001" })).json.code, "BRANCH_UNKNOWN");
  });
  it("desactivar la quita de uso y de predeterminada; otra empresa no la ve", async () => {
    const id = (await api(admin, "GET", "/documents/printers")).json.find((p: any) => p.name === "Caja 2").id;
    const d = await api(admin, "POST", `/documents/printers/${id}/deactivate`);
    assert.deepEqual([d.json.active, d.json.isDefault], [false, false]);
    assert.equal((await api(adminB, "GET", "/documents/printers")).json.length, 0);
  });
});
