import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { uuidv7, withTenant } from "@erp/db";
import { call, login, owner, setup, teardown, tokenFor, world } from "./support";

before(setup);
after(teardown);


describe("autenticación", () => {
  it("health es público", async () => {
    const r = await call("GET", "/health");
    assert.equal(r.status, 200);
  });

  it("una ruta protegida sin token devuelve 401 en formato Problem Details", async () => {
    const r = await call("GET", "/api/v1/me");
    assert.equal(r.status, 401);
    assert.match(r.type, /application\/problem\+json/);
    assert.equal(r.json.code, "UNAUTHORIZED");
  });

  it("contraseña incorrecta y usuario inexistente responden igual", async () => {
    const bad = await call("POST", "/api/v1/auth/login", { body: { identifier: "admin.a@test.local", password: "incorrecta" } });
    const none = await call("POST", "/api/v1/auth/login", { body: { identifier: "nadie@test.local", password: "incorrecta" } });
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.json, none.json);
  });

  it("valida el cuerpo con Zod", async () => {
    const r = await call("POST", "/api/v1/auth/login", { body: { identifier: "", password: "" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "VALIDATION");
  });

  it("login correcto emite tokens y registra auditoría", async () => {
    const r = await login("admin.a@test.local");
    assert.equal(r.status, 200);
    assert.equal(r.json.tokenType, "Bearer");
    assert.ok(r.json.accessToken && r.json.refreshToken);
    const n = await withTenant(owner, world.tenantA, (tx) => tx.auditLog.count({ where: { action: "auth.login" } }));
    assert.ok(n >= 1);
  });

  it("un token manipulado o de otra firma es rechazado", async () => {
    const t = await tokenFor("admin.a@test.local");
    const tampered = t.slice(0, -4) + (t.endsWith("AAAA") ? "BBBB" : "AAAA");
    assert.equal((await call("GET", "/api/v1/me", { token: tampered })).status, 401);
    assert.equal((await call("GET", "/api/v1/me", { token: "no.es.jwt" })).status, 401);
  });

  it("usuario en dos tenants: exige indicar el tenant y luego entra al elegido", async () => {
    const r = await login("multi@test.local");
    assert.equal(r.status, 401);
    assert.equal(r.json.code, "TENANT_REQUIRED");
    assert.deepEqual(new Set(r.json.errors.map((t: { slug: string }) => t.slug)), new Set(["empresa-a", "empresa-b"]));
    const me = await call("GET", "/api/v1/me", { token: await tokenFor("multi@test.local", "empresa-b") });
    assert.equal(me.json.tenant.slug, "empresa-b");
  });

  it("bloqueo progresivo tras fallos consecutivos (incluso con la clave correcta)", async () => {
    for (let i = 0; i < 3; i++) {
      await call("POST", "/api/v1/auth/login", { body: { identifier: "cajero@test.local", password: "mala" } });
    }
    assert.equal((await login("cajero@test.local")).status, 401);
    await owner.user.update({ where: { email: "cajero@test.local" }, data: { failedLogins: 0, lockedUntil: null } });
    assert.equal((await login("cajero@test.local")).status, 200);
  });

  it("un tenant suspendido no permite iniciar sesión", async () => {
    await owner.tenant.update({ where: { id: world.tenantB }, data: { status: "SUSPENDED" } });
    assert.equal((await login("admin.b@test.local")).status, 401);
    await owner.tenant.update({ where: { id: world.tenantB }, data: { status: "ACTIVE" } });
    assert.equal((await login("admin.b@test.local")).status, 200);
  });
});

describe("sesiones: refresh rotativo y logout", () => {
  it("el refresh rota el token y el anterior queda inutilizable (revoca la sesión)", async () => {
    const first = (await login("admin.a@test.local")).json;
    const second = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: first.refreshToken } });
    assert.equal(second.status, 200);
    assert.notEqual(second.json.refreshToken, first.refreshToken);
    assert.equal((await call("GET", "/api/v1/me", { token: second.json.accessToken })).status, 200);

    // Reutilizar el token viejo = posible robo: se revocan las sesiones del usuario.
    const reuse = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: first.refreshToken } });
    assert.equal(reuse.status, 401);
    assert.equal((await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: second.json.refreshToken } })).status, 401);
    assert.equal((await call("GET", "/api/v1/me", { token: second.json.accessToken })).status, 401);
  });

  it("refresh con basura o sesión inexistente devuelve 401", async () => {
    for (const refreshToken of ["abcdefghijkl", `${uuidv7()}.secreto-falso`, "a.b.c.d.e.f"]) {
      assert.equal((await call("POST", "/api/v1/auth/refresh", { body: { refreshToken } })).status, 401);
    }
  });

  it("logout revoca la sesión: el access token deja de servir", async () => {
    const t = await login("admin.a@test.local");
    assert.equal((await call("POST", "/api/v1/auth/logout", { token: t.json.accessToken })).status, 204);
    assert.equal((await call("GET", "/api/v1/me", { token: t.json.accessToken })).status, 401);
    assert.equal((await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: t.json.refreshToken } })).status, 401);
  });

  it("una membresía suspendida corta el acceso aunque el token siga vigente", async () => {
    const token = await tokenFor("cajero@test.local");
    assert.equal((await call("GET", "/api/v1/me", { token })).status, 200);
    await withTenant(owner, world.tenantA, (tx) =>
      tx.membership.updateMany({ where: { user: { email: "cajero@test.local" } }, data: { status: "SUSPENDED" } }),
    );
    assert.equal((await call("GET", "/api/v1/me", { token })).status, 401);
    await withTenant(owner, world.tenantA, (tx) =>
      tx.membership.updateMany({ where: { user: { email: "cajero@test.local" } }, data: { status: "ACTIVE" } }),
    );
  });
});

describe("aislamiento de tenant y autorización por permisos", () => {
  it("/me del administrador A: tenant A, todas las sucursales y todos los permisos", async () => {
    const r = await call("GET", "/api/v1/me", { token: await tokenFor("admin.a@test.local") });
    assert.equal(r.json.tenant.slug, "empresa-a");
    assert.equal(r.json.branches.length, 3);
    assert.ok(r.json.permissions.includes("sales.override_price"));
    assert.equal(r.json.allBranches, true);
  });

  it("cada administrador ve solo las sucursales de su tenant", async () => {
    const a = await call("GET", "/api/v1/branches", { token: await tokenFor("admin.a@test.local") });
    const b = await call("GET", "/api/v1/branches", { token: await tokenFor("admin.b@test.local") });
    assert.deepEqual(a.json.map((x: { code: string }) => x.code), ["A1", "A2", "A3"]);
    assert.deepEqual(b.json.map((x: { code: string }) => x.code), ["B1"]);
  });

  it("el admin de A no puede pedir una sucursal del tenant B (ni existe para él)", async () => {
    const r = await call("GET", "/api/v1/branches", { token: await tokenFor("admin.a@test.local"), headers: { "x-branch-id": world.b1 } });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "BRANCH_FORBIDDEN");
  });

  it("un tenantId en cabeceras o query no cambia el tenant (sale del token)", async () => {
    const r = await call("GET", `/api/v1/branches?tenantId=${world.tenantB}`, {
      token: await tokenFor("admin.a@test.local"), headers: { "x-tenant-id": world.tenantB },
    });
    assert.equal(r.json.length, 3);
    assert.ok(r.json.every((b: { code: string }) => b.code.startsWith("A")));
  });

  it("sin el permiso branches.read el cajero recibe 403", async () => {
    const r = await call("GET", "/api/v1/branches", { token: await tokenFor("cajero@test.local") });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "FORBIDDEN");
  });

  it("gerente multi-sucursal: ve A1 y A2; X-Branch-Id a A3 es 403; a A1 devuelve solo A1", async () => {
    const token = await tokenFor("multi@test.local", "empresa-a");
    const all = await call("GET", "/api/v1/branches", { token });
    assert.deepEqual(all.json.map((x: { code: string }) => x.code), ["A1", "A2"]);
    assert.equal((await call("GET", "/api/v1/branches", { token, headers: { "x-branch-id": world.a3 } })).status, 403);
    const one = await call("GET", "/api/v1/branches", { token, headers: { "x-branch-id": world.a1 } });
    assert.deepEqual(one.json.map((x: { code: string }) => x.code), ["A1"]);
  });

  it("una sucursal con formato inválido devuelve 400", async () => {
    const r = await call("GET", "/api/v1/branches", { token: await tokenFor("admin.a@test.local"), headers: { "x-branch-id": "no-uuid" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "INVALID_BRANCH");
  });

  it("el mismo usuario en otro tenant tiene permisos y sucursales de ESE tenant", async () => {
    const r = await call("GET", "/api/v1/me", { token: await tokenFor("multi@test.local", "empresa-b") });
    assert.equal(r.json.tenant.slug, "empresa-b");
    assert.deepEqual(r.json.branches.map((b: { code: string }) => b.code), ["B1"]);
    assert.ok(!r.json.permissions.includes("branches.read")); // cajero en B
  });
});
