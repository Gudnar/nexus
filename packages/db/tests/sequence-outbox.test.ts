import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { enqueueEvent, nextSequenceNumber, uuidv7, writeAudit, withTenant } from "../src";
import { app, closeAll, rejectsWithCode, seedWorld, type World } from "./helpers";

let w: World;
before(async () => {
  w = await seedWorld();
});
after(closeAll);

describe("secuencias sin huecos (ADR-006)", () => {
  it("el primer número formateado es V-000001", async () => {
    const r = await withTenant(app, w.tenantA, (tx) => nextSequenceNumber(tx, "SALE"));
    assert.equal(r.formatted, "V-000001");
  });

  it("30 confirmaciones concurrentes obtienen números únicos y consecutivos", async () => {
    const nums = await Promise.all(
      Array.from({ length: 30 }, () => withTenant(app, w.tenantA, (tx) => nextSequenceNumber(tx, "SALE"))),
    );
    const values = nums.map((n) => Number(n.value)).sort((a, b) => a - b);
    assert.deepEqual(values, Array.from({ length: 30 }, (_, i) => i + 2)); // el 1 se usó arriba
  });

  it("si la transacción revierte, el número no se consume", async () => {
    const before = await withTenant(app, w.tenantA, (tx) => nextSequenceNumber(tx, "SALE"));
    await assert.rejects(
      withTenant(app, w.tenantA, async (tx) => {
        await nextSequenceNumber(tx, "SALE");
        throw new Error("falla de negocio");
      }),
      /falla de negocio/,
    );
    const after = await withTenant(app, w.tenantA, (tx) => nextSequenceNumber(tx, "SALE"));
    assert.equal(after.value, before.value + 1n);
  });

  it("las secuencias de un tenant no afectan a otro y una secuencia por sucursal es independiente", async () => {
    await assert.rejects(withTenant(app, w.tenantB, (tx) => nextSequenceNumber(tx, "QUOTE")), /no configurada/);
    await withTenant(app, w.tenantA, (tx) =>
      tx.sequence.create({
        data: { id: uuidv7(), tenantId: w.tenantA, branchId: w.a.branch2, documentType: "SALE", prefix: "N-", padding: 4 },
      }),
    );
    const r = await withTenant(app, w.tenantA, (tx) => nextSequenceNumber(tx, "SALE", w.a.branch2));
    assert.equal(r.formatted, "N-0001");
  });

  it("no se permiten dos secuencias iguales (tenant sin sucursal)", async () => {
    await rejectsWithCode(
      withTenant(app, w.tenantA, (tx) =>
        tx.sequence.create({ data: { id: uuidv7(), tenantId: w.tenantA, branchId: null, documentType: "SALE" } }),
      ),
      "P2002",
    );
  });
});

describe("outbox transaccional (ADR-006)", () => {
  const ev = (key: string) => ({
    eventType: "SaleConfirmed",
    aggregateType: "sale",
    aggregateId: "s-1",
    payload: { total: "10.0000" },
    idempotencyKey: key,
  });
  const count = (tenant: string, type: string) =>
    withTenant(app, tenant, (tx) => tx.outboxEvent.count({ where: { eventType: type } }));

  it("el evento se confirma junto con la transacción de negocio", async () => {
    await withTenant(app, w.tenantA, async (tx) => {
      await enqueueEvent(tx, w.tenantA, ev("k-commit"));
    });
    assert.equal(await count(w.tenantA, "SaleConfirmed"), 1);
  });

  it("si la transacción revierte, no queda evento", async () => {
    await assert.rejects(
      withTenant(app, w.tenantA, async (tx) => {
        await enqueueEvent(tx, w.tenantA, ev("k-rollback"));
        throw new Error("boom");
      }),
    );
    assert.equal(await count(w.tenantA, "SaleConfirmed"), 1);
  });

  it("la misma clave de idempotencia no duplica el evento", async () => {
    const second = await withTenant(app, w.tenantA, (tx) => enqueueEvent(tx, w.tenantA, ev("k-commit")));
    assert.equal(second, false);
    assert.equal(await count(w.tenantA, "SaleConfirmed"), 1);
  });

  it("la misma clave en otro tenant es un evento distinto", async () => {
    assert.equal(await withTenant(app, w.tenantB, (tx) => enqueueEvent(tx, w.tenantB, ev("k-commit"))), true);
    assert.equal(await count(w.tenantB, "SaleConfirmed"), 1);
  });
});

describe("idempotencia y auditoría", () => {
  it("una clave de idempotencia por tenant y operación es única", async () => {
    const mk = () =>
      withTenant(app, w.tenantA, (tx) =>
        tx.idempotencyRecord.create({
          data: { id: uuidv7(), tenantId: w.tenantA, key: "K1", operation: "sale.confirm", expiresAt: new Date(Date.now() + 3600_000) },
        }),
      );
    await mk();
    await rejectsWithCode(mk(), "P2002");
  });

  it("writeAudit registra con tenant, actor y correlación", async () => {
    await withTenant(app, w.tenantA, (tx) =>
      writeAudit(tx, w.tenantA, {
        action: "branch.updated", entityType: "branch", entityId: w.a.branch1,
        branchId: w.a.branch1, actorUserId: w.users.adminA, correlationId: "corr-1",
        before: { name: "a" }, after: { name: "b" },
      }),
    );
    const rows = await withTenant(app, w.tenantA, (tx) => tx.auditLog.findMany({ where: { correlationId: "corr-1" } }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.actorUserId, w.users.adminA);
  });
});

describe("alta de tenant (provisionTenant)", () => {
  it("crea roles plantilla, permisos, administrador general, auditoría y evento", async () => {
    const r = await withTenant(app, w.tenantA, async (tx) => ({
      roles: await tx.role.count({ where: { isSystemTemplate: true } }),
      adminPerms: await tx.rolePermission.count({ where: { role: { code: "admin" } } }),
      audit: await tx.auditLog.count({ where: { action: "tenant.provisioned" } }),
      event: await tx.outboxEvent.count({ where: { eventType: "TenantProvisioned" } }),
      adminAll: (await tx.membership.findUniqueOrThrow({ where: { id: w.memberships.adminA } })).allBranches,
    }));
    assert.equal(r.roles, 5);
    assert.ok(r.adminPerms >= 25);
    assert.equal(r.audit, 1);
    assert.equal(r.event, 1);
    assert.equal(r.adminAll, true);
  });
});
