/**
 * Datos de demostración: dos empresas, usuarios con username y un administrador global.
 * Reemplaza TODO el contenido de la base (solo para desarrollo).
 * PROTECCIÓN: si la base tiene empresas que no son de la demostración (p. ej. creadas desde la consola de plataforma), se niega
 * a borrarlas. Para vaciarla igualmente: FORCE_RESEED=1. Para pruebas usa una base descartable (erp_test).
 *
 *   DIRECT_URL=... PLATFORM_DATABASE_URL=... pnpm --filter @erp/api seed:demo
 */
import { addMember, createDb, provisionTenant, uuidv7, withTenant } from "@erp/db";
import { PasswordService } from "../src/auth/password.service";

const PASSWORD = "Clave-Segura-123";
const PLATFORM_EMAIL = "super@nexus.test";
const PLATFORM_PASSWORD = "Plataforma-Segura-456";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed:demo no puede ejecutarse en producción");
  const ownerUrl = process.env.DIRECT_URL;
  const platformUrl = process.env.PLATFORM_DATABASE_URL;
  if (!ownerUrl || !platformUrl) throw new Error("Define DIRECT_URL y PLATFORM_DATABASE_URL");

  const owner = createDb(ownerUrl);
  const platform = createDb(platformUrl);
  const hash = await new PasswordService().hash(PASSWORD);

  const foreign = await owner.tenant.findMany({ where: { slug: { notIn: ["empresa-a", "empresa-b"] } }, select: { slug: true } });
  if (foreign.length > 0 && process.env.FORCE_RESEED !== "1") {
    throw new Error(
      `seed:demo NO se ejecutó: la base tiene empresas reales (${foreign.map((t) => t.slug).join(", ")}) y se perderían. ` +
      "Usa una base descartable para pruebas, o define FORCE_RESEED=1 si de verdad quieres borrarlo todo.",
    );
  }

  await owner.$executeRawUnsafe(
    `TRUNCATE tenant_setting, sequence, idempotency_record, outbox_event, audit_log,
              user_branch_access, user_role, role_permission, role, membership, branch,
              session, one_time_token, mfa_recovery_code, registration_request, platform_setting,
              platform_user, app_user, tenant RESTART IDENTITY CASCADE`,
  );

  const A = await provisionTenant(owner, {
    slug: "empresa-a", legalName: "Empresa A", mainBranch: { code: "A1", name: "Central A" },
    admin: { email: "admin.a@test.local", name: "Admin A", passwordHash: hash, username: "admin_a" },
  });
  const B = await provisionTenant(owner, {
    slug: "empresa-b", legalName: "Empresa B", mainBranch: { code: "B1", name: "Central B" },
    admin: { email: "admin.b@test.local", name: "Admin B", passwordHash: hash, username: "admin_b" },
  });
  const [a2, a3] = await withTenant(owner, A.tenantId, async (tx) => {
    const ids = [uuidv7(), uuidv7()] as const;
    await tx.branch.create({ data: { id: ids[0], tenantId: A.tenantId, code: "A2", name: "Norte A" } });
    await tx.branch.create({ data: { id: ids[1], tenantId: A.tenantId, code: "A3", name: "Sur A" } });
    return ids;
  });
  void a3;
  await addMember(owner, { tenantId: A.tenantId, email: "multi@test.local", name: "Multi", passwordHash: hash, roleCode: "manager", branches: [{ branchId: A.branchId }, { branchId: a2 }] });
  await addMember(owner, { tenantId: B.tenantId, email: "multi@test.local", name: "Multi", passwordHash: hash, roleCode: "cashier", branches: [{ branchId: B.branchId }] });
  await addMember(owner, { tenantId: A.tenantId, email: "cajero@test.local", name: "Cajero", passwordHash: hash, roleCode: "cashier", branches: [{ branchId: A.branchId }] });
  for (const [email, username] of [["multi@test.local", "multiuser"], ["cajero@test.local", "cajero1"]] as const) {
    await owner.user.update({ where: { email }, data: { username } });
  }

  await platform.platformUser.create({
    data: {
      id: uuidv7(), email: PLATFORM_EMAIL, role: "SUPER_ADMIN",
      passwordHash: await new PasswordService().hash(PLATFORM_PASSWORD),
    },
  });

  console.log("Datos de demostración listos.");
  await owner.$disconnect();
  await platform.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
