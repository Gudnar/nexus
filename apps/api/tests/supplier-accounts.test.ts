import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { after, before, describe, it } from "node:test";
import { createDb, withTenant } from "@erp/db";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, cashier: string, adminB: string;
let SUP: string;
type M = "GET" | "POST" | "PATCH" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const acc = (extra: object = {}) => ({ bankName: "Banco Unión", accountNumber: "10000123456", accountType: "CHECKING", currency: "BOB", holderName: "Distribuidora Ñandú S.R.L.", holderTaxId: "1020304056", ...extra });

function fakePrinter(): Promise<{ server: Server; port: number; received: () => Buffer[] }> {
  const chunks: Buffer[] = [];
  const server = createServer((s) => { const parts: Buffer[] = []; s.on("data", (d) => parts.push(d)); s.on("end", () => chunks.push(Buffer.concat(parts))); });
  return new Promise((res) => server.listen(0, "127.0.0.1", () => res({ server, port: (server.address() as { port: number }).port, received: () => chunks })));
}

before(async () => {
  await setup();
  [admin, cashier, adminB] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("cajero@test.local"), tokenFor("admin.b@test.local")]);
  SUP = (await api(admin, "POST", "/purchasing/suppliers", { code: "PRV1", name: "Distribuidora Ñandú", contactName: "Ana Rojas", contactRole: "Ejecutiva de ventas", phone: "70011122" })).json.id;
});
after(teardown);

describe("proveedores: cargo del contacto e historial", () => {
  it("guarda el cargo del contacto", async () => {
    const list = (await api(admin, "GET", "/purchasing/suppliers")).json;
    assert.equal(list.find((s: { id: string }) => s.id === SUP).contactRole, "Ejecutiva de ventas");
  });
  it("cambiar el contacto queda en el historial con el valor anterior y el nuevo", async () => {
    const r = await api(admin, "PATCH", `/purchasing/suppliers/${SUP}`, { contactName: "Luis Paz", contactRole: "Gerente comercial" });
    assert.equal(r.status, 200);
    const h = (await api(admin, "GET", `/purchasing/suppliers/${SUP}/history`)).json;
    assert.equal(h.length, 1);
    assert.equal(h[0].kind, "CONTACT_CHANGED");
    assert.deepEqual(h[0].before, { contactName: "Ana Rojas", contactRole: "Ejecutiva de ventas" });
    assert.deepEqual(h[0].after, { contactName: "Luis Paz", contactRole: "Gerente comercial" });
    assert.match(h[0].summary, /Cargo: Ejecutiva de ventas → Gerente comercial/);
    assert.ok(h[0].actor);
  });
  it("guardar sin cambios reales no ensucia el historial", async () => {
    await api(admin, "PATCH", `/purchasing/suppliers/${SUP}`, { contactName: "Luis Paz", name: "Distribuidora Ñandú" });
    assert.equal((await api(admin, "GET", `/purchasing/suppliers/${SUP}/history`)).json.length, 1);
  });
});

describe("cuentas bancarias del proveedor", () => {
  let A1: string, A2: string;
  it("registra una cuenta; la primera queda como principal", async () => {
    const r = await api(admin, "POST", `/purchasing/suppliers/${SUP}/bank-accounts`, acc());
    assert.equal(r.status, 201, JSON.stringify(r.json));
    A1 = r.json.id;
    assert.equal(r.json.isDefault, true);
    assert.equal(r.json.status, "ACTIVE");
  });
  it("rechaza datos inválidos y cuentas duplicadas", async () => {
    assert.equal((await api(admin, "POST", `/purchasing/suppliers/${SUP}/bank-accounts`, acc({ accountNumber: "1" }))).status, 400);
    assert.equal((await api(admin, "POST", `/purchasing/suppliers/${SUP}/bank-accounts`, acc({ currency: "EUR" }))).status, 400);
    const dup = await api(admin, "POST", `/purchasing/suppliers/${SUP}/bank-accounts`, acc());
    assert.equal(dup.status, 409);
    assert.equal(dup.json.code, "ACCOUNT_DUPLICATE");
  });
  it("una segunda cuenta marcada como principal le quita la marca a la primera", async () => {
    const r = await api(admin, "POST", `/purchasing/suppliers/${SUP}/bank-accounts`, acc({ bankName: "Banco Mercantil", accountNumber: "4010-555", currency: "USD", accountType: "SAVINGS", isDefault: true }));
    assert.equal(r.status, 201);
    A2 = r.json.id;
    const list = (await api(admin, "GET", `/purchasing/suppliers/${SUP}/bank-accounts`)).json;
    assert.deepEqual(list.filter((a: { isDefault: boolean }) => a.isDefault).map((a: { id: string }) => a.id), [A2]);
  });
  it("cambiar una cuenta guarda en el historial qué había antes y qué hay ahora", async () => {
    const r = await api(admin, "PATCH", `/purchasing/suppliers/${SUP}/bank-accounts/${A1}`, { accountNumber: "10000999888", holderName: "Ñandú S.R.L." });
    assert.equal(r.status, 200);
    assert.equal(r.json.accountNumber, "10000999888");
    const h = (await api(admin, "GET", `/purchasing/suppliers/${SUP}/history`)).json;
    const e = h.find((x: { kind: string; before: { accountNumber: string } | null }) => x.kind === "BANK_ACCOUNT_CHANGED");
    assert.equal(e.before.accountNumber, "10000123456");
    assert.equal(e.after.accountNumber, "10000999888");
    assert.match(e.summary, /Nº de cuenta: 10000123456 → 10000999888/);
  });
  it("desactivar y reactivar quedan registrados; una inactiva no puede ser la principal", async () => {
    const off = await api(admin, "PATCH", `/purchasing/suppliers/${SUP}/bank-accounts/${A2}`, { status: "INACTIVE" });
    assert.equal(off.json.status, "INACTIVE");
    assert.equal(off.json.isDefault, false);
    await api(admin, "PATCH", `/purchasing/suppliers/${SUP}/bank-accounts/${A2}`, { status: "ACTIVE" });
    const kinds = (await api(admin, "GET", `/purchasing/suppliers/${SUP}/history`)).json.map((x: { kind: string }) => x.kind);
    assert.ok(kinds.includes("BANK_ACCOUNT_DEACTIVATED") && kinds.includes("BANK_ACCOUNT_REACTIVATED") && kinds.includes("BANK_ACCOUNT_ADDED"));
  });
  it("el historial es inmutable en la base de datos (ni se corrige ni se borra)", async () => {
    const app = createDb(process.env.DATABASE_URL);
    await assert.rejects(() => withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe("DELETE FROM supplier_history")), /permission denied|denegado/i);
    await assert.rejects(() => withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe("UPDATE supplier_history SET summary = 'x'")), /permission denied|denegado/i);
    const n = await withTenant(owner, world.tenantA, (tx) => tx.supplierHistory.count({ where: { supplierId: SUP } }));
    assert.ok(n >= 4);
  });
  it("el cajero no ve ni cambia cuentas; otra empresa no ve al proveedor", async () => {
    assert.equal((await api(cashier, "GET", `/purchasing/suppliers/${SUP}/bank-accounts`)).status, 403);
    assert.equal((await api(cashier, "POST", `/purchasing/suppliers/${SUP}/bank-accounts`, acc({ accountNumber: "777777" }))).status, 403);
    assert.equal((await api(adminB, "GET", `/purchasing/suppliers/${SUP}/bank-accounts`)).status, 404);
    assert.equal((await api(adminB, "PATCH", `/purchasing/suppliers/${SUP}/bank-accounts/${A1}`, { bankName: "Hack" })).status, 404);
  });

  describe("boleta de depósito", () => {
    it("se genera con los datos de la cuenta, el monto y el concepto", async () => {
      const r = await api(admin, "GET", `/documents/render/SUPPLIER_DEPOSIT/${A1}?amount=1500.5&concept=${encodeURIComponent("Pago factura 123")}`);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      const html: string = r.json.html;
      for (const t of ["Boleta de depósito", "Banco Unión", "10000999888", "Ñandú S.R.L.", "Pago factura 123", "1.500,50 BOB", "Depositante", "Ejecutiva", "Luis Paz"]) {
        if (t === "Ejecutiva") continue; // el cargo vigente es «Gerente comercial»
        assert.ok(html.includes(t), `falta: ${t}`);
      }
      assert.ok(html.includes("Gerente comercial"));
    });
    it("sin monto deja el espacio para llenar a mano", async () => {
      const r = await api(admin, "GET", `/documents/render/SUPPLIER_DEPOSIT/${A1}`);
      assert.ok(r.json.html.includes("________ BOB"));
    });
    it("rechaza montos inválidos", async () => {
      assert.equal((await api(admin, "GET", `/documents/render/SUPPLIER_DEPOSIT/${A1}?amount=-5`)).status, 400);
    });
    it("sale por una impresora de tickets en modo texto", async () => {
      const fp = await fakePrinter();
      try {
        const p = await api(admin, "POST", "/documents/printers", { name: "Ticket compras", kind: "THERMAL", paper: "THERMAL_80", connection: "NETWORK", mode: "TEXT", host: "127.0.0.1", port: fp.port, charsPerLine: 42, codepage: "CP858", cutMode: "FULL", openDrawer: true, feedLines: 3, isDefault: false });
        assert.equal(p.status, 200, JSON.stringify(p.json));
        const r = await api(admin, "POST", `/documents/print/SUPPLIER_DEPOSIT/${A1}`, { printerId: p.json.id, amount: 250, concept: "Anticipo" });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        await new Promise((x) => setTimeout(x, 100));
        const got = fp.received();
        assert.equal(got.length, 1);
        const text = got[0]!.toString("latin1");
        assert.ok(text.includes("10000999888") && text.includes("Anticipo") && text.includes("250,00 BOB"));
        assert.ok(got[0]!.includes(Buffer.from([0x1d, 0x56, 0x00])), "corta el papel");
        assert.ok(!got[0]!.includes(Buffer.from([0x1b, 0x70, 0x00])), "no abre el cajón");
      } finally { fp.server.close(); }
    });
    it("una cuenta inactiva no genera boleta, y el cajero no puede imprimirla", async () => {
      await api(admin, "PATCH", `/purchasing/suppliers/${SUP}/bank-accounts/${A2}`, { status: "INACTIVE" });
      const r = await api(admin, "GET", `/documents/render/SUPPLIER_DEPOSIT/${A2}`);
      assert.equal(r.status, 409);
      assert.equal(r.json.code, "ACCOUNT_INACTIVE");
      assert.equal((await api(cashier, "GET", `/documents/render/SUPPLIER_DEPOSIT/${A1}`)).status, 403);
    });
    it("queda en la auditoría de documentos impresos", async () => {
      const rows = await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ where: { action: "document.printed", entityType: "supplier_deposit" }, select: { action: true } }));
      assert.ok(rows.length >= 2);
    });
  });
});
