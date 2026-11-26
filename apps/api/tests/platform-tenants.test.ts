import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { withTenant } from "@erp/db";
import { call, loginAs, owner, PLATFORM_EMAIL, PLATFORM_PW, setup, teardown, tokenFor } from "./support";

let sup: string, adminA: string;
type M = "GET" | "POST" | "PATCH";
const api = (token: string | undefined, method: M, url: string, body?: unknown) => call(method, `/api/v1/platform${url}`, { token, body: body ?? (method === "GET" ? undefined : {}) });
const NEW = { companyName: "Distribuidora Andina", taxId: "123", planCode: "base", status: "TRIAL", adminName: "Rosa Quispe", adminEmail: "rosa@andina.test", adminUsername: "rosa.q" };
const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
const PW_ROSA = "Zafiro-Nocturno-7413-Xt";
const loginRosa = () => call("POST", "/api/v1/auth/login", { body: { identifier: "rosa.q", password: PW_ROSA } });

before(async () => {
  await setup();
  const r = await call("POST", "/api/v1/platform/auth/login", { body: { email: PLATFORM_EMAIL, password: PLATFORM_PW } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  sup = r.json.accessToken;
  adminA = await tokenFor("admin.a@test.local");
});
after(teardown);

describe("empresas desde la consola de plataforma", () => {
  let created: any;

  it("exige sesión de plataforma: sin token o con token de empresa no entra", async () => {
    for (const t of [undefined, adminA]) {
      assert.equal((await api(t, "GET", "/tenants")).status, 401);
      assert.equal((await api(t, "POST", "/tenants", NEW)).status, 401);
      assert.equal((await api(t, "GET", "/plans")).status, 401);
    }
  });

  it("lista planes y empresas con su estado y totales (solo datos de cuenta)", async () => {
    const plans = (await api(sup, "GET", "/plans")).json;
    assert.ok(plans.some((p: any) => p.code === "base"));
    const list = (await api(sup, "GET", "/tenants")).json;
    assert.deepEqual(list.map((t: any) => t.slug).sort(), ["empresa-a", "empresa-b"]);
    const a = list.find((t: any) => t.slug === "empresa-a");
    assert.deepEqual([a.status, a.users >= 3, a.branches], ["ACTIVE", true, 3]);
    assert.deepEqual(Object.keys(a).sort(), ["branches", "createdAt", "id", "legalName", "plan", "slug", "status", "taxId", "users"]);
  });

  it("valida la solicitud y el plan", async () => {
    for (const bad of [{ ...NEW, companyName: "" }, { ...NEW, adminEmail: "no-es-correo" }, { ...NEW, adminUsername: "A B" }, { ...NEW, status: "SUSPENDED" }]) {
      assert.equal((await api(sup, "POST", "/tenants", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await api(sup, "POST", "/tenants", { ...NEW, planCode: "nope" })).json.code, "PLAN_UNKNOWN");
  });

  it("crea la empresa con su administrador y un enlace de un solo uso para fijar su contraseña", async () => {
    const r = await api(sup, "POST", "/tenants", NEW);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    created = r.json;
    assert.deepEqual([created.tenant.slug, created.tenant.status, created.tenant.plan.code, created.tenant.users, created.tenant.branches, created.adminAlreadyExisted], ["distribuidora-andina", "TRIAL", "base", 1, 1, false]);
    assert.match(created.setupUrl, /\/reset-password\?token=/);
    // aún no puede entrar: no hay contraseña conocida
    assert.equal((await call("POST", "/api/v1/auth/login", { body: { identifier: "rosa.q", password: "Cualquiera-123" } })).status, 401);
    const set = await call("POST", "/api/v1/auth/password/reset", { body: { token: tokenOf(created.setupUrl), password: PW_ROSA } });
    assert.ok([200, 204].includes(set.status), JSON.stringify(set.json));
    const login = await loginRosa();
    assert.equal(login.status, 200, JSON.stringify(login.json));
    // el enlace solo sirve una vez
    assert.equal((await call("POST", "/api/v1/auth/password/reset", { body: { token: tokenOf(created.setupUrl), password: "Cobre-Vertical-5521-Qw" } })).status, 400);
  });

  it("la empresa nueva nace con sus roles y queda auditada", async () => {
    const id = created.tenant.id;
    assert.equal(await withTenant(owner, id, (tx) => tx.role.count()), 5);
    const audit = await withTenant(owner, id, (tx) => tx.auditLog.findMany({ select: { action: true } }));
    assert.ok(audit.some((a: any) => a.action === "platform.tenant_created"));
  });

  it("evita nombres de empresa, usuarios y correos repetidos", async () => {
    const dup = await api(sup, "POST", "/tenants", { ...NEW, adminEmail: "otra@andina.test", adminUsername: "otra.q" });
    assert.equal(dup.json.tenant.slug, "distribuidora-andina-2");
    assert.equal((await api(sup, "POST", "/tenants", { ...NEW, adminEmail: "x@andina.test" })).json.code, "USERNAME_TAKEN");
  });

  it("si el administrador ya tiene cuenta, no se toca su contraseña y entra con la suya", async () => {
    const r = await api(sup, "POST", "/tenants", { ...NEW, companyName: "Tercera SA", adminEmail: "admin.a@test.local", adminUsername: undefined, adminName: "Admin A" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.adminAlreadyExisted, r.json.setupUrl], [true, null]);
    const t = await call("POST", "/api/v1/auth/login", { body: { identifier: "admin.a@test.local", password: "Clave-Segura-123", tenant: "tercera-sa" } });
    assert.equal(t.status, 200, JSON.stringify(t.json));
  });

  it("suspender cierra las sesiones y bloquea el acceso; reactivar lo devuelve", async () => {
    const token = await loginAs("rosa.q", PW_ROSA);
    assert.equal((await call("GET", "/api/v1/me", { token })).status, 200);
    const s = await api(sup, "PATCH", `/tenants/${created.tenant.id}`, { status: "SUSPENDED" });
    assert.deepEqual([s.status, s.json.status], [200, "SUSPENDED"]);
    assert.equal((await loginRosa()).status, 401);
    const back = await api(sup, "PATCH", `/tenants/${created.tenant.id}`, { status: "ACTIVE" });
    assert.equal(back.json.status, "ACTIVE");
    assert.equal((await loginRosa()).status, 200);
  });

  it("cambiar de plan, rechazar cambios vacíos y empresas inexistentes", async () => {
    assert.equal((await api(sup, "PATCH", `/tenants/${created.tenant.id}`, {})).status, 400);
    assert.equal((await api(sup, "PATCH", `/tenants/${created.tenant.id}`, { planCode: "nope" })).json.code, "PLAN_UNKNOWN");
    assert.equal((await api(sup, "PATCH", `/tenants/${created.tenant.id}`, { planCode: "base" })).json.plan.code, "base");
    assert.equal((await api(sup, "PATCH", "/tenants/00000000-0000-4000-8000-000000000001", { status: "ACTIVE" })).status, 404);
  });
});
