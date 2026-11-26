import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDb, withTenant } from "@erp/db";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string;
let W1: string, W3: string, UND: string, KG: string;
let S1: string, P1: string, PL: string, PK: string, PS: string;

type M = "GET" | "POST" | "PATCH";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });
const isoDay = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const newOrder = async (lines: { productId: string; quantity: number; unitCost: number }[], extra: object = {}) => {
  const r = await api(admin, "POST", "/purchasing/orders", { supplierId: S1, warehouseId: W1, lines, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const issued = async (lines: { productId: string; quantity: number; unitCost: number }[]) => {
  const o = await newOrder(lines);
  assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/issue`)).status, 200);
  return (await api(admin, "GET", `/purchasing/orders/${o.id}`)).json;
};
const receive = (token: string, body: object) => api(token, "POST", "/purchasing/receipts", body);
const stock = async (productId: string, warehouseId = W1) => {
  const [row] = (await api(admin, "GET", `/inventory/stock?productId=${productId}&warehouseId=${warehouseId}`)).json.items;
  return row ? [row.physicalQty, row.value] : ["0", "0"];
};
const product = async (body: object) => { const r = await api(admin, "POST", "/catalog/products", { baseUnitId: UND, ...body }); assert.equal(r.status, 201); return r.json.id as string; };

before(async () => {
  await setup();
  [admin, adminB, manager, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local")]);
  const units = (await api(admin, "GET", "/catalog/units")).json as { id: string; code: string }[];
  UND = units.find((u) => u.code === "UND")!.id; KG = units.find((u) => u.code === "KG")!.id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  W3 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a3, code: "W3", name: "Sur" })).json.id;
  S1 = (await api(admin, "POST", "/purchasing/suppliers", { code: "PROV1", name: "Distribuidora Andina", paymentTermsDays: 30 })).json.id;
  P1 = await product({ code: "P1", name: "Producto 1" });
  PL = await product({ code: "PL", name: "Con lote", trackLots: true, trackExpiry: true });
  PK = await product({ code: "PK", name: "Al peso", baseUnitId: KG });
  PS = await product({ code: "PS", name: "Servicio", kind: "SERVICE" });
});
after(teardown);

describe("proveedores", () => {
  it("crea, normaliza y edita; el código es único por empresa", async () => {
    const r = await api(admin, "POST", "/purchasing/suppliers", { code: "PROV2", name: "Importadora Sur", email: "  VENTAS@Sur.COM ", taxId: " 1020304 ", paymentTermsDays: 15 });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual([r.json.email, r.json.taxId, r.json.status, r.json.orders], ["ventas@sur.com", "1020304", "ACTIVE", 0]);
    assert.equal((await api(admin, "POST", "/purchasing/suppliers", { code: "PROV2", name: "Repetido" })).status, 409);
    assert.equal((await api(adminB, "POST", "/purchasing/suppliers", { code: "PROV2", name: "Mismo código en B" })).status, 201);
    const u = await api(admin, "PATCH", `/purchasing/suppliers/${r.json.id}`, { phone: "70000000", email: "", paymentTermsDays: 0 });
    assert.deepEqual([u.json.phone, u.json.email, u.json.paymentTermsDays], ["70000000", null, 0]);
  });
  it("valida los datos", async () => {
    assert.equal((await api(admin, "POST", "/purchasing/suppliers", { code: "mal código", name: "X" })).status, 400);
    assert.equal((await api(admin, "POST", "/purchasing/suppliers", { code: "OK1", name: "Proveedor", email: "no-es-correo" })).status, 400);
    assert.equal((await api(admin, "POST", "/purchasing/suppliers", { code: "OK1", name: "Proveedor", paymentTermsDays: 999 })).status, 400);
  });
  it("lectura y escritura según permisos; la empresa B no ve los de A", async () => {
    assert.equal((await api(cashier, "GET", "/purchasing/suppliers")).status, 403);
    assert.equal((await api(manager, "GET", "/purchasing/suppliers")).status, 200);
    assert.equal((await api(cashier, "POST", "/purchasing/suppliers", { code: "X", name: "XX" })).status, 403);
    assert.ok(!(await api(adminB, "GET", "/purchasing/suppliers")).json.some((s: { name: string }) => s.name === "Distribuidora Andina"));
    assert.equal((await api(adminB, "PATCH", `/purchasing/suppliers/${S1}`, { name: "Intruso" })).status, 404);
  });
});

describe("órdenes de compra", () => {
  it("crea un borrador con código correlativo y total", async () => {
    const o = await newOrder([{ productId: P1, quantity: 10, unitCost: 5.5 }, { productId: PK, quantity: 2.5, unitCost: 4 }], { note: "Pedido semanal", expectedOn: isoDay(7) });
    assert.match(o.code, /^OC-\d{6}$/);
    assert.deepEqual([o.status, o.total, o.supplier.code, o.warehouse.code, o.lines.length], ["DRAFT", "65", "PROV1", "W1", 2]);
    assert.deepEqual(o.lines.map((l: { pendingQty: string }) => l.pendingQty).sort(), ["10", "2.5"]);
  });
  it("valida líneas: servicios, duplicados, decimales, inexistentes y cantidades", async () => {
    const bad = (lines: object[]) => api(admin, "POST", "/purchasing/orders", { supplierId: S1, warehouseId: W1, lines });
    assert.equal((await bad([{ productId: PS, quantity: 1, unitCost: 1 }])).json.code, "NOT_STOCKABLE");
    assert.equal((await bad([{ productId: P1, quantity: 1, unitCost: 1 }, { productId: P1, quantity: 2, unitCost: 1 }])).json.code, "DUPLICATE_PRODUCT");
    assert.equal((await bad([{ productId: P1, quantity: 1.5, unitCost: 1 }])).json.code, "INVALID_QUANTITY");
    assert.equal((await bad([{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1, unitCost: 1 }])).status, 404);
    assert.equal((await bad([{ productId: P1, quantity: 0, unitCost: 1 }])).status, 400);
    assert.equal((await bad([{ productId: P1, quantity: 1, unitCost: -1 }])).status, 400);
    assert.equal((await bad([])).status, 400);
  });
  it("solo se edita en borrador; al emitir queda bloqueada", async () => {
    const o = await newOrder([{ productId: P1, quantity: 1, unitCost: 1 }]);
    const e = await api(admin, "PATCH", `/purchasing/orders/${o.id}`, { note: "Corregida", lines: [{ productId: P1, quantity: 3, unitCost: 2 }] });
    assert.deepEqual([e.status, e.json.total, e.json.note], [200, "6", "Corregida"]);
    assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/issue`)).json.status, "ISSUED");
    assert.equal((await api(admin, "PATCH", `/purchasing/orders/${o.id}`, { note: "tarde" })).json.code, "ORDER_NOT_EDITABLE");
    assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/issue`)).json.code, "INVALID_STATE");
  });
  it("un proveedor inactivo no recibe nuevas órdenes emitidas", async () => {
    const s = (await api(admin, "POST", "/purchasing/suppliers", { code: "INAC", name: "Inactivo" })).json.id;
    const o = (await api(admin, "POST", "/purchasing/orders", { supplierId: s, warehouseId: W1, lines: [{ productId: P1, quantity: 1, unitCost: 1 }] })).json;
    await api(admin, "PATCH", `/purchasing/suppliers/${s}`, { status: "INACTIVE" });
    assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/issue`)).json.code, "SUPPLIER_INACTIVE");
  });
  it("se cancela un borrador o una emitida sin recepciones; no se recibe contra una cancelada", async () => {
    const o = await issued([{ productId: P1, quantity: 5, unitCost: 1 }]);
    assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/cancel`)).json.status, "CANCELLED");
    assert.equal((await receive(admin, { orderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: 1 }] })).json.code, "INVALID_STATE");
    assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/cancel`)).json.code, "INVALID_STATE");
  });
  it("el gerente opera en sus sucursales (A1, A2) pero no en A3; el cajero no tiene acceso", async () => {
    const mk = (token: string, warehouseId: string) => api(token, "POST", "/purchasing/orders", { supplierId: S1, warehouseId, lines: [{ productId: P1, quantity: 1, unitCost: 1 }] });
    assert.equal((await mk(manager, W1)).status, 201);
    assert.equal((await mk(manager, W3)).status, 403);
    assert.equal((await mk(cashier, W1)).status, 403);
    assert.equal((await mk(adminB, W1)).status, 404, "el almacén de A no existe para B");
  });
  it("las órdenes se filtran por estado y la empresa B no las ve", async () => {
    const drafts = (await api(admin, "GET", "/purchasing/orders?status=DRAFT")).json;
    assert.ok(drafts.length > 0 && drafts.every((o: { status: string }) => o.status === "DRAFT"));
    assert.deepEqual((await api(adminB, "GET", "/purchasing/orders")).json, []);
    assert.equal((await api(adminB, "GET", `/purchasing/orders/${drafts[0].id}`)).status, 404);
    assert.equal((await api(adminB, "POST", `/purchasing/orders/${drafts[0].id}/issue`)).status, 404);
  });
});

describe("recepciones contra una orden", () => {
  let order: any;
  before(async () => { order = await issued([{ productId: P1, quantity: 10, unitCost: 5 }]); });

  it("la recepción parcial crea el lote al costo de la orden y deja stock, valor y estado", async () => {
    const r = await receive(admin, { orderId: order.id, supplierRef: "GR-0001", lines: [{ orderLineId: order.lines[0].id, quantity: 4, unitCost: 999 }] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.code, /^RC-\d{6}$/);
    assert.deepEqual([r.json.total, r.json.lines[0].unitCost, r.json.order.code, r.json.supplier.code], ["20", "5", order.code, "PROV1"], "el costo sale de la orden, no del cliente");
    assert.deepEqual(await stock(P1), ["4", "20"]);
    const o = (await api(admin, "GET", `/purchasing/orders/${order.id}`)).json;
    assert.deepEqual([o.status, o.lines[0].receivedQty, o.lines[0].pendingQty], ["PARTIALLY_RECEIVED", "4", "6"]);
  });

  it("no se recibe más de lo pendiente y la recepción fallida no deja nada", async () => {
    const r = await receive(admin, { orderId: order.id, lines: [{ orderLineId: order.lines[0].id, quantity: 7 }] });
    assert.equal(r.status, 409); assert.equal(r.json.code, "OVER_RECEIPT");
    assert.deepEqual(await stock(P1), ["4", "20"]);
  });

  it("validaciones de línea: de otra orden, repetida, producto distinto", async () => {
    const other = await issued([{ productId: PK, quantity: 1, unitCost: 1 }]);
    assert.equal((await receive(admin, { orderId: order.id, lines: [{ orderLineId: other.lines[0].id, quantity: 1 }] })).json.code, "ORDER_LINE_NOT_FOUND");
    assert.equal((await receive(admin, { orderId: order.id, lines: [{ orderLineId: order.lines[0].id, quantity: 1 }, { orderLineId: order.lines[0].id, quantity: 1 }] })).json.code, "DUPLICATE_LINE");
    assert.equal((await receive(admin, { orderId: order.id, lines: [{ orderLineId: order.lines[0].id, productId: PK, quantity: 1 }] })).json.code, "ORDER_LINE_MISMATCH");
    assert.equal((await receive(admin, { orderId: order.id, lines: [{ quantity: 1 }] })).status, 400);
  });

  it("completar lo pendiente deja la orden RECIBIDA", async () => {
    const r = await receive(admin, { orderId: order.id, lines: [{ orderLineId: order.lines[0].id, quantity: 6 }] });
    assert.equal(r.status, 201);
    assert.deepEqual(await stock(P1), ["10", "50"]);
    assert.equal((await api(admin, "GET", `/purchasing/orders/${order.id}`)).json.status, "RECEIVED");
    assert.equal((await receive(admin, { orderId: order.id, lines: [{ orderLineId: order.lines[0].id, quantity: 1 }] })).json.code, "INVALID_STATE");
  });

  it("no se puede recibir contra un borrador", async () => {
    const d = await newOrder([{ productId: P1, quantity: 1, unitCost: 1 }]);
    assert.equal((await receive(admin, { orderId: d.id, lines: [{ orderLineId: d.lines[0].id, quantity: 1 }] })).json.code, "INVALID_STATE");
  });

  it("cada recepción queda en el kardex como entrada con su lote", async () => {
    const k = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&warehouseId=${W1}`)).json.items;
    assert.deepEqual(k.map((m: { type: string; quantity: string }) => [m.type, m.quantity]), [["RECEIPT", "6"], ["RECEIPT", "4"]]);
    assert.ok(k.every((m: { lot: { code: string } }) => /^L-\d{6}$/.test(m.lot.code)));
  });

  it("cerrar una orden parcial da por terminado lo pendiente; cancelar una con recepciones se rechaza", async () => {
    const o = await issued([{ productId: P1, quantity: 10, unitCost: 2 }]);
    await receive(admin, { orderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: 3 }] });
    assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/cancel`)).json.code, "INVALID_STATE");
    assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/close`)).json.status, "RECEIVED");
    assert.equal((await api(admin, "POST", `/purchasing/orders/${o.id}/close`)).json.code, "INVALID_STATE");
  });
});

describe("lotes, vencimientos y recepción directa", () => {
  it("un producto con vencimiento exige la fecha en la recepción; el lote y la fecha quedan registrados", async () => {
    const o = await issued([{ productId: PL, quantity: 6, unitCost: 3 }]);
    const line = o.lines[0].id;
    assert.equal((await receive(admin, { orderId: o.id, lines: [{ orderLineId: line, quantity: 2 }] })).json.code, "EXPIRY_REQUIRED");
    const ok = await receive(admin, { orderId: o.id, lines: [{ orderLineId: line, quantity: 2, lot: { code: "PROV-77", expiresOn: isoDay(60), manufacturedOn: isoDay(-10) } }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.lines[0].lotCode, "PROV-77");
    const lots = (await api(admin, "GET", `/inventory/stock/lots?productId=${PL}`)).json;
    assert.deepEqual(lots.map((l: { lotCode: string; expiresOn: string; unitCost: string }) => [l.lotCode, l.expiresOn, l.unitCost]), [["PROV-77", isoDay(60), "3"]]);
    // mismo código de lote del mismo producto: se rechaza
    assert.equal((await receive(admin, { orderId: o.id, lines: [{ orderLineId: line, quantity: 1, lot: { code: "PROV-77", expiresOn: isoDay(60) } }] })).json.code, "LOT_CODE_TAKEN");
  });

  it("una recepción sin orden exige proveedor, almacén, producto y costo", async () => {
    assert.equal((await receive(admin, { lines: [{ productId: P1, quantity: 1, unitCost: 1 }] })).status, 400);
    assert.equal((await receive(admin, { supplierId: S1, warehouseId: W1, lines: [{ productId: P1, quantity: 1 }] })).status, 400);
    const before = await stock(P1);
    const r = await receive(admin, { supplierId: S1, warehouseId: W1, supplierRef: "FAC-9", lines: [{ productId: P1, quantity: 2, unitCost: 7 }, { productId: PK, quantity: 1.25, unitCost: 4 }] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual([r.json.order, r.json.total, r.json.lines.length], [null, "19", 2]);
    assert.deepEqual(await stock(P1), [String(Number(before[0]) + 2), String(Number(before[1]) + 14)]);
  });

  it("una línea inválida deshace TODA la recepción", async () => {
    const before = await stock(P1);
    const r = await receive(admin, { supplierId: S1, warehouseId: W1, lines: [{ productId: P1, quantity: 5, unitCost: 1 }, { productId: PS, quantity: 1, unitCost: 1 }] });
    assert.equal(r.status, 400);
    assert.deepEqual(await stock(P1), before);
    const rec = (await api(admin, "GET", "/inventory/reconciliation")).json;
    assert.deepEqual([rec.balances, rec.valuations], [[], []]);
  });

  it("permisos: el cajero no recibe; el gerente sí (en A1), no en A3", async () => {
    const body = (warehouseId: string) => ({ supplierId: S1, warehouseId, lines: [{ productId: P1, quantity: 1, unitCost: 1 }] });
    assert.equal((await receive(cashier, body(W1))).status, 403);
    assert.equal((await receive(manager, body(W1))).status, 201);
    assert.equal((await receive(manager, body(W3))).status, 403);
    assert.equal((await receive(adminB, body(W1))).status, 404);
  });
});

describe("anulación de recepciones", () => {
  it("anular devuelve el stock, restituye lo pendiente de la orden y conserva el costo", async () => {
    const o = await issued([{ productId: P1, quantity: 8, unitCost: 9 }]);
    const r = (await receive(admin, { orderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: 8 }] })).json;
    assert.equal((await api(admin, "GET", `/purchasing/orders/${o.id}`)).json.status, "RECEIVED");
    const before = await stock(P1);
    const v = await api(admin, "POST", `/purchasing/receipts/${r.id}/void`, { reason: "Mercadería equivocada" });
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.deepEqual([v.json.status, v.json.voidReason], ["VOIDED", "Mercadería equivocada"]);
    assert.deepEqual(await stock(P1), [String(Number(before[0]) - 8), String(Number(before[1]) - 72)]);
    const ord = (await api(admin, "GET", `/purchasing/orders/${o.id}`)).json;
    assert.deepEqual([ord.status, ord.lines[0].receivedQty, ord.lines[0].pendingQty], ["ISSUED", "0", "8"]);
    const k = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&warehouseId=${W1}&limit=2`)).json.items;
    assert.deepEqual([k[0].type, k[0].unitCost, k[0].quantity], ["ADJUSTMENT_OUT", "9", "-8"], "sale al costo original");
    // se puede volver a recibir y la orden es cancelable de nuevo (ya no tiene recepciones vigentes)
    assert.equal((await receive(admin, { orderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: 8 }] })).status, 201);
  });

  it("no se anula dos veces (ni en paralelo)", async () => {
    const o = await issued([{ productId: P1, quantity: 3, unitCost: 1 }]);
    const r = (await receive(admin, { orderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: 3 }] })).json;
    const [a, b] = await Promise.all([1, 2].map((n) => api(admin, "POST", `/purchasing/receipts/${r.id}/void`, { reason: `intento ${n}` })));
    assert.deepEqual([a!.status, b!.status].sort(), [200, 409]);
    assert.equal((await api(admin, "POST", `/purchasing/receipts/${r.id}/void`, { reason: "otra vez" })).json.code, "ALREADY_VOIDED");
  });

  it("si lo recibido ya se consumió no se puede anular y no cambia nada", async () => {
    const p = await product({ code: "CONSUMIDO", name: "Consumido" });
    const o = await issued([{ productId: p, quantity: 5, unitCost: 2 }]);
    const r = (await receive(admin, { orderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: 5 }] })).json;
    await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Venta", lines: [{ productId: p, quantity: -3 }] });
    const v = await api(admin, "POST", `/purchasing/receipts/${r.id}/void`, { reason: "tarde" });
    assert.equal(v.status, 409); assert.equal(v.json.code, "INSUFFICIENT_STOCK");
    assert.deepEqual(await stock(p), ["2", "4"]);
    assert.equal((await api(admin, "GET", `/purchasing/orders/${o.id}`)).json.status, "RECEIVED");
    assert.equal((await api(admin, "GET", "/purchasing/receipts")).json.find((x: { id: string }) => x.id === r.id).status, "POSTED");
  });

  it("anular exige motivo y permiso; otra empresa no la ve", async () => {
    const r = (await receive(admin, { supplierId: S1, warehouseId: W1, lines: [{ productId: P1, quantity: 1, unitCost: 1 }] })).json;
    assert.equal((await api(admin, "POST", `/purchasing/receipts/${r.id}/void`, { reason: "x" })).status, 400);
    assert.equal((await api(cashier, "POST", `/purchasing/receipts/${r.id}/void`, { reason: "intruso" })).status, 403);
    assert.equal((await api(adminB, "POST", `/purchasing/receipts/${r.id}/void`, { reason: "intruso" })).status, 404);
  });
});

describe("concurrencia e integridad", () => {
  it("dos recepciones simultáneas que juntas exceden lo pendiente: solo una pasa", async () => {
    const o = await issued([{ productId: P1, quantity: 10, unitCost: 1 }]);
    const [a, b] = await Promise.all([1, 2].map(() => receive(admin, { orderId: o.id, lines: [{ orderLineId: o.lines[0].id, quantity: 7 }] })));
    assert.deepEqual([a!.status, b!.status].sort(), [201, 409]);
    const ord = (await api(admin, "GET", `/purchasing/orders/${o.id}`)).json;
    assert.deepEqual([ord.lines[0].receivedQty, ord.status], ["7", "PARTIALLY_RECEIVED"]);
  });

  it("la conciliación de inventario sigue sin diferencias tras todas las compras", async () => {
    const rec = (await api(admin, "GET", "/inventory/reconciliation")).json;
    assert.deepEqual([rec.balances, rec.valuations], [[], []]);
  });

  it("la base impide recibir más de lo pedido y borrar documentos de compra, incluso con el usuario de la aplicación", async () => {
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE purchase_order_line SET received_qty = quantity + 1 WHERE id = (SELECT id FROM purchase_order_line LIMIT 1)`)), /check|restricci/i);
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of ["DELETE FROM goods_receipt", "DELETE FROM goods_receipt_line", "DELETE FROM purchase_order", "DELETE FROM supplier"]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
    } finally { await app.$disconnect(); }
  });

  it("las acciones quedan auditadas", async () => {
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    for (const a of ["supplier.created", "purchase_order.created", "purchase_order.issued", "purchase_order.cancelled", "purchase_order.closed", "goods_receipt.posted", "goods_receipt.voided"]) assert.ok(acts.has(a), a);
  });
});
