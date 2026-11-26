import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addMember, createDb, withTenant } from "@erp/db";
import { PasswordService } from "../src/auth/password.service";
import { call, owner, PW, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string, cashier2: string;
let UND: string, W1: string, W2: string, L1: string, P: string, CUST: string;
let BOX1: string, BOX2: string, VAULT: string, A2BOX: string;

type M = "GET" | "POST" | "PATCH" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const sum = (d: Record<string, number>) => Object.entries(d).reduce((s, [k, n]) => s + Number(k) * n, 0);

const open = (token: string, registerId: string, denominations: Record<string, number> = { "100": 2, "50": 1, "20": 1 }) => api(token, "POST", "/cash/sessions", { registerId, denominations });
const session = async (id: string) => (await api(admin, "GET", `/cash/sessions/${id}`)).json;
const close = (token: string, id: string, denominations: Record<string, number>, justification?: string) => api(token, "POST", `/cash/sessions/${id}/close`, { denominations, ...(justification ? { justification } : {}) });
const decide = (token: string, id: string, approve: boolean, note = "Revisado") => api(token, "POST", `/cash/sessions/${id}/decision`, { approve, note });
const move = (token: string, id: string, type: string, amount: number, extra: object = {}) => api(token, "POST", `/cash/sessions/${id}/movements`, { type, amount, note: "Movimiento de prueba", ...extra });
const sellCash = async (token: string, qty: number, payments: object[], warehouseId = W1) => {
  const d = await api(admin, "POST", "/sales/orders", { warehouseId, customerId: CUST, lines: [{ productId: P, quantity: qty }] });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  return api(token, "POST", `/sales/orders/${d.json.id}/confirm`, { payments });
};
const reconciled = async () => { const r = (await api(admin, "GET", "/inventory/reconciliation")).json; return [r.balances.length, r.valuations.length]; };

before(async () => {
  await setup();
  const hash = await world.app.get(PasswordService).hash(PW);
  await addMember(owner, { tenantId: world.tenantA, email: "cajero2@test.local", name: "Cajero Dos", passwordHash: hash, roleCode: "cashier", branches: [{ branchId: world.a1 }] });
  [admin, adminB, manager, cashier, cashier2] = await Promise.all([
    tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local"), tokenFor("cajero2@test.local"),
  ]);
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  W2 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a2, code: "W2", name: "Norte" })).json.id;
  L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  P = (await api(admin, "POST", "/catalog/products", { code: "P1", name: "Producto", baseUnitId: UND })).json.id;
  await call("PUT", `/api/v1/pricing/lists/${L1}/prices/${P}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } });
  for (const w of [W1, W2]) await api(admin, "POST", "/inventory/adjustments", { warehouseId: w, reason: "Carga", lines: [{ productId: P, quantity: 500, unitCost: 5 }] });
  CUST = (await api(admin, "POST", "/sales/customers", { name: "Cliente", taxId: "1" })).json.id;
  BOX1 = (await api(admin, "POST", "/cash/registers", { branchId: world.a1, code: "CAJA1", name: "Caja 1" })).json.id;
  BOX2 = (await api(admin, "POST", "/cash/registers", { branchId: world.a1, code: "CAJA2", name: "Caja 2" })).json.id;
  VAULT = (await api(admin, "POST", "/cash/registers", { branchId: world.a1, code: "BOVEDA", name: "Bóveda", kind: "VAULT" })).json.id;
  A2BOX = (await api(admin, "POST", "/cash/registers", { branchId: world.a2, code: "NORTE1", name: "Caja Norte" })).json.id;
});
after(teardown);

describe("cajas", () => {
  it("el código es único; cada caja pertenece a una sucursal; permisos y alcance", async () => {
    assert.equal((await api(admin, "POST", "/cash/registers", { branchId: world.a1, code: "CAJA1", name: "Repetida" })).status, 409);
    assert.equal((await api(cashier, "POST", "/cash/registers", { branchId: world.a1, code: "X", name: "Intruso" })).status, 403);
    assert.equal((await api(manager, "POST", "/cash/registers", { branchId: world.a3, code: "X3", name: "Fuera de alcance" })).status, 403);
    assert.equal((await api(adminB, "POST", "/cash/registers", { branchId: world.a1, code: "AJENA", name: "De otra empresa" })).status, 403);
    assert.deepEqual((await api(cashier, "GET", "/cash/registers")).json.map((r: { code: string }) => r.code).sort(), ["BOVEDA", "CAJA1", "CAJA2"], "el cajero (A1) no ve la caja de A2");
    assert.equal((await api(adminB, "GET", "/cash/registers")).json.length, 0);
  });
});

describe("apertura de turno", () => {
  it("abre con el fondo contado por denominación y deja el movimiento de apertura", async () => {
    const r = await open(cashier, BOX1);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.match(r.json.code, /^SC-\d{6}$/);
    assert.deepEqual([r.json.status, r.json.openingCash, r.json.expectedCash, r.json.responsible.name], ["OPEN", "270", "270", "Cajero"]);
    assert.deepEqual(r.json.movements.map((m: { type: string; amount: string }) => [m.type, m.amount]), [["OPENING", "270"]]);
    assert.equal((await api(admin, "GET", "/cash/registers")).json.find((x: { code: string }) => x.code === "CAJA1").activeSession.status, "OPEN");
  });
  it("una caja no tiene dos turnos a la vez, ni siquiera abiertos al mismo tiempo", async () => {
    assert.equal((await open(cashier2, BOX1)).json.code, "REGISTER_BUSY");
    const rs = await Promise.all([open(cashier, BOX2), open(cashier2, BOX2)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    const winner = rs.find((r) => r.status === 201)!.json;
    await close(winner.responsible.name === "Cajero" ? cashier : cashier2, winner.id, { "100": 2, "50": 1, "20": 1 });
  });
  it("valida denominaciones, caja inexistente, inactiva y fuera de alcance", async () => {
    assert.equal((await open(cashier, BOX2, { "7": 1 })).status, 400);
    assert.equal((await open(cashier, BOX2, { "100": -1 })).status, 400);
    assert.equal((await open(cashier, "00000000-0000-4000-8000-000000000000")).status, 404);
    assert.equal((await open(cashier, A2BOX)).status, 403, "A2 no es de su sucursal");
    const off = (await api(admin, "POST", "/cash/registers", { branchId: world.a1, code: "OFF", name: "Inactiva" })).json.id;
    await api(admin, "PATCH", `/cash/registers/${off}`, { status: "INACTIVE" });
    assert.equal((await open(cashier, off)).json.code, "REGISTER_INACTIVE");
  });
  it("una caja con turno abierto no se desactiva", async () => {
    assert.equal((await api(admin, "PATCH", `/cash/registers/${BOX1}`, { status: "INACTIVE" })).json.code, "REGISTER_IN_USE");
  });
});

describe("movimientos del turno", () => {
  let S: string;
  before(async () => { S = (await api(cashier, "GET", "/cash/sessions/mine")).json[0].id; });

  it("ingresos, gastos y retiros mueven el efectivo esperado; no se gasta más de lo que hay", async () => {
    assert.equal((await move(cashier, S, "INCOME", 50)).json.expectedCash, "320");
    assert.equal((await move(cashier, S, "EXPENSE", 30)).json.expectedCash, "290");
    assert.equal((await move(cashier, S, "WITHDRAWAL", 90)).json.expectedCash, "200");
    const over = await move(cashier, S, "EXPENSE", 201);
    assert.equal(over.status, 409); assert.equal(over.json.code, "INSUFFICIENT_CASH");
    assert.equal((await move(cashier, S, "EXPENSE", 10, { note: "x" })).status, 400, "el motivo exige 3+ letras");
    const types = (await session(S)).movements.map((m: { type: string }) => m.type);
    assert.deepEqual(types, ["WITHDRAWAL", "EXPENSE", "INCOME", "OPENING"], "el libro conserva todo, del más nuevo al más antiguo");
  });
  it("solo operan el responsable, los participantes y quien administra cajas", async () => {
    assert.equal((await move(cashier2, S, "INCOME", 5)).json.code, "NOT_IN_SESSION");
    const u2 = (await withTenant(owner, world.tenantA, (tx) => tx.membership.findFirstOrThrow({ where: { user: { email: "cajero2@test.local" } }, select: { userId: true } }))).userId;
    assert.equal((await api(cashier, "POST", `/cash/sessions/${S}/participants`, { userId: u2 })).status, 200);
    assert.equal((await api(cashier, "POST", `/cash/sessions/${S}/participants`, { userId: u2 })).json.code, "ALREADY_PARTICIPANT");
    assert.equal((await move(cashier2, S, "INCOME", 5)).status, 200);
    assert.equal((await move(manager, S, "INCOME", 5)).status, 200, "quien administra cajas también puede");
    assert.equal((await move(adminB, S, "INCOME", 5)).status, 404);
  });
  it("el otro medio de pago se registra aparte y no cuenta como efectivo", async () => {
    const r = await move(cashier, S, "INCOME", 40, { method: "QR" });
    assert.equal(r.json.expectedCash, "210");
    const qr = r.json.totals.find((t: { method: string }) => t.method === "QR");
    assert.deepEqual([qr.income, qr.outflow, qr.net], ["40", "0", "40"]);
  });
  it("revertir compensa con otro movimiento, una sola vez; los cobros de ventas no se revierten aquí", async () => {
    const exp = (await session(S)).movements.find((m: { type: string; amount: string }) => m.type === "EXPENSE");
    const r = await api(cashier, "POST", `/cash/movements/${exp.id}/reverse`, { reason: "Error de monto" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.expectedCash, "240", "se recupera el gasto de 30");
    assert.equal(r.json.movements[0].type, "REVERSAL");
    assert.equal((await api(cashier, "POST", `/cash/movements/${exp.id}/reverse`, { reason: "otra vez" })).json.code, "ALREADY_REVERSED");
    assert.equal((await api(cashier, "POST", `/cash/movements/${r.json.movements[0].id}/reverse`, { reason: "revertir reverso" })).json.code, "NOT_REVERSIBLE");
    const opening = r.json.movements.find((m: { type: string }) => m.type === "OPENING");
    assert.equal((await api(cashier, "POST", `/cash/movements/${opening.id}/reverse`, { reason: "apertura" })).json.code, "NOT_REVERSIBLE");
  });
  it("el arqueo parcial compara lo contado con lo esperado sin cerrar el turno", async () => {
    const r = await api(cashier, "POST", `/cash/sessions/${S}/count`, { denominations: { "100": 2, "20": 2 } }); // 240 = esperado
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.status, r.json.counts[0].expectedCash, r.json.counts[0].countedCash, r.json.counts[0].difference, r.json.counts[0].isClosing], ["OPEN", "240", "240", "0", false]);
  });
});

describe("cobros de ventas y caja", () => {
  let S: string;
  before(async () => { S = (await api(cashier, "GET", "/cash/sessions/mine")).json[0].id; });

  it("con caja en la sucursal, cobrar en efectivo exige un turno abierto a tu nombre", async () => {
    const noSession = await sellCash(manager, 1, [{ method: "CASH", amount: 10 }]); // el gerente no participa en ningún turno
    assert.equal(noSession.status, 409); assert.equal(noSession.json.code, "CASH_SESSION_REQUIRED");
  });
  it("el cobro en efectivo entra al libro del turno y queda ligado a él; el QR se registra aparte", async () => {
    const before = (await session(S)).expectedCash;
    const r = await sellCash(cashier, 3, [{ method: "CASH", amount: 20 }, { method: "QR", amount: 10 }]);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const after = await session(S);
    assert.equal(Number(after.expectedCash), Number(before) + 20, "solo el efectivo suma al esperado");
    const pays = after.movements.filter((m: { type: string }) => m.type === "SALE_PAYMENT");
    assert.deepEqual(pays.map((m: { method: string; amount: string }) => [m.method, m.amount]).sort(), [["CASH", "20"], ["QR", "10"]]);
    const dbPay = await withTenant(owner, world.tenantA, (tx) => tx.payment.findMany({ where: { sale: { id: r.json.id } }, select: { cashSessionId: true } }));
    assert.ok(dbPay.every((p) => p.cashSessionId === S));
  });
  it("un cobro posterior también se registra en el turno", async () => {
    const credit = (await sellCash(cashier, 1, [])).json;
    const before = Number((await session(S)).expectedCash);
    const r = await api(cashier, "POST", `/sales/orders/${credit.id}/payments`, { method: "CASH", amount: 10 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(Number((await session(S)).expectedCash), before + 10);
  });
  it("el reintegro de una devolución en efectivo sale de la caja", async () => {
    const sale = (await sellCash(cashier, 2, [{ method: "CASH", amount: 20 }])).json;
    const u = (await withTenant(owner, world.tenantA, (tx) => tx.membership.findFirstOrThrow({ where: { user: { email: "multi@test.local" } }, select: { userId: true } }))).userId;
    await api(cashier, "POST", `/cash/sessions/${S}/participants`, { userId: u });
    const before = Number((await session(S)).expectedCash);
    const ret = await api(admin, "POST", `/sales/orders/${sale.id}/returns`, { reason: "Devolución de prueba", lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }], refund: { method: "CASH", cashSessionId: S } });
    assert.equal(ret.status, 403, "el admin no opera en ese turno: el reintegro en efectivo debe salir de SU turno");
    const ok = await api(cashier, "POST", `/sales/orders/${sale.id}/returns`, { reason: "Devolución de prueba", lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }], refund: { method: "CASH" } });
    assert.equal(ok.status, 403, "el cajero no tiene permiso de devoluciones");
    const mgr = await api(manager, "POST", `/sales/orders/${sale.id}/returns`, { reason: "Devolución de prueba", lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }], refund: { method: "CASH", cashSessionId: S } });
    assert.equal(mgr.status, 201, JSON.stringify(mgr.json));
    assert.equal(Number((await session(S)).expectedCash), before - 10, "−10: lo devuelto sale del efectivo del turno");
    assert.equal((await session(S)).movements[0].type, "REFUND");
  });
  it("una sucursal sin cajas no tiene control de caja (el efectivo se cobra como siempre)", async () => {
    const r = await sellCash(admin, 1, [{ method: "CASH", amount: 10 }], W2);
    assert.equal(r.status, 409, "A2 SÍ tiene una caja (NORTE1) y nadie abrió turno");
    await api(admin, "PATCH", `/cash/registers/${A2BOX}`, { status: "INACTIVE" });
    assert.equal((await sellCash(admin, 1, [{ method: "CASH", amount: 10 }], W2)).status, 200, "sin cajas activas, sin control");
    await api(admin, "PATCH", `/cash/registers/${A2BOX}`, { status: "ACTIVE" });
  });
  it("no se cobra en el turno de otra persona", async () => {
    const d = (await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CUST, lines: [{ productId: P, quantity: 1 }] })).json;
    const r = await api(admin, "POST", `/sales/orders/${d.id}/confirm`, { payments: [{ method: "CASH", amount: 10, cashSessionId: S }] });
    assert.equal(r.status, 403); assert.equal(r.json.code, "CASH_SESSION_FORBIDDEN");
  });
});

describe("cierre, arqueo y diferencias", () => {
  const fresh = async (register: string, who = cashier) => { const r = await open(who, register, { "100": 1 }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id as string; };

  it("sin diferencia: cierra de inmediato con una foto inmutable del cierre", async () => {
    const S = (await api(cashier, "GET", "/cash/sessions/mine")).json[0].id;
    const sess = await session(S);
    const exp = Number(sess.expectedCash);
    // armar un conteo que dé exactamente lo esperado
    const dens: Record<string, number> = {}; let left = Math.round(exp * 10) / 10;
    for (const d of ["200", "100", "50", "20", "10", "5", "2", "1", "0.5"]) { const n = Math.floor(left / Number(d) + 1e-9); if (n > 0) { dens[d] = n; left = Math.round((left - n * Number(d)) * 100) / 100; } }
    assert.ok(Math.abs(sum(dens) - exp) < 0.0001, `no se pudo armar ${exp} con las denominaciones (resto ${left})`);
    const r = await close(cashier, S, dens);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.status, r.json.counts[0].difference, r.json.closings.length, r.json.differences.length], ["CLOSED", "0", 1, 0]);
    const snap = (await withTenant(owner, world.tenantA, (tx) => tx.cashClosing.findFirstOrThrow({ where: { sessionId: S } }))).snapshot as Record<string, unknown>;
    assert.equal(snap.expectedCash, String(exp));
    assert.ok(Array.isArray(snap.totalsByMethod));
  });

  it("un turno cerrado no admite movimientos ni cobros, ni por la API ni directo en la base", async () => {
    const S = (await api(admin, "GET", "/cash/sessions?status=CLOSED")).json.find((x: { register: { code: string } }) => x.register.code === "CAJA1").id;
    assert.equal((await move(cashier, S, "INCOME", 5)).json.code, "SESSION_NOT_OPEN");
    assert.equal((await sellCash(cashier, 1, [{ method: "CASH", amount: 10 }])).json.code, "CASH_SESSION_REQUIRED");
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(
      `INSERT INTO cash_movement (id, tenant_id, branch_id, session_id, type, method, amount, created_at) SELECT gen_random_uuid(), tenant_id, branch_id, id, 'INCOME', 'CASH', 1, now() FROM cash_session WHERE id = '${S}'`)), /no está abierta|check/i);
  });

  it("toda diferencia exige justificación", async () => {
    const S = await fresh(BOX1);
    const r = await close(cashier, S, { "100": 1, "5": 1 }); // 105 vs 100
    assert.equal(r.status, 400); assert.equal(r.json.code, "JUSTIFICATION_REQUIRED");
    assert.equal((await session(S)).status, "OPEN", "no quedó a medias");
    await close(cashier, S, { "100": 1 });
  });

  it("dentro de la tolerancia cierra con la diferencia ya aprobada; fuera de ella, espera a otra persona", async () => {
    assert.equal((await api(cashier, "PUT", "/cash/settings", { differenceTolerance: 5 })).status, 403);
    assert.equal((await api(admin, "PUT", "/cash/settings", { differenceTolerance: 5 })).json.differenceTolerance, 5);
    assert.equal((await api(cashier, "GET", "/cash/settings")).json.differenceTolerance, 5);

    const a = await fresh(BOX1);
    const within = await close(cashier, a, { "50": 1, "20": 2, "5": 1 }, "Faltaron 5 de cambio"); // 95 vs 100: −5 (= tolerancia)
    assert.deepEqual([within.json.status, within.json.differences[0].status, within.json.differences[0].amount], ["CLOSED", "APPROVED", "-5"]);

    const b = await fresh(BOX1);
    const over = await close(cashier, b, { "50": 1, "20": 1 }, "Se perdió un billete"); // 70 vs 100: −30
    assert.deepEqual([over.status, over.json.status, over.json.differences[0].status], [200, "CLOSING", "PENDING"]);
    assert.equal((await api(admin, "GET", "/cash/registers")).json.find((r: { code: string }) => r.code === "CAJA1").activeSession.status, "CLOSING");
    // en cierre no entra nada más, y la caja sigue ocupada
    assert.equal((await move(cashier, b, "INCOME", 1)).json.code, "SESSION_NOT_OPEN");
    assert.equal((await sellCash(cashier, 1, [{ method: "CASH", amount: 10 }])).json.code, "CASH_SESSION_REQUIRED");
    assert.equal((await open(cashier2, BOX1)).json.code, "REGISTER_BUSY");
    // decisión
    assert.equal((await decide(cashier, b, true)).status, 403, "el cajero no puede aprobar diferencias");
    const ok = await decide(manager, b, true, "Se verificó con cámaras");
    assert.deepEqual([ok.status, ok.json.status, ok.json.differences[0].status, ok.json.closings.length], [200, "CLOSED", "APPROVED", 1]);
    assert.equal((await decide(manager, b, true)).json.code, "INVALID_STATE");
  });

  it("quien cierra no puede aprobar su propia diferencia", async () => {
    const S = await fresh(BOX2, admin);
    const r = await close(admin, S, { "20": 1 }, "Retiro no registrado"); // 20 vs 100: −80
    assert.equal(r.json.status, "CLOSING");
    const self = await decide(admin, S, true);
    assert.equal(self.status, 403); assert.equal(self.json.code, "SELF_APPROVAL");
    assert.equal((await decide(manager, S, true, "Aprobado por gerencia")).json.status, "CLOSED");
  });

  it("rechazar la diferencia devuelve el turno a abierto para recontar; el segundo cierre queda en otra versión", async () => {
    const S = await fresh(BOX1);
    await close(cashier, S, { "50": 1 }, "Conteo apurado"); // 50 vs 100
    const rej = await decide(manager, S, false, "Recuenta con calma");
    assert.deepEqual([rej.json.status, rej.json.differences[0].status], ["OPEN", "REJECTED"]);
    assert.equal((await move(cashier, S, "INCOME", 0.5, { method: "CASH" })).status, 200, "vuelve a admitir movimientos");
    const ok = await close(cashier, S, { "100": 1, "0.5": 1 });
    assert.deepEqual([ok.json.status, ok.json.counts.length], ["CLOSED", 2]);
  });

  it("reabrir exige permiso, deja rastro y conserva el cierre original", async () => {
    const S = await fresh(BOX1);
    await close(cashier, S, { "100": 1 });
    assert.equal((await api(cashier, "POST", `/cash/sessions/${S}/reopen`, { reason: "olvidé un gasto" })).status, 403);
    const r = await api(manager, "POST", `/cash/sessions/${S}/reopen`, { reason: "Faltaba registrar un gasto" });
    assert.deepEqual([r.status, r.json.status, r.json.reopenedCount, r.json.closings.length], [200, "OPEN", 1, 1]);
    assert.equal((await api(manager, "POST", `/cash/sessions/${S}/reopen`, { reason: "otra vez" })).json.code, "INVALID_STATE");
    await move(cashier, S, "EXPENSE", 20, { note: "Gasto olvidado" });
    const again = await close(cashier, S, { "50": 1, "20": 1, "10": 1 });
    assert.deepEqual([again.json.status, again.json.closings.map((c: { version: number }) => c.version)], ["CLOSED", [1, 2]]);
    // no se reabre si la caja ya tiene otro turno
    const other = await fresh(BOX1);
    assert.equal((await api(manager, "POST", `/cash/sessions/${S}/reopen`, { reason: "intento" })).json.code, "REGISTER_BUSY");
    await close(cashier, other, { "100": 1 });
  });

  it("la base: libro, arqueos y cierres no se editan ni se borran; el cierre fija lo que se cerró", async () => {
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of ["DELETE FROM cash_movement", "UPDATE cash_movement SET amount = 1", "TRUNCATE cash_movement", "DELETE FROM cash_count", "UPDATE cash_count SET counted_cash = 0", "DELETE FROM cash_closing", "UPDATE cash_closing SET snapshot = '{}'", "DELETE FROM cash_session", "DELETE FROM cash_register"]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
    } finally { await app.$disconnect(); }
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE cash_session SET status = 'CLOSED', closed_at = NULL WHERE status = 'CLOSED'`)), /check|restricci/i);
  });
});

describe("traspasos entre cajas", () => {
  it("el efectivo pasa de una caja a la bóveda con dos movimientos ligados", async () => {
    const box = (await open(cashier, BOX1, { "100": 3 })).json;
    const vault = (await open(admin, VAULT, {})).json;
    const r = await api(cashier, "POST", `/cash/sessions/${box.id}/transfer`, { toSessionId: vault.id, amount: 200, note: "Depósito a bóveda" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.expectedCash, "100");
    assert.equal((await session(vault.id)).expectedCash, "200");
    const [out, inn] = [r.json.movements[0], (await session(vault.id)).movements[0]];
    assert.deepEqual([out.type, out.amount, inn.type, inn.amount], ["TRANSFER_OUT", "-200", "TRANSFER_IN", "200"]);
    const groups = await withTenant(owner, world.tenantA, (tx) => tx.cashMovement.findMany({ where: { type: { in: ["TRANSFER_OUT", "TRANSFER_IN"] } }, select: { groupId: true } }));
    assert.equal(new Set(groups.map((g) => g.groupId)).size, 1, "ambas patas comparten el grupo");
    assert.equal((await api(cashier, "POST", `/cash/sessions/${box.id}/transfer`, { toSessionId: vault.id, amount: 101 })).json.code, "INSUFFICIENT_CASH");
    assert.equal((await api(cashier, "POST", `/cash/sessions/${box.id}/transfer`, { toSessionId: box.id, amount: 1 })).json.code, "SAME_SESSION");
    assert.equal((await api(cashier, "POST", `/cash/sessions/${box.id}/transfer`, { toSessionId: "00000000-0000-4000-8000-000000000000", amount: 1 })).status, 404);
  });
  it("traspasos cruzados simultáneos no se interbloquean y el efectivo total se conserva", async () => {
    const [a, b] = [(await api(cashier, "GET", "/cash/sessions/mine")).json[0], (await api(admin, "GET", "/cash/sessions?status=OPEN")).json.find((s: { register: { code: string } }) => s.register.code === "BOVEDA")];
    const total = Number(a.expectedCash) + Number(b.expectedCash);
    const rs = await Promise.all([
      api(cashier, "POST", `/cash/sessions/${a.id}/transfer`, { toSessionId: b.id, amount: 10 }),
      api(admin, "POST", `/cash/sessions/${b.id}/transfer`, { toSessionId: a.id, amount: 20 }),
      api(cashier, "POST", `/cash/sessions/${a.id}/transfer`, { toSessionId: b.id, amount: 5 }),
    ]);
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200], JSON.stringify(rs.map((r) => r.json.code)));
    assert.equal(Number((await session(a.id)).expectedCash) + Number((await session(b.id)).expectedCash), total);
  });
  it("los dos turnos deben estar abiertos", async () => {
    const [a, b] = [(await api(cashier, "GET", "/cash/sessions/mine")).json[0], (await api(admin, "GET", "/cash/sessions?status=OPEN")).json.find((s: { register: { code: string } }) => s.register.code === "BOVEDA")];
    await close(admin, b.id, { "200": 1, "20": 0 }, "cierre de prueba").catch(() => null);
    const cur = Number((await session(b.id)).expectedCash);
    void cur;
    // cerrar la bóveda con lo esperado exacto
    const sB = await session(b.id);
    if (sB.status === "OPEN") {
      const exp = Number(sB.expectedCash); const dens: Record<string, number> = {}; let left = exp;
      for (const d of ["200", "100", "50", "20", "10", "5", "2", "1", "0.5"]) { const n = Math.floor(left / Number(d) + 1e-9); if (n > 0) { dens[d] = n; left = Math.round((left - n * Number(d)) * 100) / 100; } }
      await close(admin, b.id, dens, "cierre");
    }
    const r = await api(cashier, "POST", `/cash/sessions/${a.id}/transfer`, { toSessionId: b.id, amount: 1 });
    assert.equal(r.json.code, "SESSION_NOT_OPEN");
  });
});

describe("concurrencia con el cierre", () => {
  it("un cobro y el cierre a la vez: nada entra después del cierre", async () => {
    const S = (await open(cashier2, BOX2, { "100": 1 })).json.id;
    const drafts = await Promise.all([1, 2, 3, 4].map(async () => (await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: CUST, lines: [{ productId: P, quantity: 1 }] })).json.id as string));
    const closing = close(cashier2, S, { "100": 1 });
    const pays = drafts.map((id) => api(cashier2, "POST", `/sales/orders/${id}/confirm`, { payments: [{ method: "CASH", amount: 10 }] }));
    const [c, ...ps] = await Promise.all([closing, ...pays]);
    const final = await session(S);
    // Si el cierre ganó la carrera con diferencia, queda CLOSING; si no hubo diferencia, CLOSED. En ambos casos el esperado no cambia después.
    assert.ok(["CLOSED", "CLOSING", "OPEN"].includes(final.status), `${c.status} ${final.status}`);
    const okPays = ps.filter((p) => p.status === 200).length;
    const inLedger = final.movements.filter((m: { type: string }) => m.type === "SALE_PAYMENT").length;
    assert.equal(inLedger, okPays, "cada cobro aceptado está en el libro del turno y ninguno rechazado quedó a medias");
    for (const p of ps.filter((x) => x.status !== 200)) assert.equal(p.json.code, "CASH_SESSION_REQUIRED");
    if (final.status !== "OPEN") {
      const snap = (await withTenant(owner, world.tenantA, (tx) => tx.cashCount.findFirst({ where: { sessionId: S, isClosing: true } })))!;
      assert.equal(snap.expectedCash.toString(), final.expectedCash, "el esperado del cierre coincide con el libro: no entró nada después");
    }
    if (final.status === "CLOSING") await decide(manager, S, true, "Carrera de prueba");
    else if (final.status === "OPEN") await close(cashier2, S, { "100": 1 }, "x").catch(() => null);
  });
});

describe("reportes, trazabilidad y aislamiento", () => {
  it("el reporte agrupa por caja, por responsable y consolidado, por medio de pago", async () => {
    const r = (await api(admin, "GET", "/cash/report")).json;
    assert.ok(r.byRegister.some((x: { registerCode: string; method: string }) => x.registerCode === "CAJA1" && x.method === "CASH"));
    assert.ok(r.byUser.some((x: { name: string }) => x.name === "Cajero"));
    const cash = r.total.find((t: { method: string }) => t.method === "CASH");
    assert.equal(Number(cash.income) - Number(cash.outflow), Number(cash.net));
    const qr = r.total.find((t: { method: string }) => t.method === "QR");
    assert.ok(qr && Number(qr.income) > 0, "el QR se informa aparte");
    assert.equal((await api(admin, "GET", "/cash/report?from=2000-01-01&to=2000-01-02")).json.total.length, 0);
    assert.equal((await api(cashier, "GET", "/cash/report")).status, 200);
  });
  it("la empresa B no ve cajas, turnos ni movimientos de A", async () => {
    const some = (await api(admin, "GET", "/cash/sessions")).json[0];
    assert.equal((await api(adminB, "GET", `/cash/sessions/${some.id}`)).status, 404);
    assert.deepEqual((await api(adminB, "GET", "/cash/sessions")).json, []);
    assert.equal((await close(adminB, some.id, {})).status, 404);
    assert.equal((await api(adminB, "POST", `/cash/sessions/${some.id}/reopen`, { reason: "intruso" })).status, 404);
  });
  it("la conciliación de inventario sigue cuadrando y todo queda auditado", async () => {
    assert.deepEqual(await reconciled(), [0, 0]);
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    for (const a of ["cash.register_created", "cash.session_opened", "cash.income", "cash.expense", "cash.closing_requested", "cash.difference_approved", "cash.difference_rejected", "cash.session_reopened", "cash.transferred", "cash.reversed", "cash.settings_changed"]) assert.ok(acts.has(a), a);
  });
});
