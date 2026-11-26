import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createDb, enqueueEvent, uuidv7, withTenant, writeAudit } from "@erp/db";
import { AppConfig } from "../src/config";
import { OutboxDispatcher, OutboxHandlers, type OutboxEvent } from "../src/outbox/outbox-dispatcher";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

if (!process.env.WORKER_DATABASE_URL) throw new Error("Define WORKER_DATABASE_URL (erp_worker) para las pruebas del outbox");
const workerDb = createDb(process.env.WORKER_DATABASE_URL);
const appDb = createDb(process.env.DATABASE_URL);

let dispatcher: OutboxDispatcher;
let handlers: OutboxHandlers;

before(async () => {
  await setup();
  dispatcher = world.app.get(OutboxDispatcher);
  handlers = world.app.get(OutboxHandlers);
});
after(async () => {
  await workerDb.$disconnect();
  await appDb.$disconnect();
  await teardown();
});
beforeEach(() => handlers.clear());

const emit = (tenantId: string, eventType: string, extra: Partial<{ aggregateId: string; payload: Record<string, unknown> }> = {}) =>
  withTenant(appDb, tenantId, (tx) =>
    enqueueEvent(tx, tenantId, {
      eventType, aggregateType: "thing", aggregateId: extra.aggregateId ?? uuidv7(), payload: extra.payload ?? {}, idempotencyKey: uuidv7(),
    }),
  );
const status = () => workerDb.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }).then((r) => Object.fromEntries(r.map((x) => [x.status, x._count._all])));
const makeDue = () => workerDb.$executeRaw`UPDATE outbox_event SET available_at = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE status = 'FAILED'`;
const drain = async (d = dispatcher) => {
  for (let i = 0; i < 20; i++) if ((await d.runOnce(50)).claimed === 0) return;
};

describe("despacho básico", () => {
  it("los eventos pendientes se procesan una sola vez; sin consumidores no se quedan en cola", async () => {
    const before = await status();
    assert.ok((before["PENDING"] ?? 0) >= 2, "el alta de las empresas dejó eventos pendientes");
    const r = await dispatcher.runOnce(50);
    assert.equal(r.processed, before["PENDING"]);
    assert.deepEqual(await status(), { PROCESSED: before["PENDING"] });
    assert.equal((await dispatcher.runOnce(50)).claimed, 0);
  });

  it("el consumidor trabaja con el contexto del tenant del evento (nunca ve otro)", async () => {
    const seen: { event: string; tenant: string; branches: string[] }[] = [];
    handlers.on("Probe", async (e, { tx }) => {
      const rows = await tx.branch.findMany({ select: { tenantId: true } });
      seen.push({ event: e.id, tenant: e.tenantId, branches: [...new Set(rows.map((r) => r.tenantId))] });
    });
    await emit(world.tenantA, "Probe");
    await emit(world.tenantB, "Probe");
    await drain();
    assert.equal(seen.length, 2);
    for (const s of seen) assert.deepEqual(s.branches, [s.tenant]);
    assert.equal(new Set(seen.map((s) => s.tenant)).size, 2);
  });

  it("recibe los datos completos del evento", async () => {
    let got: OutboxEvent | undefined;
    handlers.on("Full", async (e) => { got = e; });
    const agg = uuidv7();
    await emit(world.tenantA, "Full", { aggregateId: agg, payload: { total: "10.0000" } });
    await drain();
    assert.equal(got?.aggregateType, "thing");
    assert.equal(got?.aggregateId, agg);
    assert.deepEqual(got?.payload, { total: "10.0000" });
    assert.equal(got?.attempts, 0);
  });

  it("después de despachar, el panel muestra 0 pendientes", async () => {
    await drain();
    const d = await call("GET", "/api/v1/dashboard", { token: await tokenFor("admin.a@test.local") });
    assert.equal(d.json.system.outbox.pending, 0);
  });
});

describe("fallos, reintentos y eventos muertos", () => {
  it("un fallo reintenta con espera creciente y termina en DEAD tras agotar los intentos", async () => {
    let calls = 0;
    handlers.on("Flaky", async () => { calls++; throw new Error("proveedor caído"); });
    await emit(world.tenantA, "Flaky");

    assert.equal((await dispatcher.runOnce()).failed, 1);
    let e = await workerDb.outboxEvent.findFirstOrThrow({ where: { eventType: "Flaky" } });
    assert.equal(e.status, "FAILED");
    assert.equal(e.attempts, 1);
    assert.equal(e.lastError, "proveedor caído");
    assert.ok(e.availableAt.getTime() > Date.now() + 5_000, "queda en espera (backoff)");
    assert.equal((await dispatcher.runOnce()).claimed, 0, "aún no es su hora");

    await makeDue();
    assert.equal((await dispatcher.runOnce()).failed, 1);
    await makeDue();
    const last = await dispatcher.runOnce();
    assert.equal(last.dead, 1);
    e = await workerDb.outboxEvent.findFirstOrThrow({ where: { eventType: "Flaky" } });
    assert.equal(e.status, "DEAD");
    assert.equal(e.attempts, 3);
    assert.equal(calls, 3);
    await makeDue();
    assert.equal((await dispatcher.runOnce()).claimed, 0, "un evento muerto no se reintenta solo");
  });

  it("si el consumidor falla, su trabajo se revierte (sin efectos a medias)", async () => {
    handlers.on("Atomic", async (e, { tx }) => {
      await writeAudit(tx, e.tenantId, { action: "efecto.secundario", entityType: "x" });
      throw new Error("falló después de escribir");
    });
    await emit(world.tenantA, "Atomic");
    await dispatcher.runOnce();
    const n = await withTenant(owner, world.tenantA, (tx) => tx.auditLog.count({ where: { action: "efecto.secundario" } }));
    assert.equal(n, 0);
  });

  it("el consumidor que falla no impide procesar los demás eventos del lote", async () => {
    const done: string[] = [];
    handlers.on("Bad", async () => { throw new Error("x"); });
    handlers.on("Good", async (e) => { done.push(e.id); });
    await emit(world.tenantA, "Bad");
    await emit(world.tenantA, "Good");
    await emit(world.tenantB, "Good");
    const r = await dispatcher.runOnce(50);
    assert.equal(r.failed, 1);
    assert.equal(done.length, 2);
  });
});

describe("orden por agregado y concurrencia", () => {
  it("un evento no se entrega mientras haya uno anterior pendiente del mismo agregado", async () => {
    const order: number[] = [];
    handlers.on("Ordered", async (e) => {
      const n = Number(e.payload["n"]);
      if (n === 1 && order.filter((x) => x === 1).length < 99) { order.push(-1); throw new Error("el primero falla"); }
      order.push(n);
    });
    const agg = uuidv7();
    await emit(world.tenantA, "Ordered", { aggregateId: agg, payload: { n: 1 } });
    await new Promise((r) => setTimeout(r, 15));
    await emit(world.tenantA, "Ordered", { aggregateId: agg, payload: { n: 2 } });

    await dispatcher.runOnce();
    assert.deepEqual(order, [-1], "solo se intentó el primero; el segundo espera");
    await makeDue(); await dispatcher.runOnce();
    await makeDue(); await dispatcher.runOnce(); // 3.er intento: DEAD, desbloquea al siguiente
    await dispatcher.runOnce();
    assert.deepEqual(order, [-1, -1, -1, 2]);
  });

  it("agregados distintos no se bloquean entre sí", async () => {
    const got: string[] = [];
    handlers.on("Indep", async (e) => {
      if (e.payload["fail"]) throw new Error("x");
      got.push(String(e.payload["name"]));
    });
    await emit(world.tenantA, "Indep", { payload: { fail: true, name: "a" } });
    await emit(world.tenantA, "Indep", { payload: { name: "b" } });
    await dispatcher.runOnce();
    assert.deepEqual(got, ["b"]);
    await makeDue(); await dispatcher.runOnce(); await makeDue(); await dispatcher.runOnce();
  });

  it("varios workers en paralelo procesan cada evento exactamente una vez", async () => {
    const seen = new Map<string, number>();
    handlers.on("Race", async (e) => { seen.set(e.id, (seen.get(e.id) ?? 0) + 1); });
    for (let i = 0; i < 40; i++) await emit(i % 2 ? world.tenantA : world.tenantB, "Race");

    const mk = () => new OutboxDispatcher(createDb(process.env.WORKER_DATABASE_URL), appDb, new AppConfig(), handlers);
    const workers = [mk(), mk(), mk()];
    for (let round = 0; round < 10; round++) {
      const rs = await Promise.all(workers.map((w) => w.runOnce(7)));
      if (rs.every((r) => r.claimed === 0)) break;
    }
    assert.equal(seen.size, 40);
    assert.ok([...seen.values()].every((n) => n === 1), "ningún evento se entregó dos veces");
    assert.equal((await status())["PENDING"] ?? 0, 0);
  });
});

describe("privilegios del rol de worker", () => {
  it("lee el outbox de todos los tenants, pero no puede tocar ninguna otra tabla", async () => {
    await emit(world.tenantA, "Priv");
    await emit(world.tenantB, "Priv");
    const tenants = new Set((await workerDb.outboxEvent.findMany({ where: { eventType: "Priv" } })).map((e) => e.tenantId));
    assert.deepEqual(tenants, new Set([world.tenantA, world.tenantB]));
    await assert.rejects(workerDb.branch.findMany());
    await assert.rejects(workerDb.user.findMany());
    await assert.rejects(workerDb.auditLog.findMany());
  });

  it("no puede crear ni borrar eventos, solo marcarlos", async () => {
    await assert.rejects(workerDb.outboxEvent.deleteMany({}));
    await assert.rejects(
      workerDb.outboxEvent.create({
        data: { id: uuidv7(), tenantId: world.tenantA, eventType: "x", aggregateType: "x", aggregateId: "1", payload: {}, idempotencyKey: uuidv7() },
      }),
    );
  });

  it("la aplicación (erp_app) sigue sin ver eventos de otros tenants", async () => {
    const rows = await withTenant(appDb, world.tenantA, (tx) => tx.outboxEvent.findMany());
    assert.ok(rows.length > 0 && rows.every((r) => r.tenantId === world.tenantA));
  });
});
