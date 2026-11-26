import assert from "node:assert/strict";
import { addMember, createDb, provisionTenant, uuidv7, withTenant, type Db } from "../src";

if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
  throw new Error("Define DATABASE_URL (rol erp_app) y DIRECT_URL (rol erp_owner) para las pruebas");
}

// Las pruebas VACÍAN la base (TRUNCATE). Solo corren contra una base cuyo nombre termina en «_test» (infra/setup-test-db.sql)
// o si se declara que es descartable (CI: ALLOW_DESTRUCTIVE_TESTS=1). Así no se pierden los datos de trabajo.
{
  const dbName = new URL(process.env.DIRECT_URL).pathname.slice(1);
  if (!dbName.endsWith("_test") && process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`Las pruebas borran la base y «${dbName}» no termina en _test. Usa erp_test o define ALLOW_DESTRUCTIVE_TESTS=1 si es descartable.`);
  }
}

/** Rol de aplicación: sin BYPASSRLS ni DDL. */
export const app: Db = createDb(process.env.DATABASE_URL);
/** Rol propietario: solo siembra, limpieza y operaciones de plataforma. */
export const owner: Db = createDb(process.env.DIRECT_URL);

const HASH = "hash-de-prueba"; // el hashing real (argon2id) llega con el módulo de auth

export interface World {
  tenantA: string;
  tenantB: string;
  a: { branch1: string; branch2: string; branch3: string };
  b: { branch1: string };
  users: { adminA: string; multi: string; single: string; adminB: string };
  memberships: { adminA: string; multi: string; single: string; adminB: string };
}

/**
 * Hito §30, puntos 1-3: tenant A (3 sucursales) y tenant B (1 sucursal);
 * usuario con acceso global, multi-sucursal (A1+A2, y además miembro de B) y de sucursal única (A1).
 */
export async function seedWorld(): Promise<World> {
  await owner.$executeRawUnsafe(
    `TRUNCATE tenant_setting, sequence, idempotency_record, outbox_event, audit_log,
              user_branch_access, user_role, role_permission, role, membership, branch,
              session, app_user, tenant RESTART IDENTITY CASCADE`,
  );

  const A = await provisionTenant(owner, {
    slug: "empresa-a",
    legalName: "Empresa A S.R.L.",
    mainBranch: { code: "A1", name: "Central A" },
    admin: { email: "admin.a@test.local", name: "Admin A", passwordHash: HASH },
  });
  const B = await provisionTenant(owner, {
    slug: "empresa-b",
    legalName: "Empresa B S.A.",
    mainBranch: { code: "B1", name: "Central B" },
    admin: { email: "admin.b@test.local", name: "Admin B", passwordHash: HASH },
  });

  const [branch2, branch3] = await withTenant(owner, A.tenantId, async (tx) => {
    const ids = [uuidv7(), uuidv7()] as const;
    await tx.branch.create({ data: { id: ids[0], tenantId: A.tenantId, code: "A2", name: "Norte A" } });
    await tx.branch.create({ data: { id: ids[1], tenantId: A.tenantId, code: "A3", name: "Sur A" } });
    return ids;
  });

  const multi = await addMember(owner, {
    tenantId: A.tenantId,
    email: "multi@test.local",
    name: "Multi",
    passwordHash: HASH,
    roleCode: "manager",
    branches: [{ branchId: A.branchId }, { branchId: branch2 }],
  });
  // El mismo usuario global es además cajero en el tenant B.
  await addMember(owner, {
    tenantId: B.tenantId,
    email: "multi@test.local",
    name: "Multi",
    passwordHash: HASH,
    roleCode: "cashier",
    branches: [{ branchId: B.branchId }],
  });
  const single = await addMember(owner, {
    tenantId: A.tenantId,
    email: "single@test.local",
    name: "Single",
    passwordHash: HASH,
    roleCode: "cashier",
    branches: [{ branchId: A.branchId }],
  });

  return {
    tenantA: A.tenantId,
    tenantB: B.tenantId,
    a: { branch1: A.branchId, branch2, branch3 },
    b: { branch1: B.branchId },
    users: { adminA: A.userId, multi: multi.userId, single: single.userId, adminB: B.userId },
    memberships: { adminA: A.membershipId, multi: multi.membershipId, single: single.membershipId, adminB: B.membershipId },
  };
}

/** Verifica que la promesa falle con un código de error de Prisma concreto. */
export async function rejectsWithCode(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: { code?: string }) => e.code === code, `se esperaba el error ${code}`);
}

export async function closeAll(): Promise<void> {
  await app.$disconnect();
  await owner.$disconnect();
}
