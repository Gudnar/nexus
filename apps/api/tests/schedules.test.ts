import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { uuidv7, withTenant } from "@erp/db";
import { Clock } from "../src/access/clock";
import { DevMailbox } from "../src/mail/mail.service";
import { RateLimiter } from "../src/security/rate-limiter";
import { call, owner, PW, setup, teardown, tokenFor, world } from "./support";

let admin: string;
let clock: Clock;
const LPZ = (local: string) => new Date(`${local}:00-04:00`); // La Paz = UTC-4
const MON_9 = "2026-11-23T09:00"; // lunes
const MON_20 = "2026-11-23T20:00";
const SAT_10 = "2026-11-28T10:00";

before(async () => {
  await setup();
  clock = world.app.get(Clock);
  admin = await tokenFor("admin.a@test.local");
});
after(teardown);
beforeEach(() => world.app.get(RateLimiter).reset());
afterEach(() => { clock.set(null); world.app.get(DevMailbox).clear(); });

type M = "GET" | "POST" | "PATCH" | "DELETE";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });
const login = (identifier: string, password = PW, tenant?: string) =>
  call("POST", "/api/v1/auth/login", { body: { identifier, password, tenant } });

const office = (over: object = {}) => ({
  name: "Oficina",
  rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "18:00" })),
  exceptions: [],
  ...over,
});
async function member(email: string) {
  return (await api(admin, "GET", "/admin/users")).json.find((u: { email: string }) => u.email === email);
}
async function assign(email: string, scheduleId: string | null) {
  const m = await member(email);
  const r = await api(admin, "PATCH", `/admin/users/${m.membershipId}`, { scheduleId });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

describe("administración de horarios", () => {
  it("crea un horario y lo lista con zona efectiva, ventanas en HH:MM y miembros", async () => {
    const r = await api(admin, "POST", "/admin/schedules", office({ exceptions: [{ date: "2026-12-25", type: "BLOCK", reason: "Navidad" }] }));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.effectiveTimezone, "America/La_Paz");
    assert.equal(r.json.timezone, null);
    assert.deepEqual(r.json.rules[0], { weekday: 1, start: "08:00", end: "18:00" });
    assert.deepEqual(r.json.exceptions[0], { date: "2026-12-25", type: "BLOCK", start: null, end: null, reason: "Navidad" });
    const list = (await api(admin, "GET", "/admin/schedules")).json;
    assert.equal(list.length, 1);
    assert.equal(list[0].members, 0);
  });

  it("valida horas, días, zona horaria y nombres repetidos", async () => {
    const bad = (over: object) => api(admin, "POST", "/admin/schedules", office({ name: `X${uuidv7().slice(-6)}`, ...over }));
    assert.equal((await bad({ rules: [{ weekday: 1, start: "8:00", end: "18:00" }] })).status, 400);
    assert.equal((await bad({ rules: [{ weekday: 1, start: "25:00", end: "18:00" }] })).status, 400);
    assert.equal((await bad({ rules: [{ weekday: 1, start: "08:00", end: "08:00" }] })).status, 400);
    assert.equal((await bad({ rules: [{ weekday: 8, start: "08:00", end: "18:00" }] })).status, 400);
    assert.equal((await bad({ exceptions: [{ date: "2026-12-25", type: "ALLOW", start: "09:00" }] })).status, 400);
    assert.equal((await bad({ exceptions: [{ date: "25/12/2026", type: "BLOCK" }] })).status, 400);
    assert.equal((await bad({ timezone: "Mars/Olympus" })).json.code, "INVALID_TIMEZONE");
    assert.equal((await api(admin, "POST", "/admin/schedules", office())).json.code, "NAME_TAKEN");
  });

  it("edita (reemplaza ventanas) y elimina uno sin uso", async () => {
    const c = await api(admin, "POST", "/admin/schedules", office({ name: "Temporal" }));
    const u = await api(admin, "PATCH", `/admin/schedules/${c.json.id}`, {
      name: "Temporal 2", timezone: "America/Lima", rules: [{ weekday: 6, start: "09:00", end: "13:00" }],
    });
    assert.equal(u.status, 200);
    assert.deepEqual(u.json.rules, [{ weekday: 6, start: "09:00", end: "13:00" }]);
    assert.equal(u.json.effectiveTimezone, "America/Lima");
    assert.equal((await api(admin, "DELETE", `/admin/schedules/${c.json.id}`)).status, 204);
    assert.equal((await api(admin, "DELETE", `/admin/schedules/${c.json.id}`)).status, 404);
  });

  it("solo quien administra usuarios modifica; leer exige permiso; cada empresa ve los suyos", async () => {
    const manager = await tokenFor("multi@test.local", "empresa-a");
    assert.equal((await api(manager, "GET", "/admin/schedules")).status, 200);
    assert.equal((await api(manager, "POST", "/admin/schedules", office({ name: "Otro" }))).status, 403);
    assert.equal((await api(await tokenFor("cajero@test.local"), "GET", "/admin/schedules")).status, 403);
    const b = await tokenFor("admin.b@test.local");
    assert.deepEqual((await api(b, "GET", "/admin/schedules")).json, []);
  });
});

describe("aplicación del horario (login, sesión y renovación)", () => {
  let officeId: string;
  before(async () => {
    officeId = (await api(admin, "GET", "/admin/schedules")).json.find((s: { name: string }) => s.name === "Oficina").id;
    await assign("cajero@test.local", officeId);
  });

  it("dentro del horario entra; fuera de horario se rechaza con la próxima apertura", async () => {
    clock.set(LPZ(MON_9));
    assert.equal((await login("cajero1")).status, 200);

    clock.set(LPZ(MON_20));
    const r = await login("cajero1");
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "OUTSIDE_SCHEDULE");
    assert.match(r.json.detail, /mañana a las 08:00 \(hora de America\/La_Paz\)/);

    clock.set(LPZ(SAT_10));
    assert.match((await login("cajero1")).json.detail, /el lunes a las 08:00/);
  });

  it("la contraseña incorrecta no revela el horario (se rechaza antes)", async () => {
    clock.set(LPZ(MON_20));
    const r = await login("cajero1", "incorrecta");
    assert.equal(r.status, 401);
    assert.equal(r.json.code, "INVALID_CREDENTIALS");
  });

  it("una sesión abierta deja de servir al salir del horario, y no se puede renovar", async () => {
    clock.set(LPZ(MON_9));
    const l = await login("cajero1");
    assert.equal((await call("GET", "/api/v1/me", { token: l.json.accessToken })).status, 200);

    clock.set(LPZ("2026-11-23T18:00")); // el fin es exclusivo
    const denied = await call("GET", "/api/v1/me", { token: l.json.accessToken });
    assert.equal(denied.status, 403);
    assert.equal(denied.json.code, "OUTSIDE_SCHEDULE");
    const refresh = await call("POST", "/api/v1/auth/refresh", { body: { refreshToken: l.json.refreshToken } });
    assert.equal(refresh.status, 403);

    clock.set(LPZ("2026-11-24T08:00")); // mañana a la apertura: el mismo token vuelve a servir
    assert.equal((await call("GET", "/api/v1/me", { token: l.json.accessToken })).status, 200);
  });

  it("quien no tiene horario no tiene restricción", async () => {
    clock.set(LPZ("2026-11-28T03:00"));
    assert.equal((await login("admin_a")).status, 200);
    assert.equal((await login("multiuser", PW, "empresa-a")).status, 200);
  });

  it("quitar el horario devuelve el acceso", async () => {
    clock.set(LPZ(MON_20));
    assert.equal((await login("cajero1")).status, 403);
    assert.equal((await assign("cajero@test.local", null)).schedule, null);
    assert.equal((await login("cajero1")).status, 200);
    await assign("cajero@test.local", officeId);
  });
});

describe("excepciones, turnos nocturnos y zonas", () => {
  it("un acceso extraordinario (ALLOW) abre un sábado; un feriado (BLOCK) cierra un lunes", async () => {
    const s = await api(admin, "POST", "/admin/schedules", office({
      name: "Con excepciones",
      exceptions: [
        { date: "2026-11-28", type: "ALLOW", start: "09:00", end: "13:00", reason: "Inventario" },
        { date: "2026-11-23", type: "BLOCK", reason: "Feriado" },
      ],
    }));
    await assign("cajero@test.local", s.json.id);
    clock.set(LPZ(SAT_10));
    assert.equal((await login("cajero1")).status, 200);
    clock.set(LPZ("2026-11-28T13:00"));
    assert.equal((await login("cajero1")).status, 403);
    clock.set(LPZ("2026-11-23T10:00")); // lunes feriado
    assert.equal((await login("cajero1")).status, 403);
    clock.set(LPZ("2026-11-24T10:00"));
    assert.equal((await login("cajero1")).status, 200);
  });

  it("un turno nocturno (vie 22:00 → sáb 06:00) cubre la madrugada del sábado", async () => {
    const s = await api(admin, "POST", "/admin/schedules", {
      name: "Noche", rules: [{ weekday: 5, start: "22:00", end: "06:00" }], exceptions: [],
    });
    await assign("cajero@test.local", s.json.id);
    clock.set(LPZ("2026-11-27T23:00"));
    assert.equal((await login("cajero1")).status, 200);
    clock.set(LPZ("2026-11-28T02:00"));
    assert.equal((await login("cajero1")).status, 200);
    clock.set(LPZ("2026-11-28T06:00"));
    assert.equal((await login("cajero1")).status, 403);
    clock.set(LPZ("2026-11-27T03:00")); // madrugada del viernes: no
    assert.equal((await login("cajero1")).status, 403);
  });

  it("la zona del horario manda sobre la de la empresa", async () => {
    // Lima es UTC-5: 13:30Z = 08:30 en Lima (antes de las 09:00) y 14:00Z = 09:00
    const s = await api(admin, "POST", "/admin/schedules", {
      name: "Lima", timezone: "America/Lima", rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
    });
    await assign("cajero@test.local", s.json.id);
    clock.set(new Date("2026-11-23T13:30:00Z"));
    assert.equal((await login("cajero1")).status, 403);
    clock.set(new Date("2026-11-23T14:00:00Z"));
    assert.equal((await login("cajero1")).status, 200);
  });

  it("un horario sin ventanas bloquea siempre", async () => {
    const s = await api(admin, "POST", "/admin/schedules", { name: "Cerrado", rules: [] });
    await assign("cajero@test.local", s.json.id);
    clock.set(LPZ(MON_9));
    const r = await login("cajero1");
    assert.equal(r.status, 403);
    assert.match(r.json.detail, /No hay un horario de acceso próximo/);
  });
});

describe("asignación", () => {
  it("nadie se asigna un horario a sí mismo", async () => {
    const me = await member("admin.a@test.local");
    const r = await api(admin, "PATCH", `/admin/users/${me.membershipId}`, { scheduleId: null });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "SELF_CHANGE");
  });

  it("horario inexistente o de otra empresa: 404; en uso no se elimina", async () => {
    const m = await member("multi@test.local");
    assert.equal((await api(admin, "PATCH", `/admin/users/${m.membershipId}`, { scheduleId: uuidv7() })).status, 404);
    const b = await tokenFor("admin.b@test.local");
    const other = await api(b, "POST", "/admin/schedules", office({ name: "De B" }));
    assert.equal((await api(admin, "PATCH", `/admin/users/${m.membershipId}`, { scheduleId: other.json.id })).status, 404);

    const inUse = (await api(admin, "GET", "/admin/schedules")).json.find((s: { members: number }) => s.members > 0);
    const del = await api(admin, "DELETE", `/admin/schedules/${inUse.id}`);
    assert.equal(del.status, 409);
    assert.equal(del.json.code, "SCHEDULE_IN_USE");
  });

  it("el listado de usuarios muestra el horario y todo queda auditado", async () => {
    const u = await member("cajero@test.local");
    assert.ok(u.schedule?.name);
    const actions = await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ where: { action: { startsWith: "schedule." } }, select: { action: true } }));
    const set = new Set(actions.map((a) => a.action));
    for (const a of ["schedule.created", "schedule.updated", "schedule.deleted"]) assert.ok(set.has(a), a);
  });

  it("las restricciones de la base rechazan ventanas inválidas", async () => {
    const sid = (await api(admin, "GET", "/admin/schedules")).json[0].id;
    const insert = (w: number, s: number, e: number) =>
      withTenant(owner, world.tenantA, (tx) =>
        tx.$executeRawUnsafe(`INSERT INTO schedule_rule (id, tenant_id, schedule_id, weekday, start_minute, end_minute) VALUES ('${uuidv7()}', '${world.tenantA}', '${sid}', ${w}, ${s}, ${e})`),
      );
    await assert.rejects(insert(0, 480, 1080));
    await assert.rejects(insert(1, 480, 480));
    await assert.rejects(insert(1, 1440, 100));
  });
});
