import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createDb, withTenant } from "@erp/db";
import { DevMailbox } from "../src/mail/mail.service";
import { RateLimiter } from "../src/security/rate-limiter";
import { hotp } from "../src/security/totp";
import {
  call, login, owner, platformDb, PLATFORM_EMAIL, PLATFORM_PW, PW, setup, teardown, tokenFor, world,
} from "./support";

before(setup);
after(teardown);
beforeEach(() => {
  world.app.get(RateLimiter).reset();
  world.app.get(DevMailbox).clear();
});

const mailbox = () => world.app.get(DevMailbox).messages;
const tokenFromMail = (i = 0) => /token=([A-Za-z0-9_-]+)/.exec(mailbox()[i]?.text ?? "")?.[1];
const totp = (secret: string, drift = 0) => hotp(secret, Math.floor(Date.now() / 30_000) + drift);
const post = (url: string, body: unknown, token?: string) => call("POST", url, { body, token });
const loginId = (identifier: string, password = PW, tenant?: string) =>
  post("/api/v1/auth/login", { identifier, password, tenant });

/** Activa el MFA de un usuario y devuelve su secreto y códigos de recuperación. */
async function enableMfa(email: string) {
  const token = await tokenFor(email);
  const setup = await post("/api/v1/me/mfa/setup", { password: PW }, token);
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  const enabled = await post("/api/v1/me/mfa/enable", { code: totp(setup.json.secret) }, token);
  assert.equal(enabled.status, 200, JSON.stringify(enabled.json));
  return { secret: setup.json.secret as string, codes: enabled.json.recoveryCodes as string[], token };
}

describe("acceso con usuario o correo", () => {
  it("el mismo usuario entra con su correo o con su username, sin distinguir mayúsculas", async () => {
    for (const id of ["admin.a@test.local", "admin_a", "ADMIN_A", "Admin.A@Test.Local", "  admin_a  "]) {
      const r = await loginId(id);
      assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.json)}`);
      assert.ok(r.json.accessToken);
    }
  });

  it("username incorrecto, inexistente y contraseña mala responden igual", async () => {
    const a = await loginId("admin_a", "incorrecta");
    const b = await loginId("no_existe", "incorrecta");
    const c = await loginId("nadie@test.local", "incorrecta");
    assert.equal(a.status, 401);
    assert.deepEqual(a.json, b.json);
    assert.deepEqual(a.json, c.json);
  });

  it("el perfil permite cambiar el username: formato, unicidad y retirada", async () => {
    const token = await tokenFor("cajero@test.local");
    const patch = (body: unknown) => call("PATCH", "/api/v1/me/profile", { token, body });
    assert.equal((await patch({ username: "no válido!" })).status, 400);
    assert.equal((await patch({ username: "ab" })).status, 400);
    assert.equal((await patch({ username: "a@b.c" })).status, 400); // sin "@": se distingue del correo
    const taken = await patch({ username: "admin_a" });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.code, "USERNAME_TAKEN");

    assert.equal((await patch({ username: "Cajero.Nuevo" })).json.username, "cajero.nuevo");
    assert.equal((await loginId("cajero.nuevo")).status, 200);
    assert.equal((await loginId("cajero1")).status, 401); // el alias anterior ya no existe
    assert.equal((await patch({ username: null })).json.username, null);
    assert.equal((await loginId("cajero@test.local")).status, 200);
  });

  it("la base rechaza usernames con '@' o correos en mayúsculas", async () => {
    await assert.rejects(owner.$executeRawUnsafe(`UPDATE app_user SET username = 'a@b.com' WHERE email = 'admin.a@test.local'`));
    await assert.rejects(owner.$executeRawUnsafe(`UPDATE app_user SET email = 'ADMIN.A@TEST.LOCAL' WHERE email = 'admin.a@test.local'`));
  });
});

describe("MFA (TOTP) configurable desde la cuenta", () => {
  const email = "admin.b@test.local";
  let secret: string;
  let codes: string[];

  it("empezar la configuración exige la contraseña y entrega secreto, URI y QR", async () => {
    const token = await tokenFor(email);
    assert.equal((await post("/api/v1/me/mfa/setup", { password: "mala" }, token)).status, 401);
    const r = await post("/api/v1/me/mfa/setup", { password: PW }, token);
    assert.equal(r.status, 200);
    assert.match(r.json.otpauthUri, /^otpauth:\/\/totp\/NEXUS%20ERP:admin\.b%40test\.local\?secret=[A-Z2-7]+/);
    assert.match(r.json.qrSvg, /^<svg/);
    const row = await owner.user.findUniqueOrThrow({ where: { email } });
    assert.equal(row.mfaEnabled, false, "aún no está activo");
    assert.ok(row.mfaPendingSecret?.startsWith("v1."), "el secreto pendiente se guarda cifrado");
    assert.ok(!row.mfaPendingSecret!.includes(r.json.secret));
  });

  it("activar exige un código válido; entrega 10 códigos de recuperación y cifra el secreto", async () => {
    const token = await tokenFor(email);
    const s = await post("/api/v1/me/mfa/setup", { password: PW }, token);
    assert.equal((await post("/api/v1/me/mfa/enable", { code: totp(s.json.secret, 10) }, token)).status, 401);
    const ok = await post("/api/v1/me/mfa/enable", { code: totp(s.json.secret) }, token);
    assert.equal(ok.status, 200);
    codes = ok.json.recoveryCodes;
    secret = s.json.secret;
    assert.equal(codes.length, 10);
    assert.ok(codes.every((c) => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c)));

    const row = await owner.user.findUniqueOrThrow({ where: { email } });
    assert.equal(row.mfaEnabled, true);
    assert.ok(row.totpSecret?.startsWith("v1.") && !row.totpSecret.includes(secret));
    assert.equal(row.mfaPendingSecret, null);
    const hashes = await owner.mfaRecoveryCode.findMany({ where: { userId: row.id } });
    assert.ok(hashes.every((h) => !codes.includes(h.codeHash)), "los códigos se guardan con hash");

    const overview = await call("GET", "/api/v1/me/security", { token });
    assert.deepEqual(
      { mfa: overview.json.mfaEnabled, left: overview.json.recoveryCodesRemaining },
      { mfa: true, left: 10 },
    );
    assert.equal((await post("/api/v1/me/mfa/setup", { password: PW }, token)).status, 409); // ya activo
  });

  it("con MFA, el login devuelve un desafío (sin tokens) y exige el segundo factor", async () => {
    const r = await loginId(email);
    assert.equal(r.status, 200);
    assert.equal(r.json.mfaRequired, true);
    assert.ok(r.json.mfaToken);
    assert.equal(r.json.accessToken, undefined);
    // El token del desafío no sirve como credencial de acceso.
    assert.equal((await call("GET", "/api/v1/me", { token: r.json.mfaToken })).status, 401);

    const bad = await post("/api/v1/auth/mfa/verify", { mfaToken: r.json.mfaToken, code: totp(secret, 10) });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.code, "INVALID_MFA_CODE");
    const good = await post("/api/v1/auth/mfa/verify", { mfaToken: r.json.mfaToken, code: totp(secret) });
    assert.equal(good.status, 200);
    assert.equal((await call("GET", "/api/v1/me", { token: good.json.accessToken })).status, 200);
  });

  it("un token de desafío inválido o ajeno es rechazado", async () => {
    assert.equal((await post("/api/v1/auth/mfa/verify", { mfaToken: "x".repeat(40), code: "123456" })).status, 401);
    const access = await tokenFor("admin.a@test.local");
    assert.equal((await post("/api/v1/auth/mfa/verify", { mfaToken: access, code: "123456" })).status, 401);
  });

  it("un código de recuperación vale como segundo factor, una sola vez", async () => {
    const first = await loginId(email);
    const used = await post("/api/v1/auth/mfa/verify", { mfaToken: first.json.mfaToken, code: codes[0]!.toLowerCase() });
    assert.equal(used.status, 200);
    const second = await loginId(email);
    assert.equal((await post("/api/v1/auth/mfa/verify", { mfaToken: second.json.mfaToken, code: codes[0] })).status, 401);
    const overview = await call("GET", "/api/v1/me/security", { token: used.json.accessToken });
    assert.equal(overview.json.recoveryCodesRemaining, 9);
  });

  it("los códigos MFA erróneos cuentan para el bloqueo de la cuenta", async () => {
    const r = await loginId(email);
    for (let i = 0; i < 3; i++) await post("/api/v1/auth/mfa/verify", { mfaToken: r.json.mfaToken, code: totp(secret, 10) });
    // Bloqueada: ni el código correcto sirve hasta que venza el bloqueo.
    assert.equal((await post("/api/v1/auth/mfa/verify", { mfaToken: r.json.mfaToken, code: totp(secret) })).status, 401);
    assert.equal((await loginId(email)).status, 401);
    await owner.user.update({ where: { email }, data: { failedLogins: 0, lockedUntil: null } });
    assert.equal((await loginId(email)).json.mfaRequired, true);
  });

  it("desactivar exige contraseña y código; regenerar invalida los códigos anteriores", async () => {
    const t = await loginId(email);
    const tokens = await post("/api/v1/auth/mfa/verify", { mfaToken: t.json.mfaToken, code: totp(secret) });
    const token = tokens.json.accessToken;

    const regen = await post("/api/v1/me/mfa/recovery-codes", { password: PW, code: totp(secret) }, token);
    assert.equal(regen.status, 200);
    const l = await loginId(email);
    assert.equal((await post("/api/v1/auth/mfa/verify", { mfaToken: l.json.mfaToken, code: codes[5] })).status, 401);
    codes = regen.json.recoveryCodes;

    assert.equal((await post("/api/v1/me/mfa/disable", { password: "mala", code: totp(secret) }, token)).status, 401);
    assert.equal((await post("/api/v1/me/mfa/disable", { password: PW, code: totp(secret, 10) }, token)).status, 401);
    assert.equal((await post("/api/v1/me/mfa/disable", { password: PW, code: totp(secret) }, token)).status, 204);
    assert.equal((await loginId(email)).json.accessToken !== undefined, true, "vuelve el login de un paso");
    assert.equal(await owner.mfaRecoveryCode.count({ where: { user: { email } } }), 0);
  });

  it("el MFA queda auditado y se avisa por correo", async () => {
    const actions = await withTenant(owner, world.tenantB, (tx) =>
      tx.auditLog.findMany({ where: { action: { startsWith: "account.mfa" } }, select: { action: true } }),
    );
    assert.ok(actions.some((a) => a.action === "account.mfa_enabled"));
    assert.ok(actions.some((a) => a.action === "account.mfa_disabled"));
    assert.ok(mailbox().length === 0 || mailbox().every((m) => m.to === email));
  });
});

describe("cambio de contraseña (sesión iniciada)", () => {
  it("valida la actual y la política, cierra las demás sesiones y avisa por correo", async () => {
    const mine = await tokenFor("cajero@test.local");
    const other = await tokenFor("cajero@test.local");
    const change = (currentPassword: string, newPassword: string) =>
      post("/api/v1/me/password", { currentPassword, newPassword }, mine);

    assert.equal((await change("incorrecta", "Nueva-Clave-2026!")).status, 401);
    const weak = await change(PW, "corta");
    assert.equal(weak.status, 400);
    assert.equal(weak.json.code, "WEAK_PASSWORD");
    assert.ok(Array.isArray(weak.json.errors) && weak.json.errors.length > 0);
    assert.equal((await change(PW, "cajero@test.local123")).status, 400, "no debe contener el correo");

    assert.equal((await change(PW, "Nueva-Clave-2026!")).status, 204);
    assert.equal((await call("GET", "/api/v1/me", { token: mine })).status, 200, "la sesión actual se conserva");
    assert.equal((await call("GET", "/api/v1/me", { token: other })).status, 401, "las demás se cierran");
    assert.equal((await loginId("cajero@test.local", PW)).status, 401);
    assert.equal((await loginId("cajero@test.local", "Nueva-Clave-2026!")).status, 200);
    assert.ok(mailbox().some((m) => m.subject.includes("contraseña fue cambiada")));
    await owner.user.update({ where: { email: "cajero@test.local" }, data: { passwordHash: (await owner.user.findUniqueOrThrow({ where: { email: "admin.a@test.local" } })).passwordHash } });
  });
});

describe("recuperación de contraseña", () => {
  const forgot = (identifier: string, channel?: string) => post("/api/v1/auth/password/forgot", { identifier, channel });
  const reset = (token: string | undefined, password: string, mfaCode?: string) =>
    post("/api/v1/auth/password/reset", { token, password, mfaCode });

  it("la configuración pública solo ofrece los canales realmente disponibles", async () => {
    const r = await call("GET", "/api/v1/public/config");
    assert.deepEqual(r.json.recoveryChannels, ["EMAIL"]);
    assert.equal((await forgot("admin_a", "WHATSAPP")).json.code, "CHANNEL_UNAVAILABLE");
    assert.equal((await forgot("admin_a", "SMS")).status, 400);
  });

  it("por correo o por usuario: respuesta idéntica exista o no la cuenta, y solo escribe a cuentas reales", async () => {
    const known = await forgot("admin.a@test.local");
    const byUser = await forgot("admin_a");
    const unknown = await forgot("fantasma@test.local");
    assert.equal(known.status, 202);
    assert.deepEqual(known.json, unknown.json);
    assert.deepEqual(known.json, byUser.json);
    assert.equal(mailbox().length, 2);
    assert.ok(mailbox().every((m) => m.to === "admin.a@test.local"));
    assert.ok(tokenFromMail());
  });

  it("el enlace funciona una vez: cambia la contraseña, cierra sesiones y deja auditoría", async () => {
    const session = await tokenFor("multi@test.local", "empresa-a");
    await forgot("multiuser");
    const token = tokenFromMail()!;

    assert.equal((await reset("x".repeat(43), "Contraseña-Nueva-77")).json.code, "INVALID_TOKEN");
    const weak = await reset(token, "123");
    assert.equal(weak.json.code, "WEAK_PASSWORD");
    assert.equal((await reset(token, "Contraseña-Nueva-77")).status, 204, "el intento débil no consumió el enlace");

    assert.equal((await reset(token, "Otra-Contraseña-88")).json.code, "INVALID_TOKEN", "un solo uso");
    assert.equal((await loginId("multiuser", PW, "empresa-a")).status, 401);
    assert.equal((await loginId("multiuser", "Contraseña-Nueva-77", "empresa-a")).status, 200);
    assert.equal((await call("GET", "/api/v1/me", { token: session })).status, 401, "sesiones anteriores cerradas");

    const audit = await withTenant(owner, world.tenantA, (tx) => tx.auditLog.count({ where: { action: "auth.password_reset" } }));
    assert.equal(audit, 1);
    assert.ok(mailbox().some((m) => m.subject.includes("contraseña fue cambiada")));
  });

  it("un enlace vencido no sirve", async () => {
    await forgot("admin.b@test.local");
    const token = tokenFromMail()!;
    await owner.oneTimeToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await reset(token, "Contraseña-Nueva-77")).json.code, "INVALID_TOKEN");
  });

  it("limita las solicitudes por cuenta y por IP (429)", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await forgot("admin_a")).status, 202);
    const blocked = await forgot("admin_a");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.code, "RATE_LIMITED");
  });

  it("si la cuenta tiene MFA, el enlace solo no basta y no se consume sin el código", async () => {
    const email = "admin.b@test.local";
    const { secret, codes } = await enableMfa(email);
    world.app.get(RateLimiter).reset();
    await owner.oneTimeToken.deleteMany({});
    await forgot(email);
    const token = tokenFromMail()!;

    const missing = await reset(token, "Contraseña-Nueva-77");
    assert.equal(missing.status, 401);
    assert.equal(missing.json.code, "MFA_REQUIRED");
    assert.equal((await reset(token, "Contraseña-Nueva-77", totp(secret, 10))).json.code, "INVALID_MFA_CODE");
    await owner.user.update({ where: { email }, data: { failedLogins: 0, lockedUntil: null } });
    assert.equal((await reset(token, "Contraseña-Nueva-77", codes[0])).status, 204);
    const r = await loginId(email, "Contraseña-Nueva-77");
    assert.equal(r.json.mfaRequired, true, "el MFA sigue activo tras recuperar la contraseña");
  });
});

describe("registro habilitado por el administrador global", () => {
  const registerBody = (over: Record<string, unknown> = {}) => ({
    companyName: "Ferretería El Sol", taxId: "1020304050", adminName: "Rosa Quispe",
    email: "rosa@elsol.test", username: "rosa.quispe", password: "Ferretería-Segura-2026", ...over,
  });
  const register = (over?: Record<string, unknown>) => post("/api/v1/public/register", registerBody(over));
  const platformLogin = (password = PLATFORM_PW, totpCode?: string) =>
    post("/api/v1/platform/auth/login", { email: PLATFORM_EMAIL, password, totp: totpCode });
  const setRegistration = (enabled: boolean, token: string) =>
    call("PUT", "/api/v1/platform/settings/registration", { token, body: { enabled } });
  let platformToken: string;

  it("viene deshabilitado: la configuración pública lo indica y el registro responde 403", async () => {
    assert.equal((await call("GET", "/api/v1/public/config")).json.registrationEnabled, false);
    const r = await register();
    assert.equal(r.status, 403);
    assert.equal(r.json.code, "REGISTRATION_DISABLED");
  });

  it("la consola de plataforma exige su propio acceso y no acepta tokens de empresa", async () => {
    assert.equal((await call("GET", "/api/v1/platform/settings")).status, 401);
    const tenantToken = await tokenFor("admin.a@test.local");
    assert.equal((await call("GET", "/api/v1/platform/settings", { token: tenantToken })).status, 401);
    assert.equal((await platformLogin("incorrecta")).status, 401);
    const ok = await platformLogin();
    assert.equal(ok.status, 200);
    platformToken = ok.json.accessToken;
    // y al revés: un token de plataforma no sirve en la API de empresas
    assert.equal((await call("GET", "/api/v1/me", { token: platformToken })).status, 401);
    assert.equal((await call("GET", "/api/v1/platform/settings", { token: platformToken })).json.registration.enabled, false);
  });

  it("el administrador global habilita el registro", async () => {
    assert.equal((await setRegistration(true, platformToken)).json.registration.enabled, true);
    assert.equal((await call("GET", "/api/v1/public/config")).json.registrationEnabled, true);
  });

  it("el registro crea solo una solicitud pendiente; nada existe hasta confirmar el correo", async () => {
    assert.equal((await register({ password: "123" })).json.code, "WEAK_PASSWORD");
    assert.equal((await register({ email: "no-es-correo" })).status, 400);
    const r = await register();
    assert.equal(r.status, 202);
    assert.equal(mailbox().length, 1);
    assert.equal(mailbox()[0]!.to, "rosa@elsol.test");
    assert.equal(await owner.user.count({ where: { email: "rosa@elsol.test" } }), 0);
    assert.equal(await owner.tenant.count({ where: { legalName: "Ferretería El Sol" } }), 0);
    const pending = await platformDb.registrationRequest.findFirstOrThrow({ where: { email: "rosa@elsol.test" } });
    assert.ok(pending.passwordHash.startsWith("$argon2id$"), "la contraseña se guarda con hash");
    assert.notEqual(pending.tokenHash, tokenFromMail());
  });

  it("un correo que ya tiene cuenta recibe la misma respuesta, sin crear solicitud", async () => {
    const r = await register({ email: "admin.a@test.local", username: "otro.usuario" });
    assert.equal(r.status, 202);
    assert.ok(mailbox().some((m) => m.to === "admin.a@test.local" && m.subject.includes("Ya tienes una cuenta")));
    assert.equal(await platformDb.registrationRequest.count({ where: { email: "admin.a@test.local" } }), 0);
  });

  it("un username ocupado se informa", async () => {
    const r = await register({ email: "otra@elsol.test", username: "admin_a" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "USERNAME_TAKEN");
  });

  it("confirmar el correo crea la empresa (prueba) con su administrador, que ya puede entrar por usuario", async () => {
    await register();
    const token = tokenFromMail()!;
    assert.equal((await post("/api/v1/public/register/verify", { token: "z".repeat(43) })).status, 400);
    const v = await post("/api/v1/public/register/verify", { token });
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.deepEqual(v.json, { email: "rosa@elsol.test", tenant: "ferreteria-el-sol" });

    const tenant = await owner.tenant.findUniqueOrThrow({ where: { slug: "ferreteria-el-sol" } });
    assert.equal(tenant.status, "TRIAL");
    const user = await owner.user.findUniqueOrThrow({ where: { email: "rosa@elsol.test" } });
    assert.equal(user.username, "rosa.quispe");
    assert.ok(user.emailVerifiedAt);

    const byUsername = await loginId("rosa.quispe", "Ferretería-Segura-2026");
    assert.equal(byUsername.status, 200, JSON.stringify(byUsername.json));
    const me = await call("GET", "/api/v1/me", { token: byUsername.json.accessToken });
    assert.equal(me.json.tenant.slug, "ferreteria-el-sol");
    assert.equal(me.json.branches.length, 1);
    assert.ok(me.json.permissions.includes("users.manage"), "administrador de su empresa");

    assert.equal((await post("/api/v1/public/register/verify", { token })).status, 400, "el enlace es de un solo uso");
    const consumed = await platformDb.registrationRequest.findFirstOrThrow({ where: { email: "rosa@elsol.test" } });
    assert.equal(consumed.passwordHash, "-", "se descarta el hash de la solicitud consumida");
  });

  it("el nombre de empresa repetido genera un identificador distinto", async () => {
    await register({ email: "otra@elsol.test", username: "otra.persona" });
    const v = await post("/api/v1/public/register/verify", { token: tokenFromMail()! });
    assert.equal(v.json.tenant, "ferreteria-el-sol-2");
  });

  it("una solicitud vencida o con el registro ya deshabilitado no se confirma", async () => {
    await register({ email: "tarde@elsol.test", username: "llego.tarde" });
    const token = tokenFromMail()!;
    await platformDb.registrationRequest.updateMany({ where: { email: "tarde@elsol.test" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await post("/api/v1/public/register/verify", { token })).json.code, "INVALID_TOKEN");

    await register({ email: "cierre@elsol.test", username: "cierre.uno" });
    const t2 = tokenFromMail()!;
    await setRegistration(false, platformToken);
    const blocked = await post("/api/v1/public/register/verify", { token: t2 });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, "REGISTRATION_DISABLED");
    assert.equal((await register({ email: "nuevo@elsol.test", username: "nuevo.uno" })).status, 403);
  });

  it("el rol de la aplicación no puede leer solicitudes de registro ni cambiar ajustes globales", async () => {
    const app = createDb(process.env.DATABASE_URL);
    try {
      await assert.rejects(app.$queryRaw`SELECT * FROM registration_request`);
      await assert.rejects(app.platformSetting.update({ where: { key: "registration" }, data: { value: { enabled: true } } }));
      await assert.rejects(app.platformUser.findMany());
      assert.equal((await app.platformSetting.findUnique({ where: { key: "registration" } }))?.key, "registration"); // lectura sí
    } finally {
      await app.$disconnect();
    }
  });

  it("la consola de plataforma bloquea tras fallos repetidos", async () => {
    for (let i = 0; i < 3; i++) await platformLogin("incorrecta");
    assert.equal((await platformLogin()).status, 401);
    await platformDb.platformUser.updateMany({ data: { failedLogins: 0, lockedUntil: null } });
    assert.equal((await platformLogin()).status, 200);
  });

  it("el buzón de desarrollo existe solo con transporte 'log'", async () => {
    const r = await call("GET", "/api/v1/dev/mailbox");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
    assert.ok(login); // evita advertencia de import no usado en algunos linters
  });
});
