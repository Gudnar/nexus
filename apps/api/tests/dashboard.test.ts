import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { call, login, setup, teardown, tokenFor, world } from "./support";

before(async () => {
  await setup();
  // Genera actividad auditada: dos inicios de sesión por tenant.
  for (const [email, tenant] of [
    ["admin.a@test.local", undefined], ["cajero@test.local", undefined],
    ["admin.b@test.local", undefined], ["multi@test.local", "empresa-a"],
  ] as const) assert.equal((await login(email, tenant)).status, 200);
});
after(teardown);

const dash = (token: string, headers: Record<string, string> = {}, query = "") =>
  call("GET", `/api/v1/dashboard${query}`, { token, headers });

describe("panel consolidado: alcance explícito", () => {
  it("administrador con 'todas las sucursales': alcance declarado, sucursales y usuarios por sucursal", async () => {
    const r = await dash(await tokenFor("admin.a@test.local"));
    assert.equal(r.status, 200);
    assert.deepEqual(
      { mode: r.json.scope.mode, restricted: r.json.scope.restricted, label: r.json.scope.label },
      { mode: "ALL", restricted: false, label: "Todas las sucursales" },
    );
    assert.equal(r.json.scope.branchIds.length, 3);
    // A1: admin (todas) + multi + cajero; A2: admin + multi; A3: solo admin.
    assert.deepEqual(r.json.branches.map((b: { code: string; activeUsers: number }) => [b.code, b.activeUsers]), [
      ["A1", 3], ["A2", 2], ["A3", 1],
    ]);
    assert.deepEqual(r.json.users, { active: 3, suspended: 0, invited: 0 });
  });

  it("una sucursal concreta: el alcance pasa a BRANCH y solo trae esa sucursal", async () => {
    const r = await dash(await tokenFor("admin.a@test.local"), { "x-branch-id": world.a2 });
    assert.equal(r.json.scope.mode, "BRANCH");
    assert.match(r.json.scope.label, /A2/);
    assert.deepEqual(r.json.scope.branchIds, [world.a2]);
    assert.equal(r.json.branches.length, 1);
    assert.equal(r.json.branches[0].activeUsers, 2);
    assert.deepEqual(r.json.users, { active: 2, suspended: 0, invited: 0 }); // admin + multi
  });

  it("gerente multi-sucursal: 'todas' son solo las suyas y se declara como restringido", async () => {
    const r = await dash(await tokenFor("multi@test.local", "empresa-a"));
    assert.equal(r.json.scope.mode, "ALL");
    assert.equal(r.json.scope.restricted, true);
    assert.equal(r.json.scope.label, "Todas mis sucursales");
    assert.deepEqual(r.json.branches.map((b: { code: string }) => b.code), ["A1", "A2"]);
    assert.ok(!r.json.scope.branchIds.includes(world.a3));
  });

  it("pedir una sucursal sin acceso es 403 y una de otro tenant también", async () => {
    const multi = await tokenFor("multi@test.local", "empresa-a");
    assert.equal((await dash(multi, { "x-branch-id": world.a3 })).status, 403);
    assert.equal((await dash(await tokenFor("admin.a@test.local"), { "x-branch-id": world.b1 })).status, 403);
  });

  it("cada tenant ve solo su propio panel", async () => {
    const b = await dash(await tokenFor("admin.b@test.local"));
    assert.deepEqual(b.json.branches.map((x: { code: string }) => x.code), ["B1"]);
    assert.deepEqual(b.json.users, { active: 2, suspended: 0, invited: 0 }); // admin.b + multi (cajero en B)
    assert.ok(b.json.activity.recent.every((e: { actorName: string | null }) => e.actorName !== "Admin A"));
    assert.ok(!b.json.scope.branchIds.includes(world.a1));
  });
});

describe("panel consolidado: secciones por permiso", () => {
  it("el cajero ve su alcance pero ninguna sección sin permiso (null, sin datos parciales)", async () => {
    const r = await dash(await tokenFor("cajero@test.local"));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.scope.branchIds, [world.a1]);
    assert.deepEqual(r.json.visibleSections, []);
    assert.equal(r.json.branches, null);
    assert.equal(r.json.users, null);
    assert.equal(r.json.activity, null);
    assert.equal(r.json.system, null);
  });

  it("el administrador ve todas las secciones", async () => {
    const r = await dash(await tokenFor("admin.a@test.local"));
    assert.deepEqual(r.json.visibleSections, ["branches", "users", "activity", "system"]);
  });

  it("los eventos de nivel tenant (sin sucursal) solo los ve quien tiene acceso a todas", async () => {
    const admin = await dash(await tokenFor("admin.a@test.local"));
    assert.equal(admin.json.activity.includesTenantLevelEvents, true);
    assert.ok(admin.json.activity.recent.some((e: { action: string }) => e.action === "auth.login"));

    const manager = await dash(await tokenFor("multi@test.local", "empresa-a"));
    assert.equal(manager.json.activity.includesTenantLevelEvents, false);
    assert.equal(manager.json.activity.recent.length, 0);
  });

  it("la actividad incluye el nombre del actor y conteo por acción", async () => {
    const r = await dash(await tokenFor("admin.a@test.local"));
    const login = r.json.activity.recent.find((e: { action: string }) => e.action === "auth.login");
    assert.ok(login.actorName);
    const count = r.json.activity.actionCounts.find((c: { action: string }) => c.action === "auth.login");
    assert.ok(count.count >= 2);
  });

  it("estado del outbox visible para quien tiene audit.read", async () => {
    const r = await dash(await tokenFor("admin.a@test.local"));
    assert.ok(r.json.system.outbox.pending >= 1); // TenantProvisioned aún sin despachar
    assert.equal(r.json.system.outbox.dead, 0);
  });

  it("los módulos aún no implementados se anuncian como pendientes, no como ceros", async () => {
    const r = await dash(await tokenFor("admin.a@test.local"));
    for (const m of ["sales", "inventory", "cash"]) assert.ok(r.json.pendingModules.includes(m));
    assert.equal(r.json.sales, undefined);
  });
});

describe("panel consolidado: validación y seguridad", () => {
  it("la ventana de días se valida (1 a 90)", async () => {
    const t = await tokenFor("admin.a@test.local");
    assert.equal((await dash(t, {}, "?days=0")).status, 400);
    assert.equal((await dash(t, {}, "?days=500")).status, 400);
    assert.equal((await dash(t, {}, "?days=abc")).status, 400);
    assert.equal((await dash(t, {}, "?days=30")).json.windowDays, 30);
  });

  it("requiere autenticación", async () => {
    assert.equal((await call("GET", "/api/v1/dashboard")).status, 401);
  });
});
