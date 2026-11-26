import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addMember, createDb, uuidv7, withTenant } from "@erp/db";
import { Clock } from "../src/access/clock";
import { PasswordService } from "../src/auth/password.service";
import { call, owner, PW, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string, counter: string, clock: Clock;
let W1: string, W2: string, W3: string, UND: string;
let P1: string, PL: string, PK: string, PS: string;

type M = "GET" | "POST" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });
const isoDay = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const adjust = (warehouseId: string, lines: object[], token = admin) => api(token, "POST", "/inventory/adjustments", { warehouseId, reason: "Prueba", lines });
const product = async (body: object) => { const r = await api(admin, "POST", "/catalog/products", { baseUnitId: UND, ...body }); assert.equal(r.status, 201); return r.json.id as string; };
/** [cantidad, valor] de un producto en un almacén. */
const stock = async (productId: string, warehouseId: string) => {
  const [row] = (await api(admin, "GET", `/inventory/stock?productId=${productId}&warehouseId=${warehouseId}`)).json.items;
  return row ? [row.physicalQty, row.value] : ["0", "0"];
};
const transitStock = async (productId: string) => {
  const rows = (await api(admin, "GET", `/inventory/stock?productId=${productId}`)).json.items.filter((r: { warehouse: { code: string } }) => r.warehouse.code === "_TRANSITO");
  return rows[0] ? [rows[0].physicalQty, rows[0].value] : ["0", "0"];
};
const lotsOf = async (productId: string, warehouseId: string) =>
  (await api(admin, "GET", `/inventory/stock/lots?productId=${productId}&warehouseId=${warehouseId}`)).json.map((l: { lotCode: string; availableQty: string; unitCost: string }) => [l.lotCode, l.availableQty, l.unitCost]);
const newTransfer = async (from: string, to: string, lines: { productId: string; quantity: number }[], token = admin) => {
  const r = await api(token, "POST", "/inventory/transfers", { fromWarehouseId: from, toWarehouseId: to, lines });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
};
const dispatch = (id: string, token = admin) => api(token, "POST", `/inventory/transfers/${id}/dispatch`);
const receive = (id: string, body: object = {}, token = admin) => api(token, "POST", `/inventory/transfers/${id}/receive`, body);
const reconciled = async () => { const r = (await api(admin, "GET", "/inventory/reconciliation")).json; return [r.balances.length, r.valuations.length]; };

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  const hash = await world.app.get(PasswordService).hash(PW);
  // Rol "contador": cuenta y envía conteos (adjust.request) pero no los aplica (adjust.approve).
  await withTenant(owner, world.tenantA, async (tx) => {
    const role = await tx.role.create({ data: { id: uuidv7(), tenantId: world.tenantA, code: "counter", name: "Contador" } });
    const perms = await tx.permission.findMany({ where: { code: { in: ["inventory.read", "inventory.adjust.request", "catalog.read"] } } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ tenantId: world.tenantA, roleId: role.id, permissionId: p.id })) });
  });
  await addMember(owner, { tenantId: world.tenantA, email: "contador@test.local", name: "Contador", passwordHash: hash, roleCode: "counter", branches: [{ branchId: world.a1 }] });
  [admin, adminB, manager, cashier, counter] = await Promise.all([
    tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local"), tokenFor("contador@test.local"),
  ]);
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  const wh = async (branchId: string, code: string) => (await api(admin, "POST", "/inventory/warehouses", { branchId, code, name: `Almacén ${code}` })).json.id as string;
  W1 = await wh(world.a1, "W1"); W2 = await wh(world.a2, "W2"); W3 = await wh(world.a3, "W3");
  P1 = await product({ code: "P1", name: "Producto 1" });
  PL = await product({ code: "PL", name: "Con lote y vencimiento", trackLots: true, trackExpiry: true });
  PK = await product({ code: "PK", name: "Al peso", baseUnitId: (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "KG").id });
  PS = await product({ code: "PS", name: "Servicio", kind: "SERVICE" });
  await adjust(W1, [{ productId: P1, quantity: 10, unitCost: 10 }]);
  await adjust(W1, [{ productId: P1, quantity: 10, unitCost: 12 }]); // W1: lote1 10@10 + lote2 10@12
});
after(async () => { clock.set(null); await teardown(); });

describe("crear transferencias", () => {
  it("valida origen distinto de destino, servicios, duplicados, decimales y productos inexistentes", async () => {
    const mk = (lines: object[], to = W2) => api(admin, "POST", "/inventory/transfers", { fromWarehouseId: W1, toWarehouseId: to, lines });
    assert.equal((await mk([{ productId: P1, quantity: 1 }], W1)).status, 400);
    assert.equal((await mk([{ productId: PS, quantity: 1 }])).json.code, "NOT_STOCKABLE");
    assert.equal((await mk([{ productId: P1, quantity: 1 }, { productId: P1, quantity: 2 }])).json.code, "DUPLICATE_PRODUCT");
    assert.equal((await mk([{ productId: P1, quantity: 1.5 }])).json.code, "INVALID_QUANTITY");
    assert.equal((await mk([{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }])).status, 404);
    assert.equal((await mk([{ productId: P1, quantity: 0 }])).status, 400);
    assert.equal((await mk([])).status, 400);
  });
  it("el borrador no mueve stock; el código es correlativo", async () => {
    const t = await newTransfer(W1, W2, [{ productId: P1, quantity: 3 }]);
    assert.match(t.code, /^TR-\d{6}$/);
    assert.deepEqual([t.status, t.lines[0].quantity, t.lines[0].lots], ["DRAFT", "3", []]);
    assert.deepEqual(await stock(P1, W1), ["20", "220"]);
    assert.equal((await api(admin, "POST", `/inventory/transfers/${t.id}/cancel`)).json.status, "CANCELLED");
  });
  it("permisos y alcance: el cajero no transfiere; el gerente (A1, A2) no origina desde A3", async () => {
    const body = (from: string, to: string) => ({ fromWarehouseId: from, toWarehouseId: to, lines: [{ productId: P1, quantity: 1 }] });
    assert.equal((await api(cashier, "POST", "/inventory/transfers", body(W1, W2))).status, 403);
    assert.equal((await api(manager, "POST", "/inventory/transfers", body(W1, W2))).status, 201);
    assert.equal((await api(manager, "POST", "/inventory/transfers", body(W3, W1))).status, 403);
    assert.equal((await api(adminB, "POST", "/inventory/transfers", body(W1, W2))).status, 404);
  });
});

describe("despacho, tránsito y recepción", () => {
  let t: any;
  let lotsAtSource: unknown[];

  it("despachar saca del origen (FIFO) y deja la mercadería en tránsito con su lote y costo", async () => {
    lotsAtSource = await lotsOf(P1, W1);
    t = await newTransfer(W1, W2, [{ productId: P1, quantity: 15 }]);
    const d = await dispatch(t.id);
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.deepEqual(d.json.lines[0].lots.map((l: { quantity: string; unitCost: string }) => [l.quantity, l.unitCost]), [["10", "10"], ["5", "12"]]);
    assert.deepEqual(await stock(P1, W1), ["5", "60"]);
    assert.deepEqual(await transitStock(P1), ["15", "160"]);
    assert.deepEqual(await stock(P1, W2), ["0", "0"]);
    assert.equal(d.json.status, "IN_TRANSIT");
    assert.ok(d.json.dispatchedAt);
  });

  it("el almacén de tránsito no es visible como almacén operativo ni se puede usar directamente", async () => {
    assert.ok(!(await api(admin, "GET", "/inventory/warehouses")).json.some((w: { code: string }) => w.code === "_TRANSITO"));
    const transitId = (await withTenant(owner, world.tenantA, (tx) => tx.warehouse.findFirstOrThrow({ where: { kind: "TRANSIT" }, select: { id: true } }))).id;
    assert.equal((await adjust(transitId, [{ productId: P1, quantity: 1, unitCost: 1 }])).json.code, "WAREHOUSE_TRANSIT", "no se opera el tránsito a mano");
    assert.equal((await api(admin, "POST", "/inventory/transfers", { fromWarehouseId: transitId, toWarehouseId: W2, lines: [{ productId: P1, quantity: 1 }] })).status, 409);
  });

  it("no se despacha dos veces ni se recibe lo que no está en tránsito", async () => {
    assert.equal((await dispatch(t.id)).json.code, "INVALID_STATE");
    const draft = await newTransfer(W1, W2, [{ productId: P1, quantity: 1 }]);
    assert.equal((await receive(draft.id)).json.code, "INVALID_STATE");
    await api(admin, "POST", `/inventory/transfers/${draft.id}/cancel`);
  });

  it("recibir todo entra al destino con los MISMOS lotes y costos; el tránsito queda en cero", async () => {
    const r = await receive(t.id);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.status, r.json.lines[0].receivedQty], ["RECEIVED", "15"]);
    assert.deepEqual(await stock(P1, W2), ["15", "160"]);
    assert.deepEqual(await transitStock(P1), ["0", "0"]);
    assert.deepEqual(await stock(P1, W1), ["5", "60"]);
    // el lote no se duplica: en el destino están los mismos códigos de lote que había en el origen
    const dest = await lotsOf(P1, W2);
    const sourceCodes = (lotsAtSource as string[][]).map((l) => l[0]);
    assert.deepEqual(dest.map((l: string[]) => l[0]).sort(), sourceCodes.sort());
    assert.deepEqual(dest.map((l: string[]) => [l[1], l[2]]).sort(), [["10", "10"], ["5", "12"]].sort());
    assert.equal((await receive(t.id)).json.code, "INVALID_STATE");
  });

  it("el kardex muestra las salidas y entradas de la transferencia y la conciliación no encuentra diferencias", async () => {
    const k = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&limit=50`)).json.items;
    const types = k.filter((m: { reasonCode: string }) => m.reasonCode === "TRANSFER").map((m: { type: string; quantity: string; warehouse: { code: string } }) => `${m.type}:${m.warehouse.code}:${m.quantity}`);
    assert.equal(types.filter((x: string) => x.startsWith("TRANSFER_OUT:W1")).length, 2);
    assert.equal(types.filter((x: string) => x.startsWith("TRANSFER_IN:W2")).length, 2);
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("si llega menos, hace falta el motivo y la diferencia se da de baja como pérdida en tránsito", async () => {
    const tt = await newTransfer(W1, W2, [{ productId: P1, quantity: 4 }]);
    await dispatch(tt.id);
    assert.equal((await receive(tt.id, { lines: [{ lineId: tt.lines[0].id, receivedQty: 5 }] })).json.code, "OVER_RECEIPT");
    const noNote = await receive(tt.id, { lines: [{ lineId: tt.lines[0].id, receivedQty: 3 }] });
    assert.equal(noNote.status, 400); assert.equal(noNote.json.code, "SHORTFALL_NOTE_REQUIRED");
    assert.equal((await api(admin, "GET", `/inventory/transfers/${tt.id}`)).json.status, "IN_TRANSIT", "no se aplicó nada");
    assert.deepEqual(await transitStock(P1), ["4", "48"]);
    const ok = await receive(tt.id, { lines: [{ lineId: tt.lines[0].id, receivedQty: 3 }], note: "Caja golpeada" });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.lines[0].receivedQty, "3");
    assert.deepEqual(await transitStock(P1), ["0", "0"]);
    assert.deepEqual(await stock(P1, W2), ["18", "196"]);
    const loss = (await api(admin, "GET", `/inventory/kardex?productId=${P1}&limit=10`)).json.items.find((m: { reasonCode: string }) => m.reasonCode === "TRANSIT_LOSS");
    assert.deepEqual([loss.type, loss.quantity, loss.warehouse.code], ["ADJUSTMENT_OUT", "-1", "_TRANSITO"]);
    assert.match(loss.note, /Caja golpeada/);
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("recibir 0 (no llegó nada) es válido con motivo y da de baja todo", async () => {
    const tt = await newTransfer(W2, W1, [{ productId: P1, quantity: 2 }]);
    await dispatch(tt.id);
    assert.equal((await receive(tt.id, { lines: [{ lineId: tt.lines[0].id, receivedQty: 0 }], note: "Extraviado" })).status, 200);
    assert.deepEqual(await transitStock(P1), ["0", "0"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });
});

describe("cancelación y stock insuficiente", () => {
  it("cancelar en tránsito devuelve la mercadería al origen con su lote y costo", async () => {
    const p = await product({ code: "CANC", name: "Cancelable" });
    await adjust(W1, [{ productId: p, quantity: 4, unitCost: 7 }]);
    await adjust(W1, [{ productId: p, quantity: 4, unitCost: 9 }]);
    const before = await lotsOf(p, W1);
    const valueBefore = (await stock(p, W1))[1];
    const t = await newTransfer(W1, W2, [{ productId: p, quantity: 6 }]);
    assert.equal((await dispatch(t.id)).status, 200);
    assert.notDeepEqual(await lotsOf(p, W1), before);
    assert.deepEqual(await transitStock(p), ["6", "46"]);
    const c = await api(admin, "POST", `/inventory/transfers/${t.id}/cancel`);
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.status, "CANCELLED");
    assert.deepEqual(await lotsOf(p, W1), before);
    assert.equal((await stock(p, W1))[1], valueBefore);
    assert.deepEqual(await transitStock(p), ["0", "0"]);
    assert.equal((await api(admin, "POST", `/inventory/transfers/${t.id}/cancel`)).json.code, "INVALID_STATE");
    assert.equal((await receive(t.id)).json.code, "INVALID_STATE");
  });

  it("una transferencia recibida no se cancela", async () => {
    const p = await product({ code: "RECIB", name: "Recibida" });
    await adjust(W1, [{ productId: p, quantity: 2, unitCost: 1 }]);
    const t = await newTransfer(W1, W2, [{ productId: p, quantity: 1 }]);
    assert.equal((await dispatch(t.id)).status, 200);
    assert.equal((await receive(t.id)).status, 200);
    assert.equal((await api(admin, "POST", `/inventory/transfers/${t.id}/cancel`)).json.code, "INVALID_STATE");
  });

  it("despachar más de lo que hay falla sin mover nada y el borrador se conserva", async () => {
    const [qty, value] = await stock(P1, W1);
    const t = await newTransfer(W1, W2, [{ productId: P1, quantity: 1000 }]);
    const d = await dispatch(t.id);
    assert.equal(d.status, 409); assert.equal(d.json.code, "INSUFFICIENT_STOCK");
    assert.deepEqual(await stock(P1, W1), [qty, value]);
    assert.deepEqual(await transitStock(P1), ["0", "0"]);
    assert.equal((await api(admin, "GET", `/inventory/transfers/${t.id}`)).json.status, "DRAFT");
  });

  it("una línea sin stock deshace TODA la transferencia (todo o nada)", async () => {
    const [qty] = await stock(P1, W1);
    const t = await newTransfer(W1, W2, [{ productId: P1, quantity: 1 }, { productId: PK, quantity: 1 }]);
    assert.equal((await dispatch(t.id)).status, 409);
    assert.deepEqual((await stock(P1, W1))[0], qty, "P1 tampoco salió");
    assert.deepEqual(await reconciled(), [0, 0]);
  });
});

describe("lotes con vencimiento, costo promedio y fraccionarios", () => {
  it("el lote viaja con su fecha de vencimiento y su código", async () => {
    await adjust(W1, [{ productId: PL, quantity: 6, unitCost: 4, lot: { code: "LOTE-X", expiresOn: isoDay(45) } }]);
    const t = await newTransfer(W1, W3, [{ productId: PL, quantity: 6 }]);
    await dispatch(t.id); await receive(t.id);
    const lots = (await api(admin, "GET", `/inventory/stock/lots?productId=${PL}&warehouseId=${W3}`)).json;
    assert.deepEqual(lots.map((l: { lotCode: string; expiresOn: string; unitCost: string }) => [l.lotCode, l.expiresOn, l.unitCost]), [["LOTE-X", isoDay(45), "4"]]);
  });

  it("un lote vencido no sale en una transferencia automática", async () => {
    const p = await product({ code: "VENCE", name: "Vence pronto", trackLots: true, trackExpiry: true });
    await adjust(W1, [{ productId: p, quantity: 5, unitCost: 1, lot: { code: "MALO", expiresOn: isoDay(2) } }, { productId: p, quantity: 5, unitCost: 2, lot: { code: "BUENO", expiresOn: isoDay(90) } }]);
    await withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE lot SET expires_on = CURRENT_DATE - 3 WHERE code = 'MALO'`));
    const t = await newTransfer(W1, W2, [{ productId: p, quantity: 6 }]);
    assert.equal((await dispatch(t.id)).json.code, "INSUFFICIENT_STOCK", "solo 5 útiles");
  });

  it("fraccionarios: 2,5 kg entre almacenes sin errores de redondeo", async () => {
    await adjust(W1, [{ productId: PK, quantity: 2.5, unitCost: 8 }]);
    const t = await newTransfer(W1, W2, [{ productId: PK, quantity: 1.25 }]);
    await dispatch(t.id); await receive(t.id);
    assert.deepEqual(await stock(PK, W1), ["1.25", "10"]);
    assert.deepEqual(await stock(PK, W2), ["1.25", "10"]);
  });

  it("con costo PROMEDIO el valor viaja y la conciliación sigue cuadrando", async () => {
    clock.set(new Date(Date.now() + 86_400_000));
    assert.equal((await api(admin, "POST", "/inventory/valuation/policy", { method: "AVERAGE" })).status, 200);
    const p = await product({ code: "AVG", name: "Promedio" });
    await adjust(W1, [{ productId: p, quantity: 4, unitCost: 10 }]);
    await adjust(W1, [{ productId: p, quantity: 4, unitCost: 20 }]); // promedio 15
    const t = await newTransfer(W1, W2, [{ productId: p, quantity: 4 }]);
    await dispatch(t.id);
    assert.deepEqual(await transitStock(p), ["4", "60"]);
    await receive(t.id);
    assert.deepEqual(await stock(p, W2), ["4", "60"]);
    assert.deepEqual(await stock(p, W1), ["4", "60"]);
    assert.deepEqual(await transitStock(p), ["0", "0"]);
    assert.deepEqual(await reconciled(), [0, 0]);
    clock.set(null);
  });
});

describe("sucursales, concurrencia e integridad", () => {
  it("el gerente envía de A1 a A3 (destino sin acceso) pero no puede recibir en A3; el administrador sí", async () => {
    const p = await product({ code: "SUC", name: "Entre sucursales" });
    await adjust(W1, [{ productId: p, quantity: 3, unitCost: 2 }]);
    const r = await api(manager, "POST", "/inventory/transfers", { fromWarehouseId: W1, toWarehouseId: W3, lines: [{ productId: p, quantity: 1 }] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal((await dispatch(r.json.id, manager)).status, 200);
    const rec = await receive(r.json.id, {}, manager);
    assert.equal(rec.status, 403); assert.equal(rec.json.code, "BRANCH_FORBIDDEN");
    assert.equal((await receive(r.json.id, {}, admin)).status, 200);
    assert.equal((await api(adminB, "GET", `/inventory/transfers/${r.json.id}`)).status, 404);
    assert.equal((await dispatch(r.json.id, adminB)).status, 404);
    assert.deepEqual((await api(adminB, "GET", "/inventory/transfers")).json, []);
  });

  it("dos despachos simultáneos que juntos exceden el stock: solo uno pasa", async () => {
    const p = await product({ code: "RACE", name: "Carrera" });
    await adjust(W1, [{ productId: p, quantity: 5, unitCost: 3 }]);
    const [a, b] = await Promise.all([newTransfer(W1, W2, [{ productId: p, quantity: 4 }]), newTransfer(W1, W2, [{ productId: p, quantity: 4 }])]);
    const rs = await Promise.all([dispatch(a.id), dispatch(b.id)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(await transitStock(p), ["4", "12"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("transferencias cruzadas simultáneas (W1→W2 y W2→W1 del mismo producto) no se interbloquean", async () => {
    const p = await product({ code: "CROSS", name: "Cruzadas" });
    await adjust(W1, [{ productId: p, quantity: 10, unitCost: 2 }]);
    await adjust(W2, [{ productId: p, quantity: 10, unitCost: 2 }]);
    const ts = await Promise.all([newTransfer(W1, W2, [{ productId: p, quantity: 3 }]), newTransfer(W2, W1, [{ productId: p, quantity: 4 }]), newTransfer(W1, W2, [{ productId: p, quantity: 2 }])]);
    const ds = await Promise.all(ts.map((t) => dispatch(t.id)));
    assert.deepEqual(ds.map((d) => d.status), [200, 200, 200], JSON.stringify(ds.map((d) => d.json.code)));
    const rs = await Promise.all(ts.map((t) => receive(t.id)));
    assert.deepEqual(rs.map((d) => d.status), [200, 200, 200]);
    assert.deepEqual([(await stock(p, W1))[0], (await stock(p, W2))[0]], ["9", "11"]); // W1: 10−3+4−2 · W2: 10+3−4+2
    assert.deepEqual(await transitStock(p), ["0", "0"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("recibir y cancelar a la vez: solo una de las dos operaciones prospera", async () => {
    const p = await product({ code: "RC", name: "Recibir o cancelar" });
    await adjust(W1, [{ productId: p, quantity: 5, unitCost: 1 }]);
    const t = await newTransfer(W1, W2, [{ productId: p, quantity: 5 }]);
    await dispatch(t.id);
    const rs = await Promise.all([receive(t.id), api(admin, "POST", `/inventory/transfers/${t.id}/cancel`)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(await transitStock(p), ["0", "0"]);
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("la base: un solo almacén de tránsito por empresa, no se borran transferencias y lo recibido no excede lo despachado", async () => {
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(
      `INSERT INTO warehouse (id, tenant_id, branch_id, code, name, kind, status, created_at, updated_at) SELECT gen_random_uuid(), tenant_id, branch_id, '_OTRO', 'Otro', 'TRANSIT', 'ACTIVE', now(), now() FROM warehouse WHERE kind = 'TRANSIT' LIMIT 1`)), /unique|duplicad|único/i);
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE stock_transfer_allocation SET received_qty = quantity + 1 WHERE id = (SELECT id FROM stock_transfer_allocation LIMIT 1)`)), /check|restricci/i);
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of ["DELETE FROM stock_transfer", "DELETE FROM stock_transfer_allocation", "DELETE FROM inventory_count"]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
    } finally { await app.$disconnect(); }
  });

  it("las acciones quedan auditadas", async () => {
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    for (const a of ["transfer.created", "transfer.dispatched", "transfer.received", "transfer.cancelled"]) assert.ok(acts.has(a), a);
  });
});

// ───────────── Conteos físicos ─────────────

describe("conteos físicos", () => {
  let CW: string, C1: string, C2: string;
  const open = (body: object, token = admin) => api(token, "POST", "/inventory/counts", body);
  const enter = (id: string, lines: object[], token = admin) => api(token, "PUT", `/inventory/counts/${id}/lines`, { lines });
  const act = (id: string, action: string, token = admin) => api(token, "POST", `/inventory/counts/${id}/${action}`);

  before(async () => {
    CW = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "CONT", name: "Almacén de conteo" })).json.id;
    C1 = await product({ code: "C1", name: "Contable 1" });
    C2 = await product({ code: "C2", name: "Contable 2" });
    await adjust(CW, [{ productId: C1, quantity: 10, unitCost: 5 }, { productId: C2, quantity: 4, unitCost: 20 }]);
  });

  it("un almacén vacío no se cuenta; abrir toma una foto por lote", async () => {
    const empty = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "VACIO", name: "Vacío" })).json.id;
    assert.equal((await open({ warehouseId: empty })).json.code, "EMPTY_COUNT");
    const c = await open({ warehouseId: CW, note: "Conteo mensual" });
    assert.equal(c.status, 201, JSON.stringify(c.json));
    assert.match(c.json.code, /^CF-\d{6}$/);
    assert.deepEqual([c.json.status, c.json.totals, c.json.lines.length], ["OPEN", { lines: 2, counted: 0, withDifference: 0 }, 2]);
    assert.deepEqual(c.json.lines.map((l: { expectedQty: string; countedQty: null }) => [l.expectedQty, l.countedQty]), [["10", null], ["4", null]]);
    (globalThis as any).__count = c.json;
  });

  it("se puede contar por producto", async () => {
    const only = await open({ warehouseId: CW, productIds: [C2] });
    assert.deepEqual(only.json.lines.map((l: { productCode: string }) => l.productCode), ["C2"]);
    assert.equal((await act(only.json.id, "cancel")).json.status, "CANCELLED");
  });

  it("registra cantidades por tandas, valida decimales y no deja enviar un conteo incompleto", async () => {
    const c = (globalThis as any).__count;
    const [l1, l2] = c.lines;
    assert.equal((await enter(c.id, [{ lineId: l1.id, countedQty: 1.5 }])).json.code, "INVALID_QUANTITY");
    assert.equal((await enter(c.id, [{ lineId: "00000000-0000-4000-8000-000000000000", countedQty: 1 }])).json.code, "LINE_NOT_FOUND");
    assert.equal((await enter(c.id, [{ lineId: l1.id, countedQty: 8 }])).json.totals.counted, 1);
    const inc = await act(c.id, "submit");
    assert.equal(inc.status, 409); assert.equal(inc.json.code, "COUNT_INCOMPLETE");
    const full = await enter(c.id, [{ lineId: l2.id, countedQty: 5 }]);
    assert.deepEqual([full.json.totals, full.json.differenceValue], [{ lines: 2, counted: 2, withDifference: 2 }, "10"], "−2×5 + 1×20 = +10");
  });

  it("enviar bloquea las cantidades; aplicar exige aprobador; el contador no puede aplicar ni devolver", async () => {
    const c = (globalThis as any).__count;
    assert.equal((await act(c.id, "submit", counter)).json.status, "SUBMITTED");
    assert.equal((await enter(c.id, [{ lineId: c.lines[0].id, countedQty: 9 }])).json.code, "INVALID_STATE");
    assert.equal((await act(c.id, "apply", counter)).status, 403);
    assert.equal((await act(c.id, "reopen", counter)).status, 403);
    assert.equal((await act(c.id, "apply", cashier)).status, 403);
  });

  it("aplicar: el faltante sale del lote, el sobrante entra al mismo lote al costo del lote; todo queda en el kardex", async () => {
    const c = (globalThis as any).__count;
    // Mientras se contaba hubo una salida de 2 de C1 (10 → 8): la diferencia se calcula sobre la FOTO, no se pierde ni se duplica.
    await adjust(CW, [{ productId: C1, quantity: -2 }]);
    const a = await act(c.id, "apply");
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.status, "APPLIED");
    // C1: foto 10, contado 8 → diferencia −2 → 8 − 2 = 6 · C2: foto 4, contado 5 → +1 → 5
    assert.deepEqual(await stock(C1, CW), ["6", "30"]);
    assert.deepEqual(await stock(C2, CW), ["5", "100"]);
    const k1 = (await api(admin, "GET", `/inventory/kardex?productId=${C1}&warehouseId=${CW}&limit=2`)).json.items[0];
    assert.deepEqual([k1.type, k1.quantity, k1.reasonCode], ["ADJUSTMENT_OUT", "-2", "COUNT"]);
    const k2 = (await api(admin, "GET", `/inventory/kardex?productId=${C2}&warehouseId=${CW}&limit=1`)).json.items[0];
    assert.deepEqual([k2.type, k2.quantity, k2.unitCost], ["ADJUSTMENT_IN", "1", "20"]);
    assert.equal((await api(admin, "GET", `/inventory/stock/lots?productId=${C2}&warehouseId=${CW}`)).json.length, 1, "el sobrante entra al lote existente");
    assert.deepEqual(await reconciled(), [0, 0]);
  });

  it("no se aplica dos veces ni se cancela uno aplicado", async () => {
    const c = (globalThis as any).__count;
    assert.equal((await act(c.id, "apply")).json.code, "INVALID_STATE");
    assert.equal((await act(c.id, "cancel")).json.code, "INVALID_STATE");
  });

  it("si lo que debía salir ya no está, aplicar falla sin cambiar nada y el conteo queda enviado", async () => {
    const p = await product({ code: "C3", name: "Contable 3" });
    await adjust(CW, [{ productId: p, quantity: 5, unitCost: 3 }]);
    const c = (await open({ warehouseId: CW, productIds: [p] })).json;
    await enter(c.id, [{ lineId: c.lines[0].id, countedQty: 3 }]); // faltante de 2
    await act(c.id, "submit");
    await adjust(CW, [{ productId: p, quantity: -5 }]); // se vendió todo mientras tanto
    const a = await act(c.id, "apply");
    assert.equal(a.status, 409); assert.equal(a.json.code, "INSUFFICIENT_STOCK");
    assert.equal((await api(admin, "GET", `/inventory/counts/${c.id}`)).json.status, "SUBMITTED");
    assert.deepEqual(await stock(p, CW), ["0", "0"]);
  });

  it("devolver un conteo enviado lo reabre; cancelar lo cierra; los conteos sin diferencia no generan movimientos", async () => {
    const p = await product({ code: "C4", name: "Contable 4" });
    await adjust(CW, [{ productId: p, quantity: 3, unitCost: 1 }]);
    const c = (await open({ warehouseId: CW, productIds: [p] })).json;
    await enter(c.id, [{ lineId: c.lines[0].id, countedQty: 3 }]);
    await act(c.id, "submit");
    assert.equal((await act(c.id, "reopen")).json.status, "OPEN");
    await act(c.id, "submit");
    const before = (await api(admin, "GET", `/inventory/kardex?productId=${p}`)).json.items.length;
    const a = await act(c.id, "apply");
    assert.deepEqual([a.json.status, a.json.totals.withDifference, a.json.differenceValue], ["APPLIED", 0, "0"]);
    assert.equal((await api(admin, "GET", `/inventory/kardex?productId=${p}`)).json.items.length, before, "sin diferencias no hay movimientos");
    const c2 = (await open({ warehouseId: CW, productIds: [C2] })).json;
    assert.equal((await act(c2.id, "cancel")).json.status, "CANCELLED");
    assert.equal((await enter(c2.id, [{ lineId: c2.lines[0].id, countedQty: 1 }])).json.code, "INVALID_STATE");
  });

  it("alcance: el gerente cuenta en A1; el contador solo en su sucursal; el cajero no; B no ve nada", async () => {
    assert.equal((await open({ warehouseId: CW }, counter)).status, 201);
    assert.equal((await open({ warehouseId: W3 }, manager)).status, 403);
    assert.equal((await open({ warehouseId: CW }, cashier)).status, 403);
    const list = (await api(admin, "GET", "/inventory/counts")).json;
    assert.ok(list.length >= 4);
    assert.equal((await api(adminB, "GET", `/inventory/counts/${list[0].id}`)).status, 404);
    assert.deepEqual((await api(adminB, "GET", "/inventory/counts")).json, []);
    assert.equal((await act(list[0].id, "cancel", adminB)).status, 404);
  });

  it("los conteos quedan auditados", async () => {
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    for (const a of ["count.opened", "count.submitted", "count.applied", "count.cancelled", "count.reopened"]) assert.ok(acts.has(a), a);
  });
});
