import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { createDb, withTenant } from "@erp/db";
import { Clock } from "../src/access/clock";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string, clock: Clock;
let W1: string, P: string, C0: string;
let roleManager: string, roleAdmin: string, adminUser: string, managerUser: string, cashierUser: string;

type M = "GET" | "POST" | "PUT";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });
const ten = (fn: (tx: any) => Promise<any>): Promise<any> => withTenant(owner, world.tenantA, fn);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const newSale = async (qty = 2) => {
  const d = await api(admin, "POST", "/sales/orders", { warehouseId: W1, customerId: C0, lines: [{ productId: P, quantity: qty }] });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  const c = await api(admin, "POST", `/sales/orders/${d.json.id}/confirm`, { payments: [] });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  return c.json as { id: string; code: string };
};
const saleStatus = async (id: string) => (await api(admin, "GET", `/sales/orders/${id}`)).json.status;
const setFlow = (eventType: string, enabled: boolean, config: object, token = admin) => api(token, "PUT", `/approvals/workflows/${eventType}`, { enabled, config });
const oneStep = (extra: object = {}) => ({ forbidSelfApproval: true, steps: [{ name: "Gerencia", roleIds: [roleManager], userIds: [], ...extra }] });
const ask = (token: string, saleId: string, reason = "El cliente devolvió todo") => api(token, "POST", "/approvals/requests", { eventType: "SALE_VOID", subjectId: saleId, reason });
const decide = (token: string, id: string, decision: "APPROVE" | "REJECT", note?: string) => api(token, "POST", `/approvals/requests/${id}/decide`, { decision, note });
const unread = async (token: string) => (await api(token, "GET", "/notifications")).json;

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  [admin, adminB, manager, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("multi@test.local", "empresa-a"), tokenFor("cajero@test.local")]);
  const roles = await ten((tx) => tx.role.findMany());
  roleManager = roles.find((r: any) => r.code === "manager")!.id;
  roleAdmin = roles.find((r: any) => r.code === "admin")!.id;
  const users = await owner.user.findMany({ where: { email: { in: ["admin.a@test.local", "multi@test.local", "cajero@test.local"] } } });
  adminUser = users.find((u) => u.email === "admin.a@test.local")!.id;
  managerUser = users.find((u) => u.email === "multi@test.local")!.id;
  cashierUser = users.find((u) => u.email === "cajero@test.local")!.id;
  const UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  W1 = (await api(admin, "POST", "/inventory/warehouses", { branchId: world.a1, code: "W1", name: "Principal" })).json.id;
  const L1 = (await api(admin, "POST", "/pricing/lists", { code: "GEN", name: "General", priceMode: "WITHOUT_TAX" })).json.id;
  P = (await api(admin, "POST", "/catalog/products", { code: "P1", name: "Producto", baseUnitId: UND })).json.id;
  await call("PUT", `/api/v1/pricing/lists/${L1}/prices/${P}`, { token: admin, body: { tiers: [{ minQuantity: 1, unitPrice: 10 }] } });
  await api(admin, "POST", "/inventory/adjustments", { warehouseId: W1, reason: "Carga", lines: [{ productId: P, quantity: 1000, unitCost: 5 }] });
  C0 = (await api(admin, "POST", "/sales/customers", { name: "Cliente", taxId: "0" })).json.id;
});
afterEach(() => clock.set(null));
after(async () => { clock.set(null); await teardown(); });

describe("flujos de aprobación", () => {
  it("todos los eventos existen y empiezan sin flujo activo", async () => {
    const r = await api(admin, "GET", "/approvals/workflows");
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 7);
    assert.ok(r.json.every((w: any) => w.enabled === false && w.config === null && w.version === 0));
    assert.equal(r.json.find((w: any) => w.eventType === "SALE_VOID").executable, true);
  });

  it("sin flujo activo no se puede pedir aprobación y la anulación directa sigue como antes", async () => {
    const s = await newSale();
    const r = await ask(cashier, s.id);
    assert.deepEqual([r.status, r.json.code], [409, "NO_WORKFLOW"]);
    const v = await api(admin, "POST", `/sales/orders/${s.id}/void`, { reason: "Error de digitación" });
    assert.equal(v.status, 200, JSON.stringify(v.json));
  });

  it("solo quien administra aprobaciones configura flujos", async () => {
    assert.equal((await setFlow("SALE_VOID", true, oneStep(), cashier)).status, 403);
    assert.equal((await setFlow("SALE_VOID", true, oneStep(), manager)).status, 403);
  });

  it("valida la configuración: niveles con aprobadores existentes", async () => {
    assert.equal((await setFlow("SALE_VOID", true, { steps: [] })).status, 400);
    assert.equal((await setFlow("SALE_VOID", true, { steps: [{ name: "Sin nadie", roleIds: [], userIds: [] }] })).status, 400);
    const ghost = "00000000-0000-4000-8000-000000000001";
    const r = await setFlow("SALE_VOID", true, { steps: [{ name: "Fantasma", roleIds: [ghost] }] });
    assert.deepEqual([r.status, r.json.code], [400, "ROLE_UNKNOWN"]);
    assert.equal((await setFlow("NO_EXISTE", true, oneStep())).status, 400);
  });

  it("guardar crea versiones y las anteriores quedan registradas", async () => {
    const a = await setFlow("SALE_VOID", true, oneStep());
    assert.deepEqual([a.status, a.json.version, a.json.enabled], [200, 1, true]);
    const b = await setFlow("SALE_VOID", true, oneStep({ dueHours: 4 }));
    assert.equal(b.json.version, 2);
    assert.equal(await ten((tx) => tx.approvalWorkflowVersion.count()), 2);
  });
});

describe("solicitud, decisión y ejecución", () => {
  let sale: { id: string; code: string }, req: any;

  it("con flujo activo la anulación directa se cierra, incluso para el administrador", async () => {
    await setFlow("SALE_VOID", true, oneStep());
    sale = await newSale();
    const v = await api(admin, "POST", `/sales/orders/${sale.id}/void`, { reason: "Intento directo" });
    assert.deepEqual([v.status, v.json.code], [409, "APPROVAL_REQUIRED"]);
    assert.equal(await saleStatus(sale.id), "CONFIRMED");
  });

  it("el vendedor pide la anulación; el gerente recibe el aviso y quien pidió no puede decidir", async () => {
    const r = await ask(cashier, sale.id);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    req = r.json;
    assert.deepEqual([req.status, req.currentStep, req.totalSteps, req.stepName, req.canDecide], ["PENDING", 1, 1, "Gerencia", false]);
    assert.equal(req.title, `Anular venta ${sale.code}`);
    assert.equal(req.amount, "20");
    assert.match(req.code, /^AP-\d{6}$/);
    const n = await unread(manager);
    assert.ok(n.unread >= 1 && n.items.some((i: any) => i.type === "APPROVAL_REQUESTED" && i.refId === req.id));
    assert.equal((await unread(cashier)).items.some((i: any) => i.type === "APPROVAL_REQUESTED"), false);
    assert.equal((await decide(cashier, req.id, "APPROVE")).status, 403); // sin permiso de decidir
  });

  it("no se duplica la solicitud de un mismo documento", async () => {
    const r = await ask(cashier, sale.id);
    assert.deepEqual([r.status, r.json.code], [409, "ALREADY_REQUESTED"]);
  });

  it("solo ve su solicitud quien la pidió o quien puede decidir", async () => {
    assert.equal((await api(cashier, "GET", `/approvals/requests/${req.id}`)).status, 200);
    assert.equal((await api(manager, "GET", `/approvals/requests/${req.id}`)).json.canDecide, true);
    assert.equal((await api(adminB, "GET", `/approvals/requests/${req.id}`)).status, 404);
    const inbox = (await api(manager, "GET", "/approvals/requests?scope=inbox")).json;
    assert.deepEqual(inbox.map((x: any) => x.id), [req.id]);
    assert.equal((await api(cashier, "GET", "/approvals/requests?scope=all")).json.length, 1); // el cajero solo ve lo suyo
  });

  it("alguien con permiso de decidir pero fuera del nivel no puede", async () => {
    const r = await decide(admin, req.id, "APPROVE");
    assert.deepEqual([r.status, r.json.code], [403, "NOT_APPROVER"]);
  });

  it("rechazar exige motivo", async () => {
    assert.equal((await decide(manager, req.id, "REJECT")).status, 400);
    assert.equal((await decide(manager, req.id, "REJECT", "ok")).status, 400);
  });

  it("al aprobar se ejecuta la anulación una sola vez, queda registrada y se avisa a quien pidió", async () => {
    const r = await decide(manager, req.id, "APPROVE", "Procede");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status, "EXECUTED");
    assert.deepEqual(r.json.decisions.map((d: any) => [d.step, d.decision, d.note, d.by]), [[1, "APPROVE", "Procede", "Multi"]]);
    assert.equal(await saleStatus(sale.id), "CANCELLED");
    assert.equal((await api(admin, "GET", `/sales/orders/${sale.id}`)).json.status, "CANCELLED");
    const n = await unread(cashier);
    assert.ok(n.items.some((i: any) => i.type === "APPROVAL_APPROVED" && i.refId === req.id));
    const again = await decide(manager, req.id, "APPROVE");
    assert.deepEqual([again.status, again.json.code], [409, "INVALID_STATE"]);
    assert.equal(await ten((tx) => tx.approvalDecision.count({ where: { requestId: req.id } })), 1);
    const audit = await ten((tx) => tx.auditLog.findMany({ where: { entityId: req.id }, select: { action: true } }));
    assert.deepEqual(audit.map((a: any) => a.action).sort(), ["approval.approved", "approval.executed", "approval.requested"]);
  });

  it("rechazada: no se anula la venta y se avisa con el motivo", async () => {
    const s = await newSale();
    const r = (await ask(cashier, s.id)).json;
    const d = await decide(manager, r.id, "REJECT", "La venta es correcta");
    assert.deepEqual([d.status, d.json.status], [200, "REJECTED"]);
    assert.equal(await saleStatus(s.id), "CONFIRMED");
    const n = await unread(cashier);
    assert.ok(n.items.some((i: any) => i.type === "APPROVAL_REJECTED" && i.body === "La venta es correcta"));
    // rechazada: se puede volver a pedir
    assert.equal((await ask(cashier, s.id)).status, 200);
  });

  it("quien pide no se aprueba a sí mismo; sí puede cancelar su solicitud y otros no", async () => {
    const s = await newSale();
    const r = (await ask(manager, s.id)).json;
    const self = await decide(manager, r.id, "APPROVE");
    assert.deepEqual([self.status, self.json.code], [403, "SELF_APPROVAL"]);
    assert.equal((await api(cashier, "POST", `/approvals/requests/${r.id}/cancel`)).status, 403);
    const c = await api(manager, "POST", `/approvals/requests/${r.id}/cancel`);
    assert.deepEqual([c.status, c.json.status], [200, "CANCELLED"]);
    assert.equal((await decide(manager, r.id, "APPROVE")).status, 409);
  });

  it("si la acción ya no se puede ejecutar queda aprobada con el motivo y no se pierde la decisión", async () => {
    const s = await newSale(3);
    const r = (await ask(cashier, s.id)).json;
    const pay = await api(admin, "POST", `/sales/orders/${s.id}/payments`, { method: "TRANSFER", amount: 5 });
    assert.equal(pay.status, 200, JSON.stringify(pay.json));
    const d = await decide(manager, r.id, "APPROVE");
    assert.equal(d.status, 200);
    assert.equal(d.json.status, "APPROVED");
    assert.match(d.json.executionError, /cobros registrados/);
    assert.equal(await saleStatus(s.id), "CONFIRMED");
    assert.equal((await api(manager, "POST", `/approvals/requests/${r.id}/retry`)).json.status, "APPROVED");
  });
});

describe("varios niveles y la regla vigente al pedir", () => {
  it("dos niveles: cada uno decide en su turno", async () => {
    const cfg = { forbidSelfApproval: true, steps: [{ name: "Jefe de tienda", roleIds: [roleManager], userIds: [] }, { name: "Dirección", roleIds: [roleAdmin], userIds: [] }] };
    assert.equal((await setFlow("SALE_VOID", true, cfg)).status, 200);
    const s = await newSale();
    const r = (await ask(cashier, s.id)).json;
    assert.deepEqual([r.totalSteps, r.stepName], [2, "Jefe de tienda"]);
    assert.equal((await decide(admin, r.id, "APPROVE")).json.code, "NOT_APPROVER"); // el nivel 2 aún no le toca
    const n1 = await decide(manager, r.id, "APPROVE");
    assert.deepEqual([n1.json.status, n1.json.currentStep, n1.json.stepName], ["PENDING", 2, "Dirección"]);
    assert.ok((await unread(admin)).items.some((i: any) => i.type === "APPROVAL_REQUESTED" && i.refId === r.id));
    assert.equal(await saleStatus(s.id), "CONFIRMED");
    assert.equal((await decide(manager, r.id, "APPROVE")).json.code, "NOT_APPROVER");
    const n2 = await decide(admin, r.id, "APPROVE");
    assert.deepEqual([n2.json.status, n2.json.decisions.length], ["EXECUTED", 2]);
    assert.equal(await saleStatus(s.id), "CANCELLED");
  });

  it("lo pedido sigue la regla vigente al solicitar aunque el flujo cambie después", async () => {
    assert.equal((await setFlow("SALE_VOID", true, oneStep())).status, 200);
    const s = await newSale();
    const r = (await ask(cashier, s.id)).json;
    assert.equal((await setFlow("SALE_VOID", true, { forbidSelfApproval: true, steps: [{ name: "Solo dirección", roleIds: [roleAdmin], userIds: [] }] })).status, 200);
    assert.equal((await decide(admin, r.id, "APPROVE")).json.code, "NOT_APPROVER");
    assert.equal((await decide(manager, r.id, "APPROVE")).json.status, "EXECUTED");
    await setFlow("SALE_VOID", true, oneStep());
  });

  it("con importe mínimo, lo pequeño no pide aprobación", async () => {
    assert.equal((await setFlow("SALE_VOID", true, { ...oneStep(), minAmount: 100 })).status, 200);
    const s = await newSale(2); // total 20
    assert.equal((await ask(cashier, s.id)).json.code, "NOT_REQUIRED");
    assert.equal((await api(admin, "POST", `/sales/orders/${s.id}/void`, { reason: "Error de digitación" })).status, 200);
    const big = await newSale(20); // total 200
    assert.equal((await api(admin, "POST", `/sales/orders/${big.id}/void`, { reason: "Intento" })).json.code, "APPROVAL_REQUIRED");
    assert.equal((await ask(cashier, big.id)).status, 200);
    await setFlow("SALE_VOID", true, oneStep());
  });

  it("un flujo desactivado vuelve a permitir la vía directa", async () => {
    assert.equal((await setFlow("SALE_VOID", false, oneStep())).status, 200);
    const s = await newSale();
    assert.equal((await api(admin, "POST", `/sales/orders/${s.id}/void`, { reason: "Error de digitación" })).status, 200);
    await setFlow("SALE_VOID", true, oneStep());
  });
});

describe("delegación", () => {
  it("quien recibe una delegación vigente decide en nombre del aprobador y queda constancia", async () => {
    const s = await newSale();
    const r = (await ask(cashier, s.id)).json;
    assert.equal((await api(admin, "GET", `/approvals/requests/${r.id}`)).json.canDecide, false);
    const dg = await api(manager, "POST", "/approvals/delegations", { delegateUserId: adminUser, eventType: "SALE_VOID", validFrom: day(-1), validTo: day(1) });
    assert.equal(dg.status, 200, JSON.stringify(dg.json));
    assert.deepEqual([dg.json.active, dg.json.delegate.name, dg.json.delegator.name], [true, "Admin A", "Multi"]);
    assert.ok((await unread(admin)).items.some((i: any) => i.type === "APPROVAL_DELEGATED"));
    assert.equal((await api(admin, "GET", `/approvals/requests/${r.id}`)).json.canDecide, true);
    const d = await decide(admin, r.id, "APPROVE", "Por delegación");
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.deepEqual(d.json.decisions.map((x: any) => [x.by, x.onBehalfOf]), [["Admin A", "Multi"]]);
    assert.equal(d.json.status, "EXECUTED");
  });

  it("revocada o vencida, la delegación ya no vale; ni se delega a uno mismo, ni a quien no puede decidir", async () => {
    const mk = async () => (await ask(cashier, (await newSale()).id)).json;
    const list = (await api(manager, "GET", "/approvals/delegations")).json;
    const first = list[0];
    assert.equal((await api(manager, "POST", `/approvals/delegations/${first.id}/revoke`)).json.revoked, true);
    let r = await mk();
    assert.equal((await decide(admin, r.id, "APPROVE")).json.code, "NOT_APPROVER");
    // vencida
    const old = await api(manager, "POST", "/approvals/delegations", { delegateUserId: adminUser, validFrom: day(-10), validTo: day(-5) });
    assert.equal(old.json.active, false);
    assert.equal((await api(admin, "GET", `/approvals/requests/${r.id}`)).json.canDecide, false);
    // de otro tipo de evento
    await api(manager, "POST", "/approvals/delegations", { delegateUserId: adminUser, eventType: "CASH_REOPEN", validFrom: day(-1), validTo: day(1) });
    assert.equal((await api(admin, "GET", `/approvals/requests/${r.id}`)).json.canDecide, false);
    // reglas del alta
    assert.equal((await api(manager, "POST", "/approvals/delegations", { delegateUserId: managerUser, validFrom: day(0), validTo: day(1) })).json.code, "SELF_DELEGATION");
    assert.equal((await api(manager, "POST", "/approvals/delegations", { delegateUserId: adminUser, validFrom: day(2), validTo: day(1) })).status, 400);
    // solo el delegante revoca lo suyo
    assert.equal((await api(cashier, "POST", `/approvals/delegations/${old.json.id}/revoke`)).status, 403);
    // candidatos: gente con permiso de decidir, sin uno mismo
    const cand = (await api(manager, "GET", "/approvals/delegate-candidates")).json;
    assert.deepEqual(cand.map((c: any) => c.id), [adminUser]);
    assert.equal((await api(cashier, "GET", "/approvals/delegate-candidates")).status, 403);
    // quien delegó no puede aprobar lo suyo vía su delegado
    const own = (await ask(manager, (await newSale()).id)).json;
    await api(manager, "POST", "/approvals/delegations", { delegateUserId: adminUser, validFrom: day(-1), validTo: day(1) });
    assert.equal((await decide(admin, own.id, "APPROVE")).json.code, "SELF_APPROVAL");
    r = await mk();
    assert.ok(r.id);
  });
});

describe("escalamiento", () => {
  it("vencido el plazo, también pueden decidir los del escalamiento", async () => {
    for (const d of (await api(manager, "GET", "/approvals/delegations")).json) await api(manager, "POST", `/approvals/delegations/${d.id}/revoke`); // que no decida por delegación
    const cfg = { forbidSelfApproval: true, steps: [{ name: "Gerencia", roleIds: [roleManager], userIds: [], dueHours: 2, escalateTo: { roleIds: [], userIds: [adminUser] } }] };
    assert.equal((await setFlow("SALE_VOID", true, cfg)).status, 200);
    const s = await newSale();
    const r = (await ask(cashier, s.id)).json;
    assert.notEqual(r.dueAt, null);
    assert.equal((await decide(admin, r.id, "APPROVE")).json.code, "NOT_APPROVER");
    clock.set(new Date(Date.now() + 3 * 3_600_000));
    const after = (await api(admin, "GET", `/approvals/requests/${r.id}`)).json;
    assert.deepEqual([after.escalated, after.canDecide], [true, true]);
    assert.ok((await unread(admin)).items.some((i: any) => i.type === "APPROVAL_ESCALATED" && i.refId === r.id));
    assert.equal(await ten((tx) => tx.approvalEscalation.count({ where: { requestId: r.id } })), 1);
    // no se escala dos veces
    await api(admin, "GET", "/approvals/requests");
    assert.equal(await ten((tx) => tx.approvalEscalation.count({ where: { requestId: r.id } })), 1);
    const d = await decide(admin, r.id, "APPROVE");
    assert.deepEqual([d.status, d.json.status], [200, "EXECUTED"]);
    await setFlow("SALE_VOID", true, oneStep());
  });
});

describe("avisos y aislamiento", () => {
  it("cada usuario ve y marca solo sus avisos", async () => {
    const mine = await unread(manager);
    assert.ok(mine.unread > 0);
    const first = mine.items[0];
    const one = await api(manager, "POST", `/notifications/${first.id}/read`);
    assert.equal(one.json.marked, 1);
    assert.equal((await unread(manager)).unread, mine.unread - 1);
    // un aviso ajeno no se puede marcar
    const other = (await unread(cashier)).items[0];
    assert.equal((await api(manager, "POST", `/notifications/${other.id}/read`)).json.marked, 0);
    assert.equal((await api(manager, "POST", "/notifications/read")).json.marked, mine.unread - 1);
    assert.equal((await unread(manager)).unread, 0);
    assert.equal((await api(manager, "GET", "/notifications?unread=true")).json.items.length, 0);
    assert.equal((await unread(adminB)).items.length, 0);
  });

  it("otra empresa no ve flujos, solicitudes ni delegaciones", async () => {
    const wf = (await api(adminB, "GET", "/approvals/workflows")).json;
    assert.ok(wf.every((w: any) => !w.enabled));
    assert.equal((await api(adminB, "GET", "/approvals/requests?scope=all")).json.length, 0);
    assert.equal((await api(adminB, "GET", "/approvals/delegations")).json.length, 0);
  });

  it("la historia es inmutable: decisiones, versiones y escalamientos no se editan ni borran; los avisos solo cambian la lectura", async () => {
    const app = createDb(process.env.DATABASE_URL);
    try {
      for (const sql of [
        `UPDATE approval_decision SET note = 'x'`, `DELETE FROM approval_decision`,
        `UPDATE approval_workflow_version SET version = 99`, `DELETE FROM approval_workflow_version`,
        `DELETE FROM approval_escalation`, `DELETE FROM approval_request`, `DELETE FROM approval_workflow`,
        `UPDATE notification SET title = 'x'`, `DELETE FROM notification`,
      ]) {
        await assert.rejects(withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(sql)), /permission denied|denegado/i, sql);
      }
      await withTenant(app, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE notification SET read_at = now()`));
    } finally {
      await app.$disconnect();
    }
    // una solicitud resuelta debe tener fecha de resolución
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.$executeRawUnsafe(`UPDATE approval_request SET resolved_at = NULL WHERE status = 'EXECUTED'`)), /check|restricci/i);
  });

  it("el administrador y el gerente ven las solicitudes de todos; el cajero solo ve su menú de aprobaciones", async () => {
    assert.ok((await api(manager, "GET", "/approvals/requests?scope=all")).json.length > 3);
    assert.equal((await api(cashier, "GET", "/approvals/workflows")).status, 200);
    assert.equal((await api(cashier, "POST", "/approvals/requests/00000000-0000-4000-8000-000000000009/decide", { decision: "APPROVE" })).status, 403);
    void cashierUser;
  });
});
