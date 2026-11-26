import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { after, before, describe, it } from "node:test";
import { DocumentConfig } from "@erp/contracts";
import { buildEscpos, encodeText, layoutText, plainText, wrap } from "../src/documents/escpos";
import type { DocData } from "../src/documents/render-document";
import { call, setup, teardown, tokenFor, world } from "./support";

let admin: string, cashier: string;
let W1: string, P: string, CUST: string, REG: string;
type M = "GET" | "POST" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });

/** Servidor TCP que hace de impresora de red y guarda lo que recibe. */
function fakePrinter(): Promise<{ server: Server; port: number; received: () => Buffer[]; clear: () => void }> {
  const chunks: Buffer[] = [];
  const server = createServer((s) => { const parts: Buffer[] = []; s.on("data", (d) => parts.push(d)); s.on("end", () => chunks.push(Buffer.concat(parts))); });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ server, port: (server.address() as { port: number }).port, received: () => chunks, clear: () => { chunks.length = 0; } })));
}
const settle = () => new Promise((r) => setTimeout(r, 80));
const base = (extra: object = {}) => ({ name: "Caja 1 térmica", kind: "THERMAL", paper: "THERMAL_80", connection: "NETWORK", mode: "TEXT", host: "127.0.0.1", port: 9100, charsPerLine: 42, codepage: "CP858", cutMode: "FULL", openDrawer: false, feedLines: 3, isDefault: false, ...extra });

const data = (): DocData => ({
  title: "Recibo de venta", code: "V-000001", date: "01/01/2026", company: { name: "Distribuidora Ñandú S.R.L.", taxId: "123" }, branch: { name: "Central", address: "Av. América 100", phone: "2-555" },
  party: { label: "Cliente", name: "José Pérez" }, meta: [],
  lines: [{ code: "A", name: "Gaseosa de naranja 500 ml retornable", qty: "3", unit: "UND", price: "10,00", discountPct: "0", total: "30,00" }],
  totals: [{ label: "Total", value: "30,00", strong: true }], taxes: [], payments: [{ label: "Efectivo", value: "30,00" }], note: null, disclaimer: "No es una factura", currency: "BOB",
});

before(async () => {
  await setup();
  [admin, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("cajero@test.local")]);
  const UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  const L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  P = (await api(admin, "POST", "/catalog/products", { code: "P1", name: "Gaseosa ñ", baseUnitId: UND })).json.id;
  await call("PUT", `/api/v1/pricing/lists/${L1}/prices/${P}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } });
  await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: P, quantity: 100, unitCost: 5 }] });
  CUST = (await api(admin, "POST", "/sales/customers", { name: "José Pérez", taxId: "1" })).json.id;
  REG = (await api(admin, "POST", "/cash/registers", { branchId: world.a1, code: "CJ1", name: "Caja principal" })).json.id;
});
after(teardown);

describe("codificación y maquetación de tickets", () => {
  it("codifica el español en las páginas de códigos de las térmicas", () => {
    assert.deepEqual([...encodeText("áéíóú ñÑ ¿¡", "CP858")], [0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0x20, 0xa4, 0xa5, 0x20, 0xa8, 0xad]);
    assert.deepEqual([...encodeText("ÁÉÍÓÚ", "CP858")], [0xb5, 0x90, 0xd6, 0xe0, 0xe9]);
    assert.deepEqual([...encodeText("Ñá", "WPC1252")], [0xd1, 0xe1]);
    assert.equal(encodeText("Ñá", "UTF8").toString("utf8"), "Ñá");
    // en CP437 no existe la Á: se imprime sin acento en vez de un carácter basura
    assert.equal(encodeText("Á", "CP437").toString("latin1"), "A");
    assert.equal(encodeText("日", "CP858").toString("latin1"), "?");
  });
  it("parte las líneas sin pasarse del ancho", () => {
    for (const w of [32, 42, 48]) {
      const lines = wrap("Gaseosa de naranja 500 ml retornable en envase de vidrio supercalifragilisticoexpialidoso", w);
      assert.ok(lines.every((l) => l.length <= w), `ancho ${w}`);
    }
  });
  it("cada fila del ticket cabe en el ancho de la impresora", () => {
    for (const w of [32, 42, 48]) {
      const rows = layoutText(data(), DocumentConfig.parse({ paper: "THERMAL_80", footerText: "Gracias por su compra, vuelva pronto a nuestra tienda" }), w);
      assert.ok(rows.every((r) => r.text.length <= w), `ancho ${w}: ${rows.find((r) => r.text.length > w)?.text}`);
    }
  });
  it("los comandos ESC/POS: reinicio, página de códigos, cajón, corte y copias", () => {
    const rows = layoutText(data(), DocumentConfig.parse({ paper: "THERMAL_80" }), 42);
    const b = buildEscpos(rows, { width: 42, codepage: "CP858", cut: "FULL", openDrawer: true, feedLines: 3, copies: 2 });
    assert.deepEqual([...b.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 19]);
    assert.ok(b.includes(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])));
    let cuts = 0;
    for (let i = 0; i < b.length - 2; i++) if (b[i] === 0x1d && b[i + 1] === 0x56 && b[i + 2] === 0x00) cuts++;
    assert.equal(cuts, 2);
    assert.equal(b.filter((x, i) => x === 0x1b && b[i + 1] === 0x70).length, 1); // el cajón se abre una sola vez
    const partial = buildEscpos(rows, { width: 42, codepage: "UTF8", cut: "PARTIAL", openDrawer: false, feedLines: 0, copies: 1 });
    assert.ok(partial.includes(Buffer.from([0x1d, 0x56, 0x01])) && !partial.includes(Buffer.from([0x1b, 0x74])));
    assert.ok(plainText(rows).includes("Distribuidora Ñandú"));
  });
});

describe("configurar impresoras de todas las modalidades", () => {
  it("registra una de red en modo texto con todos sus ajustes y la asigna a una caja", async () => {
    const r = await api(admin, "POST", "/documents/printers", base({ cashRegisterId: REG, branchId: world.a1, isDefault: true, openDrawer: true, charsPerLine: 48, codepage: "CP850", cutMode: "PARTIAL", feedLines: 5 }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.connection, r.json.mode, r.json.host, r.json.port, r.json.charsPerLine, r.json.codepage, r.json.cutMode, r.json.openDrawer, r.json.feedLines, r.json.cashRegisterName, r.json.isDefault],
      ["NETWORK", "TEXT", "127.0.0.1", 9100, 48, "CP850", "PARTIAL", true, 5, "Caja principal", true]);
  });
  it("USB, puerto serie, sistema y navegador no llevan dirección", async () => {
    for (const [i, connection] of (["USB", "SERIAL", "SYSTEM", "BROWSER"] as const).entries()) {
      const r = await api(admin, "POST", "/documents/printers", base({ name: `Equipo ${i}`, connection, host: "8.8.8.8", port: 80 }));
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual([r.json.connection, r.json.host, r.json.port], [connection, null, null]);
    }
  });
  it("por red exige dirección y puerto, y solo direcciones de la red local", async () => {
    assert.equal((await api(admin, "POST", "/documents/printers", base({ name: "Sin host", host: null }))).status, 400);
    assert.equal((await api(admin, "POST", "/documents/printers", base({ name: "Sin puerto", port: null }))).status, 400);
    for (const host of ["8.8.8.8", "169.254.169.254", "example.com", "172.32.0.1", "192.168.1.300"]) {
      const r = await api(admin, "POST", "/documents/printers", base({ name: `H ${host}`, host }));
      assert.deepEqual([r.status, r.json.code], [400, "HOST_NOT_ALLOWED"], host);
    }
    for (const host of ["192.168.1.50", "10.0.0.7", "172.16.4.2", "localhost"]) assert.equal((await api(admin, "POST", "/documents/printers", base({ name: `OK ${host}`, host }))).status, 200, host);
  });
  it("valida ancho, página de códigos, corte y avance", async () => {
    for (const bad of [{ charsPerLine: 10 }, { charsPerLine: 200 }, { codepage: "KOI8" }, { cutMode: "SIERRA" }, { feedLines: 40 }, { connection: "BLUETOOTH" }, { mode: "RAW" }]) {
      assert.equal((await api(admin, "POST", "/documents/printers", base({ name: "Mala", ...bad }))).status, 400, JSON.stringify(bad));
    }
  });
  it("se puede editar, y una sola es predeterminada por caja", async () => {
    const list = (await api(cashier, "GET", "/documents/printers")).json;
    const first = list.find((p: any) => p.name === "Caja 1 térmica");
    const second = (await api(admin, "POST", "/documents/printers", base({ name: "Caja 1 respaldo", cashRegisterId: REG, isDefault: true }))).json;
    const after = (await api(admin, "GET", "/documents/printers")).json;
    assert.deepEqual(after.filter((p: any) => p.cashRegisterId === REG && p.isDefault).map((p: any) => p.id), [second.id]);
    const edited = await call("PUT", `/api/v1/documents/printers/${first.id}`, { token: admin, body: base({ cashRegisterId: REG, charsPerLine: 32, codepage: "WPC1252" }) });
    assert.deepEqual([edited.status, edited.json.charsPerLine, edited.json.codepage], [200, 32, "WPC1252"]);
    assert.equal((await call("PUT", `/api/v1/documents/printers/${second.id}`, { token: admin, body: base({ name: "Caja 1 térmica" }) })).json.code, "PRINTER_EXISTS");
    assert.equal((await call("PUT", `/api/v1/documents/printers/${first.id}`, { token: cashier, body: base() })).status, 403);
    assert.equal((await api(admin, "POST", "/documents/printers", base({ name: "Caja fantasma", cashRegisterId: "00000000-0000-4000-8000-000000000001" }))).json.code, "REGISTER_UNKNOWN");
  });
});

describe("imprimir en modo texto", () => {
  let fake: Awaited<ReturnType<typeof fakePrinter>>;
  let netPrinter: string, usbPrinter: string, htmlPrinter: string;
  let sale: { id: string; code: string };

  before(async () => {
    fake = await fakePrinter();
    const np = await api(admin, "POST", "/documents/printers", base({ name: "Red real", port: fake.port, openDrawer: true, cashRegisterId: null }));
    assert.equal(np.status, 200, JSON.stringify(np.json));
    netPrinter = np.json.id;
    usbPrinter = (await api(admin, "POST", "/documents/printers", base({ name: "USB mostrador", connection: "USB", charsPerLine: 32 }))).json.id;
    htmlPrinter = (await api(admin, "POST", "/documents/printers", base({ name: "Láser oficina", kind: "LASER", connection: "BROWSER", mode: "HTML", paper: "LETTER" }))).json.id;
    const d = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CUST, lines: [{ productId: P, quantity: 3 }] });
    sale = (await api(admin, "POST", `/sales/orders/${d.json.id}/confirm`, { payments: [{ method: "TRANSFER", amount: 30 }] })).json;
  });
  after(() => new Promise((r) => fake.server.close(() => r(null))));

  it("por red el servidor envía el recibo a la impresora, con acentos, cajón y corte", async () => {
    fake.clear();
    const r = await api(cashier, "POST", `/documents/print/SALE_RECEIPT/${sale.id}`, { printerId: netPrinter });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.delivered, r.json.connection], [true, "NETWORK"]);
    await settle();
    const got = Buffer.concat(fake.received());
    assert.equal(got.length, r.json.bytes);
    assert.deepEqual([...got.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 19]);
    assert.ok(got.includes(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])), "abre el cajón");
    assert.ok(got.includes(Buffer.from([0x1d, 0x56, 0x00])), "corta");
    assert.ok(got.includes(Buffer.from(sale.code)) && got.includes(Buffer.from([0x4a, 0x6f, 0x73, 0x82]))); // "José" con la é en CP858
    assert.ok(r.json.text.includes("Transferencia") && r.json.text.includes("30,00"));
    assert.ok(r.json.text.split("\n").every((l: string) => l.length <= 42));
  });
  it("una cotización no abre el cajón", async () => {
    fake.clear();
    const q = await api(admin, "POST", "/sales/quotes", { branchId: world.a1, customerId: CUST, validUntil: new Date(Date.now() + 864e6).toISOString().slice(0, 10), lines: [{ productId: P, quantity: 1 }] });
    assert.equal((await api(admin, "POST", `/documents/print/QUOTE/${q.json.id}`, { printerId: netPrinter })).status, 200);
    await settle();
    assert.ok(!Buffer.concat(fake.received()).includes(Buffer.from([0x1b, 0x70])));
  });
  it("por USB o serie se devuelven los bytes para que los envíe el navegador", async () => {
    const r = await api(cashier, "POST", `/documents/print/SALE_RECEIPT/${sale.id}`, { printerId: usbPrinter });
    assert.deepEqual([r.status, r.json.delivered, r.json.connection], [200, false, "USB"]);
    const bytes = Buffer.from(r.json.dataBase64, "base64");
    assert.equal(bytes.length, r.json.bytes);
    assert.ok(r.json.text.split("\n").every((l: string) => l.length <= 32));
  });
  it("una impresora de formato (HTML) no imprime en modo texto", async () => {
    const r = await api(admin, "POST", `/documents/print/SALE_RECEIPT/${sale.id}`, { printerId: htmlPrinter });
    assert.deepEqual([r.status, r.json.code], [409, "PRINTER_NOT_TEXT"]);
  });
  it("si la impresora no responde se dice claramente", async () => {
    const dead = (await api(admin, "POST", "/documents/printers", base({ name: "Apagada", port: 1 }))).json.id;
    const r = await api(admin, "POST", `/documents/print/SALE_RECEIPT/${sale.id}`, { printerId: dead });
    assert.deepEqual([r.status, r.json.code], [502, "PRINTER_UNREACHABLE"]);
    assert.match(r.json.detail, /conexión rechazada|no hay ruta|no respondió/);
  });
  it("prueba de impresión, solo para quien administra", async () => {
    fake.clear();
    const t = await api(admin, "POST", `/documents/printers/${netPrinter}/test`);
    assert.deepEqual([t.status, t.json.delivered], [200, true]);
    await settle();
    assert.ok(Buffer.concat(fake.received()).includes(Buffer.from("PRUEBA DE IMPRESION")));
    assert.ok(t.json.text.includes("Acentos"));
    assert.equal((await api(cashier, "POST", `/documents/printers/${netPrinter}/test`)).status, 403);
  });
  it("abrir el cajón solo si la impresora lo tiene configurado", async () => {
    fake.clear();
    assert.equal((await api(cashier, "POST", `/documents/printers/${netPrinter}/drawer`)).status, 200);
    await settle();
    assert.ok(Buffer.concat(fake.received()).includes(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])));
    assert.equal((await api(cashier, "POST", `/documents/printers/${usbPrinter}/drawer`)).json.code, "NO_DRAWER");
  });
  it("una impresora desactivada no imprime y un borrador no se imprime", async () => {
    const id = (await api(admin, "POST", "/documents/printers", base({ name: "Baja", port: fake.port }))).json.id;
    await api(admin, "POST", `/documents/printers/${id}/deactivate`);
    assert.equal((await api(admin, "POST", `/documents/print/SALE_RECEIPT/${sale.id}`, { printerId: id })).json.code, "PRINTER_INACTIVE");
    const d = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CUST, lines: [{ productId: P, quantity: 1 }] });
    assert.equal((await api(admin, "POST", `/documents/print/SALE_RECEIPT/${d.json.id}`, { printerId: netPrinter })).json.code, "NOT_CONFIRMED");
  });
});
