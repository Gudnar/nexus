import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDb, runTenantJob, uuidv7, withTenant, withUserContext } from "../src";
import { app, closeAll, rejectsWithCode, seedWorld, type World } from "./helpers";

let w: World;
before(async () => {
  w = await seedWorld();
});
after(closeAll);

describe("aislamiento entre tenants (hito §30, puntos 5-7)", () => {
  it("sin contexto no se ve ninguna fila de ninguna tabla tenant-scoped", async () => {
    assert.deepEqual(await app.branch.findMany(), []);
    assert.deepEqual(await app.membership.findMany(), []);
    assert.deepEqual(await app.role.findMany(), []);
    assert.deepEqual(await app.rolePermission.findMany(), []);
    assert.deepEqual(await app.auditLog.findMany(), []);
    assert.deepEqual(await app.outboxEvent.findMany(), []);
    assert.deepEqual(await app.sequence.findMany(), []);
  });

  it("cada tenant ve solo sus filas en todas las tablas", async () => {
    for (const [tenant, branches] of [[w.tenantA, 3], [w.tenantB, 1]] as const) {
      const r = await withTenant(app, tenant, async (tx) => ({
        branch: await tx.branch.findMany(),
        membership: await tx.membership.findMany(),
        role: await tx.role.findMany(),
        rolePerm: await tx.rolePermission.findMany(),
        audit: await tx.auditLog.findMany(),
        outbox: await tx.outboxEvent.findMany(),
        seq: await tx.sequence.findMany(),
      }));
      assert.equal(r.branch.length, branches);
      for (const rows of Object.values(r)) {
        assert.ok(rows.length > 0 && rows.every((x) => x.tenantId === tenant));
      }
    }
  });

  it("no se puede insertar con tenant_id ajeno (WITH CHECK)", async () => {
    await assert.rejects(
      withTenant(app, w.tenantA, (tx) =>
        tx.branch.create({ data: { id: uuidv7(), tenantId: w.tenantB, code: "X", name: "Intruso" } }),
      ),
    );
  });

  it("UPDATE y DELETE sobre filas de otro tenant afectan 0 filas", async () => {
    const upd = await withTenant(app, w.tenantA, (tx) =>
      tx.branch.updateMany({ where: { id: w.b.branch1 }, data: { name: "hackeado" } }),
    );
    const del = await withTenant(app, w.tenantA, (tx) => tx.branch.deleteMany({ where: { id: w.b.branch1 } }));
    assert.equal(upd.count + del.count, 0);
    const still = await withTenant(app, w.tenantB, (tx) => tx.branch.findUnique({ where: { id: w.b.branch1 } }));
    assert.equal(still?.name, "Central B");
  });

  it("tenant_id es inmutable incluso sobre filas propias", async () => {
    await assert.rejects(
      withTenant(app, w.tenantA, (tx) =>
        tx.branch.updateMany({ where: { id: w.a.branch1 }, data: { tenantId: w.tenantB } }),
      ),
      /inmutable/,
    );
  });

  it("SQL directo con el rol de aplicación también queda filtrado", async () => {
    const none = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM branch`;
    assert.equal(Number(none[0]?.n), 0);
    const n = await withTenant(app, w.tenantA, async (tx) => {
      const r = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM branch`;
      return Number(r[0]?.n);
    });
    assert.equal(n, 3);
  });
});

describe("FKs compuestas: no se pueden cruzar tenants", () => {
  it("membresía con sucursal por defecto de otro tenant", async () => {
    await rejectsWithCode(
      withTenant(app, w.tenantA, (tx) =>
        tx.membership.create({
          data: { id: uuidv7(), tenantId: w.tenantA, userId: w.users.adminB, defaultBranchId: w.b.branch1 },
        }),
      ),
      "P2003",
    );
  });

  it("acceso a sucursal de otro tenant", async () => {
    await rejectsWithCode(
      withTenant(app, w.tenantA, (tx) =>
        tx.userBranchAccess.create({
          data: { tenantId: w.tenantA, membershipId: w.memberships.single, branchId: w.b.branch1 },
        }),
      ),
      "P2003",
    );
  });

  it("rol de un tenant asignado a una membresía de otro", async () => {
    const roleB = await withTenant(app, w.tenantB, (tx) => tx.role.findFirstOrThrow({ where: { code: "seller" } }));
    await rejectsWithCode(
      withTenant(app, w.tenantA, (tx) =>
        tx.userRole.create({ data: { tenantId: w.tenantA, membershipId: w.memberships.single, roleId: roleB.id } }),
      ),
      "P2003",
    );
  });

  it("evento de outbox con sucursal de otro tenant", async () => {
    await rejectsWithCode(
      withTenant(app, w.tenantA, (tx) =>
        tx.outboxEvent.create({
          data: {
            id: uuidv7(), tenantId: w.tenantA, branchId: w.b.branch1, eventType: "X", aggregateType: "x",
            aggregateId: "1", payload: {}, idempotencyKey: uuidv7(),
          },
        }),
      ),
      "P2003",
    );
  });

  it("no se puede borrar una sucursal con membresías que la usan por defecto (Restrict)", async () => {
    await rejectsWithCode(withTenant(app, w.tenantA, (tx) => tx.branch.delete({ where: { id: w.a.branch1 } })), "P2003");
  });
});

describe("contexto de usuario para el login (sin tenant)", () => {
  it("un usuario multi-tenant lee solo SUS membresías de ambos tenants", async () => {
    const rows = await withUserContext(app, w.users.multi, (tx) => tx.membership.findMany());
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((r) => r.tenantId)), new Set([w.tenantA, w.tenantB]));
    assert.ok(rows.every((r) => r.userId === w.users.multi));
  });

  it("no ve membresías de otros usuarios ni tablas de negocio", async () => {
    const mine = await withUserContext(app, w.users.single, async (tx) => ({
      memberships: await tx.membership.findMany(),
      branches: await tx.branch.findMany(),
    }));
    assert.equal(mine.memberships.length, 1);
    assert.equal(mine.branches.length, 0);
  });

  it("el contexto de usuario es de solo lectura", async () => {
    const r = await withUserContext(app, w.users.single, (tx) =>
      tx.membership.updateMany({ where: { userId: w.users.single }, data: { allBranches: true } }),
    );
    assert.equal(r.count, 0);
  });
});

describe("pool de conexiones y concurrencia", () => {
  const base = process.env.DATABASE_URL!;
  const sep = base.includes("?") ? "&" : "?";

  it("con UNA sola conexión el contexto no se filtra entre requests", async () => {
    const single = createDb(`${base}${sep}connection_limit=1`);
    try {
      for (let i = 0; i < 30; i++) {
        const tenant = i % 2 ? w.tenantA : w.tenantB;
        const inside = await withTenant(single, tenant, (tx) => tx.branch.findMany());
        assert.ok(inside.length > 0 && inside.every((r) => r.tenantId === tenant));
        assert.deepEqual(await single.branch.findMany(), [], "contexto filtrado a la siguiente consulta");
      }
    } finally {
      await single.$disconnect();
    }
  });

  it("150 requests concurrentes de dos tenants nunca ven filas ajenas", async () => {
    const pooled = createDb(`${base}${sep}connection_limit=5`);
    try {
      const ok = await Promise.all(
        Array.from({ length: 150 }, async (_, i) => {
          const tenant = i % 2 ? w.tenantA : w.tenantB;
          const rows = await withTenant(pooled, tenant, (tx) => tx.branch.findMany());
          return rows.length > 0 && rows.every((r) => r.tenantId === tenant);
        }),
      );
      assert.ok(ok.every(Boolean));
    } finally {
      await pooled.$disconnect();
    }
  });
});

describe("contexto en jobs/workers (hito §30, punto 9)", () => {
  it("el job con tenantId opera solo en su tenant", async () => {
    const n = await runTenantJob(app, { tenantId: w.tenantB }, async (tx) => (await tx.branch.findMany()).length);
    assert.equal(n, 1);
  });
  it("un job sin tenantId no se ejecuta", async () => {
    await assert.rejects(runTenantJob(app, {}, async () => 1), /sin tenantId/);
  });
  it("un tenantId inválido se rechaza antes de tocar la base", async () => {
    await assert.rejects(withTenant(app, "no-es-uuid", async () => 1), /inválido/);
  });
});
