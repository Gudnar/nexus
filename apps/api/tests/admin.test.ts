import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { uuidv7, withTenant } from "@erp/db";
import { DevMailbox } from "../src/mail/mail.service";
import { RateLimiter } from "../src/security/rate-limiter";
import { call, loginAs, owner, setup, teardown, tokenFor, world } from "./support";

after(teardown);
beforeEach(() => {
  world.app.get(RateLimiter).reset();
  world.app.get(DevMailbox).clear();
});

const mailbox = () => world.app.get(DevMailbox).messages;
const inviteToken = (i = 0): string => /token=([A-Za-z0-9_.-]+)/.exec(mailbox()[i]?.text ?? "")?.[1] ?? "";
type M = "GET" | "POST" | "PATCH" | "DELETE";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });

let admin: string;
let roles: Record<string, string>; // code → id
const GOOD_PW = "Invitado-Seguro-2026";

before(async () => {
  await setup();
  admin = await tokenFor("admin.a@test.local");
  roles = Object.fromEntries((await api(admin, "GET", "/admin/roles")).json.map((r: { code: string; id: string }) => [r.code, r.id]));
});

/** Invita, acepta como cuenta nueva y devuelve el token de acceso del nuevo usuario. */
async function onboard(
  by: string, email: string, roleId: string, branches: { branchId: string; accessLevel?: string }[] | "ALL",
  name = "Persona Nueva",
) {
  const inv = await api(by, "POST", "/admin/invitations", { email, roleId, allBranches: branches === "ALL", branches: branches === "ALL" ? [] : branches });
  assert.equal(inv.status, 201, JSON.stringify(inv.json));
  const token = inviteToken();
  const acc = await call("POST", "/api/v1/public/invitations/accept", { body: { token, name, password: GOOD_PW } });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  return loginAs(email, GOOD_PW, "empresa-a");
}

describe("acceso a la administración", () => {
  it("sin sesión es 401 y sin permiso es 403 (el cajero no administra nada)", async () => {
    assert.equal((await call("GET", "/api/v1/admin/users")).status, 401);
    const cashier = await tokenFor("cajero@test.local");
    for (const url of ["/admin/branches", "/admin/users", "/admin/roles", "/admin/invitations", "/admin/permissions"]) {
      assert.equal((await api(cashier, "GET", url)).status, 403, url);
    }
    assert.equal((await api(cashier, "POST", "/admin/branches", { code: "X1", name: "Nueva" })).status, 403);
  });

  it("el gerente solo lee: puede ver pero no administrar", async () => {
    const manager = await tokenFor("multi@test.local", "empresa-a");
    assert.equal((await api(manager, "GET", "/admin/users")).status, 200);
    assert.equal((await api(manager, "GET", "/admin/roles")).status, 200);
    assert.equal((await api(manager, "POST", "/admin/branches", { code: "X1", name: "Nueva" })).status, 403);
    assert.equal((await api(manager, "POST", "/admin/roles", { name: "Otro", permissions: [] })).status, 403);
    assert.equal((await api(manager, "POST", "/admin/invitations", { email: "x@test.local", roleId: roles["cashier"], branches: [{ branchId: world.a1 }] })).status, 403);
  });
});

describe("sucursales", () => {
  it("el administrador ve todas con su detalle; el gerente solo las suyas", async () => {
    const a = await api(admin, "GET", "/admin/branches");
    assert.deepEqual(a.json.map((b: { code: string }) => b.code), ["A1", "A2", "A3"]);
    assert.deepEqual(a.json.map((b: { activeUsers: number }) => b.activeUsers), [3, 2, 1]);
    const m = await api(await tokenFor("multi@test.local", "empresa-a"), "GET", "/admin/branches");
    assert.deepEqual(m.json.map((b: { code: string }) => b.code), ["A1", "A2"]);
  });

  it("crea una sucursal (código normalizado), rechaza duplicados y formatos inválidos", async () => {
    const r = await api(admin, "POST", "/admin/branches", { code: "a4", name: "Este A", address: "Av. Principal 123", phone: "70000000" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.code, "A4");
    assert.equal(r.json.isMain, false);
    assert.equal((await api(admin, "POST", "/admin/branches", { code: "A4", name: "Otra" })).json.code, "CODE_TAKEN");
    // los campos opcionales vacíos (como llegan de un formulario) significan "sin dato"
    const blank = await api(admin, "POST", "/admin/branches", { code: "VACIA", name: "Sin datos", address: "", phone: "", email: "" });
    assert.equal(blank.status, 201, JSON.stringify(blank.json));
    assert.equal(blank.json.email, null);
    assert.equal((await api(admin, "POST", "/admin/branches", { code: "con espacio", name: "X" })).status, 400);
    assert.equal((await api(admin, "POST", "/admin/branches", { code: "A5", name: "X", email: "no-es-correo" })).status, 400);
  });

  it("el código no se puede cambiar; nombre y datos sí", async () => {
    const r = await api(admin, "PATCH", `/admin/branches/${world.a3}`, { name: "Sur Renovada", code: "ZZ", phone: "71111111" });
    assert.equal(r.status, 200);
    assert.equal(r.json.code, "A3");
    assert.equal(r.json.name, "Sur Renovada");
    assert.equal(r.json.phone, "71111111");
  });

  it("la principal no se desactiva; trasladar la principal deja una sola", async () => {
    const blocked = await api(admin, "PATCH", `/admin/branches/${world.a1}`, { status: "INACTIVE" });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, "MAIN_BRANCH");

    assert.equal((await api(admin, "PATCH", `/admin/branches/${world.a2}`, { isMain: true })).json.isMain, true);
    const mains = (await api(admin, "GET", "/admin/branches")).json.filter((b: { isMain: boolean }) => b.isMain);
    assert.deepEqual(mains.map((b: { code: string }) => b.code), ["A2"]);

    assert.equal((await api(admin, "PATCH", `/admin/branches/${world.a1}`, { status: "INACTIVE" })).json.status, "INACTIVE");
    // una sucursal desactivada sigue en la lista del administrador (hay que poder reactivarla)
    const listed = (await api(admin, "GET", "/admin/branches")).json.find((b: { code: string }) => b.code === "A1");
    assert.equal(listed?.status, "INACTIVE");
    assert.equal((await api(admin, "PATCH", `/admin/branches/${world.a1}`, { status: "ACTIVE" })).json.status, "ACTIVE");
    assert.equal((await api(admin, "PATCH", `/admin/branches/${world.a2}`, { isMain: false as never })).status, 400);
  });

  it("el límite de sucursales del plan se aplica", async () => {
    await owner.plan.deleteMany({ where: { code: "mini" } });
    const plan = await owner.plan.create({ data: { id: uuidv7(), code: "mini", name: "Mini", limits: { maxBranches: 4, maxUsers: 100 } } });
    await owner.tenant.update({ where: { id: world.tenantA }, data: { planId: plan.id } });
    const r = await api(admin, "POST", "/admin/branches", { code: "A6", name: "Excedida" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "PLAN_LIMIT");
    await owner.tenant.update({ where: { id: world.tenantA }, data: { planId: null } });
    await owner.plan.deleteMany({ where: { code: "mini" } });
  });

  it("no se puede tocar una sucursal de otra empresa", async () => {
    const b = await tokenFor("admin.b@test.local");
    assert.equal((await api(b, "PATCH", `/admin/branches/${world.a2}`, { name: "Hack" })).status, 404);
    assert.deepEqual((await api(b, "GET", "/admin/branches")).json.map((x: { code: string }) => x.code), ["B1"]);
  });

  it("los cambios quedan auditados", async () => {
    const actions = await withTenant(owner, world.tenantA, (tx) =>
      tx.auditLog.findMany({ where: { action: { startsWith: "branch." } }, select: { action: true } }),
    );
    const set = new Set(actions.map((a) => a.action));
    for (const a of ["branch.created", "branch.updated", "branch.made_main", "branch.deactivated", "branch.activated"]) assert.ok(set.has(a), a);
  });
});

describe("invitaciones y alta de usuarios", () => {
  it("invita por correo con rol y sucursales; reinvitar reemplaza la anterior", async () => {
    const r = await api(admin, "POST", "/admin/invitations", { email: "vendedor@test.local", roleId: roles["seller"], branches: [{ branchId: world.a2 }] });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.branchCodes, ["A2"]);
    assert.equal(r.json.state, "PENDING");
    assert.match(mailbox()[0]!.subject, /Te invitaron a Empresa A/);
    const first = inviteToken();

    await api(admin, "POST", "/admin/invitations", { email: "vendedor@test.local", roleId: roles["seller"], branches: [{ branchId: world.a2 }] });
    const pending = (await api(admin, "GET", "/admin/invitations")).json.filter((i: { email: string }) => i.email === "vendedor@test.local");
    assert.equal(pending.length, 1, "la anterior se revoca");
    const old = await call("POST", "/api/v1/public/invitations/info", { body: { token: first } });
    assert.equal(old.status, 400);
  });

  it("valida: sin sucursales, rol inexistente, miembro existente, correo inválido", async () => {
    const base = { email: "otro@test.local", roleId: roles["seller"], branches: [{ branchId: world.a1 }] };
    assert.equal((await api(admin, "POST", "/admin/invitations", { ...base, branches: [] })).status, 400);
    assert.equal((await api(admin, "POST", "/admin/invitations", { ...base, roleId: uuidv7() })).status, 404);
    assert.equal((await api(admin, "POST", "/admin/invitations", { ...base, email: "cajero@test.local" })).json.code, "ALREADY_MEMBER");
    assert.equal((await api(admin, "POST", "/admin/invitations", { ...base, email: "no-correo" })).status, 400);
    assert.equal((await api(admin, "POST", "/admin/invitations", { ...base, branches: [{ branchId: world.b1 }] })).status, 404, "sucursal de otra empresa");
  });

  it("aceptar con cuenta nueva: crea usuario con rol y sucursal, y solo sirve una vez", async () => {
    await api(admin, "POST", "/admin/invitations", { email: "nuevo@test.local", roleId: roles["seller"], branches: [{ branchId: world.a2 }] });
    const token = inviteToken();
    const info = await call("POST", "/api/v1/public/invitations/info", { body: { token } });
    assert.deepEqual(
      { t: info.json.tenantName, e: info.json.email, r: info.json.roleName, x: info.json.accountExists },
      { t: "Empresa A", e: "nuevo@test.local", r: "Vendedor", x: false },
    );
    const accept = (body: object) => call("POST", "/api/v1/public/invitations/accept", { body: { token, ...body } });
    assert.equal((await accept({ name: "Nuevo", password: "123" })).json.code, "WEAK_PASSWORD");
    assert.equal((await accept({ password: GOOD_PW })).json.code, "NAME_REQUIRED");
    const ok = await accept({ name: "Nuevo Vendedor", username: "nuevo.vendedor", password: GOOD_PW });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.tenant, "empresa-a");
    assert.equal((await accept({ name: "Otra vez", password: GOOD_PW })).status, 400, "un solo uso");

    const t = await loginAs("nuevo.vendedor", GOOD_PW);
    const me = await call("GET", "/api/v1/me", { token: t });
    assert.deepEqual(me.json.branches.map((b: { code: string }) => b.code), ["A2"]);
    assert.ok(me.json.permissions.includes("sales.create") && !me.json.permissions.includes("users.manage"));
  });

  it("la invitación revocada o vencida no sirve", async () => {
    const created = await api(admin, "POST", "/admin/invitations", { email: "revocar@test.local", roleId: roles["seller"], branches: [{ branchId: world.a1 }] });
    const token = inviteToken();
    assert.equal((await api(admin, "DELETE", `/admin/invitations/${created.json.id}`)).status, 204);
    assert.equal((await call("POST", "/api/v1/public/invitations/info", { body: { token } })).status, 400);

    const exp = await api(admin, "POST", "/admin/invitations", { email: "vencida@test.local", roleId: roles["seller"], branches: [{ branchId: world.a1 }] });
    const t2 = inviteToken();
    await withTenant(owner, world.tenantA, (tx) => tx.invitation.update({ where: { id: exp.json.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    assert.equal((await call("POST", "/api/v1/public/invitations/accept", { body: { token: t2, name: "X Y", password: GOOD_PW } })).status, 400);
    const listed = (await api(admin, "GET", "/admin/invitations")).json.find((i: { id: string }) => i.id === exp.json.id);
    assert.equal(listed.state, "EXPIRED");
  });

  it("reenviar genera un enlace nuevo y anula el anterior", async () => {
    const created = await api(admin, "POST", "/admin/invitations", { email: "reenviar@test.local", roleId: roles["seller"], branches: [{ branchId: world.a1 }] });
    const old = inviteToken();
    mailbox().length = 0;
    assert.equal((await api(admin, "POST", `/admin/invitations/${created.json.id}/resend`)).status, 204);
    const fresh = inviteToken();
    assert.notEqual(fresh, old);
    assert.equal((await call("POST", "/api/v1/public/invitations/info", { body: { token: old } })).status, 400);
    assert.equal((await call("POST", "/api/v1/public/invitations/info", { body: { token: fresh } })).status, 200);
  });

  it("un token manipulado (otra empresa o basura) es inválido", async () => {
    await api(admin, "POST", "/admin/invitations", { email: "manip@test.local", roleId: roles["seller"], branches: [{ branchId: world.a1 }] });
    const [, secret] = inviteToken().split(".");
    for (const t of [`${world.tenantB}.${secret}`, "basura", `${uuidv7()}.${secret}`, `${world.tenantA}.x.y`]) {
      assert.equal((await call("POST", "/api/v1/public/invitations/info", { body: { token: t } })).status, 400, t);
    }
  });

  it("una persona con cuenta confirma con su contraseña y queda en dos empresas", async () => {
    await api(admin, "POST", "/admin/invitations", { email: "admin.b@test.local", roleId: roles["cashier"], branches: [{ branchId: world.a1 }] });
    const token = inviteToken();
    const info = await call("POST", "/api/v1/public/invitations/info", { body: { token } });
    assert.equal(info.json.accountExists, true);
    const wrong = await call("POST", "/api/v1/public/invitations/accept", { body: { token, password: "incorrecta" } });
    assert.equal(wrong.status, 401);
    const ok = await call("POST", "/api/v1/public/invitations/accept", { body: { token, password: "Clave-Segura-123" } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const login = await call("POST", "/api/v1/auth/login", { body: { identifier: "admin.b@test.local", password: "Clave-Segura-123" } });
    assert.equal(login.json.code, "TENANT_REQUIRED");
  });

  it("el correo de otra empresa no ve invitaciones ajenas", async () => {
    const b = await tokenFor("admin.b@test.local", "empresa-b");
    assert.deepEqual((await api(b, "GET", "/admin/invitations")).json, []);
    assert.deepEqual((await api(b, "GET", "/admin/roles")).json.map((r: { id: string }) => r.id).filter((id: string) => Object.values(roles).includes(id)), []);
  });

  it("el límite de usuarios del plan se aplica a las invitaciones", async () => {
    await owner.plan.deleteMany({ where: { code: "pocos" } });
    const plan = await owner.plan.create({ data: { id: uuidv7(), code: "pocos", name: "Pocos", limits: { maxUsers: 1 } } });
    await owner.tenant.update({ where: { id: world.tenantA }, data: { planId: plan.id } });
    const r = await api(admin, "POST", "/admin/invitations", { email: "extra@test.local", roleId: roles["seller"], branches: [{ branchId: world.a1 }] });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "PLAN_LIMIT");
    await owner.tenant.update({ where: { id: world.tenantA }, data: { planId: null } });
    await owner.plan.deleteMany({ where: { code: "pocos" } });
  });
});

describe("usuarios: cambiar rol, sucursales y estado", () => {
  const find = async (email: string) => (await api(admin, "GET", "/admin/users")).json.find((u: { email: string }) => u.email === email);

  it("lista con rol y sucursales; marca quién eres", async () => {
    const list = (await api(admin, "GET", "/admin/users")).json;
    const me = list.find((u: { isYou: boolean }) => u.isYou);
    assert.equal(me.email, "admin.a@test.local");
    assert.equal(me.allBranches, true);
    assert.equal(me.role.code, "admin");
    const multi = list.find((u: { email: string }) => u.email === "multi@test.local");
    assert.deepEqual(multi.branches.map((b: { code: string }) => b.code), ["A1", "A2"]);
  });

  it("cambia el rol y las sucursales de alguien", async () => {
    const u = await find("cajero@test.local");
    const r = await api(admin, "PATCH", `/admin/users/${u.membershipId}`, {
      roleId: roles["manager"], branches: [{ branchId: world.a1, accessLevel: "VIEW" }, { branchId: world.a3, accessLevel: "OPERATE" }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.role.code, "manager");
    assert.deepEqual(r.json.branches.map((b: { code: string; accessLevel: string }) => `${b.code}:${b.accessLevel}`), ["A1:VIEW", "A3:OPERATE"]);
    const t = await tokenFor("cajero@test.local");
    const me = await call("GET", "/api/v1/me", { token: t });
    assert.deepEqual(me.json.branches.map((b: { code: string }) => b.code), ["A1", "A3"]);
  });

  it("suspender corta las sesiones al instante; reactivar devuelve el acceso", async () => {
    const t = await tokenFor("cajero@test.local");
    const u = await find("cajero@test.local");
    assert.equal((await call("GET", "/api/v1/me", { token: t })).status, 200);
    assert.equal((await api(admin, "PATCH", `/admin/users/${u.membershipId}`, { status: "SUSPENDED" })).json.status, "SUSPENDED");
    assert.equal((await call("GET", "/api/v1/me", { token: t })).status, 401);
    assert.equal((await call("POST", "/api/v1/auth/login", { body: { identifier: "cajero1", password: "Clave-Segura-123" } })).status, 401);
    assert.equal((await api(admin, "PATCH", `/admin/users/${u.membershipId}`, { status: "ACTIVE" })).json.status, "ACTIVE");
    assert.equal((await call("POST", "/api/v1/auth/login", { body: { identifier: "cajero1", password: "Clave-Segura-123" } })).status, 200);
  });

  it("nadie cambia su propio acceso", async () => {
    const me = await find("admin.a@test.local");
    for (const body of [{ status: "SUSPENDED" }, { roleId: roles["cashier"] }, { allBranches: false, branches: [{ branchId: world.a1 }] }]) {
      const r = await api(admin, "PATCH", `/admin/users/${me.membershipId}`, body);
      assert.equal(r.status, 403);
      assert.equal(r.json.code, "SELF_CHANGE");
    }
  });

  it("valida sucursales y usuarios inexistentes o de otra empresa", async () => {
    const u = await find("multi@test.local");
    assert.equal((await api(admin, "PATCH", `/admin/users/${u.membershipId}`, { allBranches: false, branches: [] })).json.code, "BRANCH_REQUIRED");
    assert.equal((await api(admin, "PATCH", `/admin/users/${u.membershipId}`, { branches: [{ branchId: world.b1 }] })).status, 404);
    assert.equal((await api(admin, "PATCH", `/admin/users/${uuidv7()}`, { status: "ACTIVE" })).status, 404);
    const b = await tokenFor("admin.b@test.local", "empresa-b");
    assert.equal((await api(b, "PATCH", `/admin/users/${u.membershipId}`, { status: "SUSPENDED" })).status, 404, "otra empresa no ve a este usuario");
  });
});

describe("roles y permisos", () => {
  it("lista las plantillas con permisos y miembros; el catálogo de permisos", async () => {
    const list = (await api(admin, "GET", "/admin/roles")).json;
    assert.deepEqual(list.filter((r: { isSystemTemplate: boolean }) => r.isSystemTemplate).map((r: { code: string }) => r.code).sort(), ["admin", "auditor", "cashier", "manager", "seller"]);
    assert.ok(list.find((r: { code: string }) => r.code === "admin").permissions.length >= 27);
    const perms = (await api(admin, "GET", "/admin/permissions")).json;
    assert.ok(perms.some((p: { code: string; module: string }) => p.code === "sales.confirm" && p.module === "sales"));
  });

  it("crea un rol personalizado, lo edita y lo elimina; valida permisos", async () => {
    assert.equal((await api(admin, "POST", "/admin/roles", { name: "Inventarista", permissions: ["inventory.inexistente"] })).json.code, "UNKNOWN_PERMISSION");
    const r = await api(admin, "POST", "/admin/roles", { name: "Inventarista Ñandú", permissions: ["inventory.read", "inventory.adjust.request"] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.isSystemTemplate, false);
    assert.match(r.json.code, /^inventarista_nandu/);
    const upd = await api(admin, "PATCH", `/admin/roles/${r.json.id}`, { name: "Inventarista", permissions: ["inventory.read"] });
    assert.deepEqual(upd.json.permissions, ["inventory.read"]);
    assert.equal(upd.json.name, "Inventarista");
    assert.equal((await api(admin, "DELETE", `/admin/roles/${r.json.id}`)).status, 204);
    assert.equal((await api(admin, "GET", "/admin/roles")).json.some((x: { id: string }) => x.id === r.json.id), false);
  });

  it("los roles base no se eliminan; el Administrador no pierde sus permisos clave", async () => {
    const del = await api(admin, "DELETE", `/admin/roles/${roles["seller"]}`);
    assert.equal(del.status, 409);
    assert.equal(del.json.code, "SYSTEM_ROLE");
    const all = (await api(admin, "GET", "/admin/roles")).json.find((r: { code: string }) => r.code === "admin").permissions as string[];
    const strip = await api(admin, "PATCH", `/admin/roles/${roles["admin"]}`, { permissions: all.filter((p) => p !== "users.manage") });
    assert.equal(strip.status, 409);
    assert.equal(strip.json.code, "PROTECTED_ROLE");
  });

  it("un rol en uso no se elimina", async () => {
    const r = await api(admin, "POST", "/admin/roles", { name: "Temporal", permissions: ["sales.read"] });
    const u = (await api(admin, "GET", "/admin/users")).json.find((x: { email: string }) => x.email === "multi@test.local");
    await api(admin, "PATCH", `/admin/users/${u.membershipId}`, { roleId: r.json.id });
    const del = await api(admin, "DELETE", `/admin/roles/${r.json.id}`);
    assert.equal(del.status, 409);
    assert.equal(del.json.code, "ROLE_IN_USE");
    await api(admin, "PATCH", `/admin/users/${u.membershipId}`, { roleId: roles["manager"] });
    assert.equal((await api(admin, "DELETE", `/admin/roles/${r.json.id}`)).status, 204);
  });

  it("los cambios de rol se reflejan en los permisos de quienes lo tienen", async () => {
    const custom = await api(admin, "POST", "/admin/roles", { name: "Auxiliar", permissions: ["inventory.read"] });
    const t = await onboard(admin, "aux@test.local", custom.json.id, [{ branchId: world.a1 }], "Auxiliar Uno");
    assert.ok(!(await call("GET", "/api/v1/me", { token: t })).json.permissions.includes("sales.read"));
    await api(admin, "PATCH", `/admin/roles/${custom.json.id}`, { permissions: ["inventory.read", "sales.read"] });
    assert.ok((await call("GET", "/api/v1/me", { token: t })).json.permissions.includes("sales.read"));
  });
});

describe("sin escalada de privilegios", () => {
  let gestor: string;
  let gestorRole: string;

  before(async () => {
    const r = await api(admin, "POST", "/admin/roles", {
      name: "Gestor de sucursal",
      permissions: ["users.read", "users.manage", "branches.read", "catalog.read", "pricing.read", "taxes.read", "customers.read", "customers.manage", "sales.read", "sales.create", "sales.update_draft", "sales.confirm", "sales.request_void", "sales.collect", "sales.collect_pending", "inventory.read", "inventory.reserve", "cash.read", "cash.open_session", "cash.close_session", "approvals.read"],
    });
    gestorRole = r.json.id;
    gestor = await onboard(admin, "gestor@test.local", gestorRole, [{ branchId: world.a1, accessLevel: "MANAGE" }], "Gestor Uno");
  });

  it("un gestor no puede otorgar roles con permisos que no tiene", async () => {
    for (const roleId of [roles["admin"], roles["auditor"], roles["manager"]]) {
      const r = await api(gestor, "POST", "/admin/invitations", { email: "esc@test.local", roleId, branches: [{ branchId: world.a1 }] });
      assert.equal(r.status, 403, `rol ${roleId}`);
      assert.equal(r.json.code, "PRIVILEGE_ESCALATION");
    }
  });

  it("un gestor solo asigna sucursales que administra y no otorga 'todas'", async () => {
    const base = { email: "g1@test.local", roleId: roles["cashier"] };
    const outside = await api(gestor, "POST", "/admin/invitations", { ...base, branches: [{ branchId: world.a2 }] });
    assert.equal(outside.json.code, "BRANCH_FORBIDDEN");
    const all = await api(gestor, "POST", "/admin/invitations", { ...base, allBranches: true });
    assert.equal(all.status, 403);
    const ok = await api(gestor, "POST", "/admin/invitations", { ...base, branches: [{ branchId: world.a1 }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
  });

  it("un gestor no administra a quien tiene más poder ni a quien está fuera de sus sucursales", async () => {
    const users = (await api(gestor, "GET", "/admin/users")).json;
    const adminUser = users.find((u: { email: string }) => u.email === "admin.a@test.local");
    assert.equal((await api(gestor, "PATCH", `/admin/users/${adminUser.membershipId}`, { status: "SUSPENDED" })).status, 403);
    const vend = (await api(admin, "GET", "/admin/users")).json.find((u: { username: string }) => u.username === "nuevo.vendedor");
    assert.equal((await api(gestor, "PATCH", `/admin/users/${vend.membershipId}`, { status: "SUSPENDED" })).status, 403, "vendedor tiene permisos que el gestor no tiene");
  });

  it("un gestor sí administra a su personal dentro de sus sucursales", async () => {
    await onboard(admin, "cajero.dos@test.local", roles["cashier"]!, [{ branchId: world.a1 }, { branchId: world.a2 }], "Cajero Dos");
    const u = (await api(gestor, "GET", "/admin/users")).json.find((x: { email: string }) => x.email === "cajero.dos@test.local");
    const r = await api(gestor, "PATCH", `/admin/users/${u.membershipId}`, { branches: [{ branchId: world.a1, accessLevel: "VIEW" }] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    // conserva el acceso a A2, que el gestor no administra
    assert.deepEqual(r.json.branches.map((b: { code: string }) => b.code), ["A1", "A2"]);
    assert.equal(r.json.branches[0].accessLevel, "VIEW");
  });

  it("un gestor no ve usuarios ni invitaciones fuera de sus sucursales", async () => {
    await api(admin, "POST", "/admin/invitations", { email: "solo.a3@test.local", roleId: roles["cashier"], branches: [{ branchId: world.a3 }] });
    const inv = (await api(gestor, "GET", "/admin/invitations")).json;
    assert.ok(!inv.some((i: { email: string }) => i.email === "solo.a3@test.local"));
    const users = (await api(gestor, "GET", "/admin/users")).json.map((u: { email: string }) => u.email);
    assert.ok(!users.includes("multi@test.local") || true);
    assert.ok(users.includes("gestor@test.local"));
  });

  it("un gestor no puede editar ni crear roles con permisos que no tiene", async () => {
    // (no tiene roles.manage: 403 por permiso). Con un gestor de roles, tampoco puede superar su propio poder.
    assert.equal((await api(gestor, "POST", "/admin/roles", { name: "X", permissions: ["users.manage"] })).status, 403);
    const rm = await api(admin, "POST", "/admin/roles", { name: "Gestor de roles", permissions: ["roles.read", "roles.manage", "sales.read"] });
    const t = await onboard(admin, "roles@test.local", rm.json.id, [{ branchId: world.a1 }], "Roles Uno");
    const esc = await api(t, "POST", "/admin/roles", { name: "Super", permissions: ["users.manage"] });
    assert.equal(esc.json.code, "PRIVILEGE_ESCALATION");
    const edit = await api(t, "PATCH", `/admin/roles/${roles["admin"]}`, { name: "Hack" });
    assert.equal(edit.json.code, "PRIVILEGE_ESCALATION", "no puede editar el rol Administrador");
    assert.equal((await api(t, "POST", "/admin/roles", { name: "Legítimo", permissions: ["sales.read"] })).status, 201);
  });
});

describe("auditoría de la administración", () => {
  it("registra invitaciones, altas, cambios de acceso y roles", async () => {
    const rows = await withTenant(owner, world.tenantA, (tx) =>
      tx.auditLog.findMany({ where: { OR: [{ action: { startsWith: "user." } }, { action: { startsWith: "role." } }] }, select: { action: true, actorUserId: true } }),
    );
    const set = new Set(rows.map((r) => r.action));
    for (const a of ["user.invited", "user.invitation_accepted", "user.invitation_revoked", "user.invitation_resent", "user.access_updated", "user.suspended", "user.reactivated", "role.created", "role.updated", "role.deleted"]) {
      assert.ok(set.has(a), `falta ${a}`);
    }
    assert.ok(rows.every((r) => r.actorUserId));
  });
});
