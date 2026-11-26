import "reflect-metadata";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET ??= "secreto-de-pruebas-de-al-menos-32-caracteres!!";
process.env.MFA_ENCRYPTION_KEY ??= "clave-de-pruebas-para-cifrar-secretos-mfa!!";
process.env.LOGIN_MAX_FAILURES = "3";
process.env.LOGIN_RATE_PER_MIN = "100000";
process.env.MAIL_TRANSPORT = "log";
process.env.OUTBOX_AUTOSTART = "false"; // las pruebas invocan runOnce() a mano
process.env.OUTBOX_MAX_ATTEMPTS = "3";
if (!process.env.DATABASE_URL || !process.env.DIRECT_URL || !process.env.PLATFORM_DATABASE_URL) {
  throw new Error("Define DATABASE_URL (erp_app), DIRECT_URL (erp_owner) y PLATFORM_DATABASE_URL (erp_platform) para las pruebas");
}


// Las pruebas VACÍAN la base (TRUNCATE). Para no perder los datos de trabajo, solo corren contra una base cuyo nombre termina en
// «_test» (ver infra/setup-test-db.sql), o si se declara expresamente que es descartable (CI: ALLOW_DESTRUCTIVE_TESTS=1).
{
  const dbName = new URL(process.env.DIRECT_URL ?? "postgresql://x/x").pathname.slice(1);
  if (!dbName.endsWith("_test") && process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`Las pruebas borran la base y «${dbName}» no termina en _test. Usa la base de pruebas (erp_test) o define ALLOW_DESTRUCTIVE_TESTS=1 si es descartable.`);
  }
}

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { addMember, createDb, provisionTenant, uuidv7, withTenant, type Db } from "@erp/db";
import { AppModule } from "../src/app.module";
import { ExcelBodyLimit } from "../src/excel/limits";
import { PasswordService } from "../src/auth/password.service";
import { DevMailbox } from "../src/mail/mail.service";
import { RateLimiter } from "../src/security/rate-limiter";

export const PW = "Clave-Segura-123";
export const PLATFORM_EMAIL = "super@nexus.test";
export const PLATFORM_PW = "Plataforma-Segura-456";
export const owner: Db = createDb(process.env.DIRECT_URL);
export const platformDb: Db = createDb(process.env.PLATFORM_DATABASE_URL);

export const world = {} as {
  app: NestFastifyApplication;
  tenantA: string; tenantB: string;
  a1: string; a2: string; a3: string; b1: string;
};

export interface Res { status: number; json: any; type: string }

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

export async function call(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Res> {
  const r = await world.app.inject({
    method, url, payload: opts.body as object | undefined,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
  });
  return { status: r.statusCode, json: r.body ? safeJson(r.body) : undefined, type: String(r.headers["content-type"] ?? "") };
}

export const login = (email: string, tenant?: string) =>
  call("POST", "/api/v1/auth/login", { body: { identifier: email, password: PW, tenant } });

/** Inicia sesión con cualquier contraseña y devuelve el token de acceso. */
export async function loginAs(identifier: string, password: string, tenant?: string): Promise<string> {
  const r = await call("POST", "/api/v1/auth/login", { body: { identifier, password, tenant } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.accessToken;
}

export async function tokenFor(email: string, tenant?: string): Promise<string> {
  const r = await login(email, tenant);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.accessToken;
}

/**
 * Levanta la app y siembra: tenant A (sucursales A1 central, A2, A3) con admin.a (todas),
 * multi (gerente en A1+A2, y cajero en B) y cajero (solo A1); tenant B (B1) con admin.b.
 */
export async function setup(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  world.app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ bodyLimit: ExcelBodyLimit }));
  await world.app.init();
  await world.app.getHttpAdapter().getInstance().ready();

  const hash = await world.app.get(PasswordService).hash(PW);
  await owner.$executeRawUnsafe(
    `TRUNCATE tenant_setting, sequence, idempotency_record, outbox_event, audit_log,
              user_branch_access, user_role, role_permission, role, membership, branch,
              session, one_time_token, mfa_recovery_code, registration_request, platform_setting,
              platform_user, app_user, tenant RESTART IDENTITY CASCADE`,
  );
  const A = await provisionTenant(owner, {
    slug: "empresa-a", legalName: "Empresa A", mainBranch: { code: "A1", name: "Central A" },
    admin: { email: "admin.a@test.local", name: "Admin A", passwordHash: hash },
  });
  const B = await provisionTenant(owner, {
    slug: "empresa-b", legalName: "Empresa B", mainBranch: { code: "B1", name: "Central B" },
    admin: { email: "admin.b@test.local", name: "Admin B", passwordHash: hash },
  });
  const [a2, a3] = await withTenant(owner, A.tenantId, async (tx) => {
    const x = [uuidv7(), uuidv7()] as const;
    await tx.branch.create({ data: { id: x[0], tenantId: A.tenantId, code: "A2", name: "Norte A" } });
    await tx.branch.create({ data: { id: x[1], tenantId: A.tenantId, code: "A3", name: "Sur A" } });
    return x;
  });
  await addMember(owner, { tenantId: A.tenantId, email: "multi@test.local", name: "Multi", passwordHash: hash, roleCode: "manager", branches: [{ branchId: A.branchId }, { branchId: a2 }] });
  await addMember(owner, { tenantId: B.tenantId, email: "multi@test.local", name: "Multi", passwordHash: hash, roleCode: "cashier", branches: [{ branchId: B.branchId }] });
  await addMember(owner, { tenantId: A.tenantId, email: "cajero@test.local", name: "Cajero", passwordHash: hash, roleCode: "cashier", branches: [{ branchId: A.branchId }] });
  // Alias de acceso (usuario) para el login por username.
  for (const [email, username] of [["admin.a@test.local", "admin_a"], ["multi@test.local", "multiuser"], ["cajero@test.local", "cajero1"], ["admin.b@test.local", "admin_b"]] as const) {
    await owner.user.update({ where: { email }, data: { username } });
  }
  await platformDb.platformUser.create({
    data: { id: uuidv7(), email: PLATFORM_EMAIL, passwordHash: await world.app.get(PasswordService).hash(PLATFORM_PW), role: "SUPER_ADMIN" },
  });
  world.app.get(RateLimiter).reset();
  world.app.get(DevMailbox).clear();
  Object.assign(world, { tenantA: A.tenantId, tenantB: B.tenantId, a1: A.branchId, a2, a3, b1: B.branchId });
}

export async function teardown(): Promise<void> {
  await world.app.close();
  await owner.$disconnect();
  await platformDb.$disconnect();
}
