import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { APP_URL } from "../src/config";
import { makeClient, runTenantJob, withTenant } from "../src/tenant-context";
import { uuidv7 } from "../src/uuid7";
import { app, closeAll, seedWorld, type World } from "./helpers";

let w: World;

before(async () => {
  w = await seedWorld();
});
after(closeAll);

describe("catálogo y rol de aplicación", () => {
  it("el rol de aplicación no es superusuario ni tiene BYPASSRLS", async () => {
    const rows = await app.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    assert.equal(rows[0]?.rolsuper, false);
    assert.equal(rows[0]?.rolbypassrls, false);
  });

  it("toda tabla con tenant_id: NOT NULL, RLS forzado, política y trigger de inmutabilidad", async () => {
    const tables = await app.$queryRaw<
      { table_name: string; is_nullable: string; rls: boolean; forced: boolean; policies: bigint; triggers: bigint }[]
    >`
      SELECT c.table_name, c.is_nullable,
             cl.relrowsecurity AS rls, cl.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.table_name) AS policies,
             (SELECT count(*) FROM pg_trigger t
                WHERE t.tgrelid = cl.oid AND t.tgname LIKE '%_tenant_immutable') AS triggers
      FROM information_schema.columns c
      JOIN pg_class cl ON cl.relname = c.table_name AND cl.relnamespace = 'public'::regnamespace
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'`;
    assert.ok(tables.length >= 5, "se esperaban al menos 5 tablas tenant-scoped");
    for (const t of tables) {
      assert.equal(t.is_nullable, "NO", `${t.table_name}.tenant_id debe ser NOT NULL`);
      assert.ok(t.rls && t.forced, `${t.table_name} sin RLS forzado`);
      assert.ok(Number(t.policies) >= 1, `${t.table_name} sin política`);
      assert.ok(Number(t.triggers) >= 1, `${t.table_name} sin trigger de inmutabilidad`);
    }
  });
});

describe("aislamiento de lectura y escritura", () => {
  it("sin contexto no se ve ninguna fila (Prisma y SQL directo)", async () => {
    assert.deepEqual(await app.branch.findMany(), []);
    const r = await app.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM branch`;
    assert.equal(Number(r[0]?.n), 0);
  });

  it("cada tenant ve solo sus filas", async () => {
    const a = await withTenant(app, w.tenantA, (tx) => tx.branch.findMany());
    const b = await withTenant(app, w.tenantB, (tx) => tx.branch.findMany());
    assert.equal(a.length, 2);
    assert.ok(a.every((x) => x.tenantId === w.tenantA));
    assert.equal(b.length, 1);
    assert.ok(b.every((x) => x.tenantId === w.tenantB));
  });

  it("SQL directo con contexto también queda filtrado", async () => {
    const n = await withTenant(app, w.tenantA, async (tx) => {
      const r = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM branch`;
      return Number(r[0]?.n);
    });
    assert.equal(n, 2);
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
    assert.equal(upd.count, 0);
    assert.equal(del.count, 0);
    const still = await withTenant(app, w.tenantB, (tx) => tx.branch.findUnique({ where: { id: w.b.branch1 } }));
    assert.equal(still?.name, "Sucursal 1");
  });

  it("tenant_id es inmutable incluso sobre filas propias", async () => {
    await assert.rejects(
      withTenant(app, w.tenantA, (tx) =>
        tx.branch.updateMany({ where: { id: w.a.branch1 }, data: { tenantId: w.tenantB } }),
      ),
      /inmutable/,
    );
  });
});

describe("FKs compuestas", () => {
  const sale = (tenantId: string, over: Record<string, unknown>) => ({
    id: uuidv7(),
    tenantId,
    number: `V-${uuidv7().slice(-8)}`,
    total: "100.0000",
    ...over,
  });

  it("venta válida (misma sucursal, almacén de esa sucursal, cliente propio)", async () => {
    const s = await withTenant(app, w.tenantA, (tx) =>
      tx.sale.create({
        data: sale(w.tenantA, { branchId: w.a.branch1, warehouseId: w.a.warehouse1, customerId: w.a.customer }) as never,
      }),
    );
    assert.equal(s.tenantId, w.tenantA);
  });

  it("cliente NULL es válido en la FK compuesta nullable", async () => {
    const s = await withTenant(app, w.tenantA, (tx) =>
      tx.sale.create({
        data: sale(w.tenantA, { branchId: w.a.branch1, warehouseId: w.a.warehouse1, customerId: null }) as never,
      }),
    );
    assert.equal(s.customerId, null);
  });

  it("rechaza cliente de OTRO tenant", async () => {
    await assert.rejects(
      withTenant(app, w.tenantA, (tx) =>
        tx.sale.create({
          data: sale(w.tenantA, { branchId: w.a.branch1, warehouseId: w.a.warehouse1, customerId: w.b.customer }) as never,
        }),
      ),
      (e: { code?: string }) => e.code === "P2003",
    );
  });

  it("rechaza sucursal de OTRO tenant", async () => {
    await assert.rejects(
      withTenant(app, w.tenantA, (tx) =>
        tx.sale.create({
          data: sale(w.tenantA, { branchId: w.b.branch1, warehouseId: w.a.warehouse1 }) as never,
        }),
      ),
      (e: { code?: string }) => e.code === "P2003",
    );
  });

  it("rechaza almacén que no pertenece a la sucursal indicada (mismo tenant)", async () => {
    await assert.rejects(
      withTenant(app, w.tenantA, (tx) =>
        tx.sale.create({
          data: sale(w.tenantA, { branchId: w.a.branch1, warehouseId: w.a.warehouse2 }) as never,
        }),
      ),
      (e: { code?: string }) => e.code === "P2003",
    );
  });

  it("no se puede borrar un cliente con ventas (Restrict, no SET NULL sobre tenant_id)", async () => {
    await assert.rejects(
      withTenant(app, w.tenantA, (tx) => tx.customer.delete({ where: { id: w.a.customer } })),
      (e: { code?: string }) => e.code === "P2003",
    );
  });
});

describe("pool de conexiones y concurrencia", () => {
  it("con UNA sola conexión el contexto no se filtra entre requests", async () => {
    const single = makeClient(`${APP_URL}${APP_URL.includes("?") ? "&" : "?"}connection_limit=1`);
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
    const pooled = makeClient(`${APP_URL}${APP_URL.includes("?") ? "&" : "?"}connection_limit=5`);
    try {
      const results = await Promise.all(
        Array.from({ length: 150 }, async (_, i) => {
          const tenant = i % 2 ? w.tenantA : w.tenantB;
          const rows = await withTenant(pooled, tenant, (tx) => tx.branch.findMany());
          return rows.length > 0 && rows.every((r) => r.tenantId === tenant);
        }),
      );
      assert.ok(results.every(Boolean));
    } finally {
      await pooled.$disconnect();
    }
  });
});

describe("auditoría append-only", () => {
  it("permite INSERT pero no UPDATE ni DELETE al rol de aplicación", async () => {
    const id = uuidv7();
    await withTenant(app, w.tenantA, (tx) =>
      tx.auditLog.create({
        data: { id, tenantId: w.tenantA, action: "TEST", entityType: "branch", entityId: w.a.branch1 },
      }),
    );
    await assert.rejects(
      withTenant(app, w.tenantA, (tx) => tx.auditLog.updateMany({ where: { id }, data: { action: "X" } })),
    );
    await assert.rejects(withTenant(app, w.tenantA, (tx) => tx.auditLog.deleteMany({ where: { id } })));
  });
});

describe("contexto en jobs/workers", () => {
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
