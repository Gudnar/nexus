import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { app, closeAll, rejectsWithCode, seedWorld, type World } from "./helpers";
import { uuidv7, withTenant } from "../src";

/** Tablas con columna tenant_id que NO llevan RLS por diseño (documentado). */
const NO_RLS_ALLOWLIST = new Set(["session"]);

let w: World;
before(async () => {
  w = await seedWorld();
});
after(closeAll);

describe("catálogo y rol de aplicación", () => {
  it("el rol de aplicación no es superusuario ni tiene BYPASSRLS", async () => {
    const r = await app.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    assert.equal(r[0]?.rolsuper, false);
    assert.equal(r[0]?.rolbypassrls, false);
  });

  it("toda tabla con tenant_id: NOT NULL, RLS forzado, política y trigger de inmutabilidad", async () => {
    const tables = await app.$queryRaw<
      { table_name: string; is_nullable: string; rls: boolean; forced: boolean; policies: bigint; triggers: bigint }[]
    >`
      SELECT c.table_name, c.is_nullable,
             cl.relrowsecurity AS rls, cl.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name) AS policies,
             (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = cl.oid AND t.tgname LIKE '%_tenant_immutable') AS triggers
      FROM information_schema.columns c
      JOIN pg_class cl ON cl.relname = c.table_name AND cl.relnamespace = 'public'::regnamespace
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'`;
    const scoped = tables.filter((t) => !NO_RLS_ALLOWLIST.has(t.table_name));
    assert.ok(scoped.length >= 11, `se esperaban >= 11 tablas tenant-scoped, hay ${scoped.length}`);
    for (const t of scoped) {
      assert.equal(t.is_nullable, "NO", `${t.table_name}.tenant_id debe ser NOT NULL`);
      assert.ok(t.rls && t.forced, `${t.table_name} sin RLS forzado`);
      assert.ok(Number(t.policies) >= 1, `${t.table_name} sin política`);
      assert.ok(Number(t.triggers) >= 1, `${t.table_name} sin trigger de inmutabilidad`);
    }
  });

  it("las tablas globales no son escribibles por el rol de aplicación", async () => {
    await assert.rejects(app.tenant.create({ data: { id: uuidv7(), slug: "x", legalName: "X" } }));
    await assert.rejects(app.permission.create({ data: { id: uuidv7(), code: "x.y", module: "x", action: "y" } }));
    await assert.rejects(app.platformUser.findMany());
  });

  it("la auditoría es append-only para el rol de aplicación", async () => {
    const id = uuidv7();
    await withTenant(app, w.tenantA, (tx) =>
      tx.auditLog.create({ data: { id, tenantId: w.tenantA, action: "TEST", entityType: "branch" } }),
    );
    await assert.rejects(withTenant(app, w.tenantA, (tx) => tx.auditLog.updateMany({ where: { id }, data: { action: "X" } })));
    await assert.rejects(withTenant(app, w.tenantA, (tx) => tx.auditLog.deleteMany({ where: { id } })));
  });

  it("solo puede existir una sucursal principal por tenant", async () => {
    await rejectsWithCode(
      withTenant(app, w.tenantA, (tx) =>
        tx.branch.create({ data: { id: uuidv7(), tenantId: w.tenantA, code: "A9", name: "Otra principal", isMain: true } }),
      ),
      "P2002",
    );
  });
});
