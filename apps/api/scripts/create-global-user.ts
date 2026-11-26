/**
 * Crea (o actualiza) un usuario con el rol Administrador (todos los permisos) y acceso a
 * TODAS las sucursales en TODAS las empresas existentes.
 *
 *   DIRECT_URL=... pnpm --filter @erp/api global:user <correo> <usuario> "<nombre>" <contraseña>
 *
 * No confundir con el administrador de plataforma (`platform:admin`), que gestiona ajustes
 * globales pero no opera dentro de las empresas.
 */
import { createDb, uuidv7, withTenant } from "@erp/db";
import { PasswordService } from "../src/auth/password.service";
import { passwordIssues } from "../src/security/password-policy";

async function main() {
  const [emailRaw, usernameRaw, name, password] = process.argv.slice(2);
  const url = process.env.DIRECT_URL;
  if (!url || !emailRaw || !usernameRaw || !name || !password) {
    console.error('Uso: DIRECT_URL=... tsx scripts/create-global-user.ts <correo> <usuario> "<nombre>" <contraseña>');
    process.exit(1);
  }
  const email = emailRaw.trim().toLowerCase();
  const username = usernameRaw.trim().toLowerCase();
  const issues = passwordIssues(password, { email, username });
  if (issues.length) throw new Error(`Contraseña no válida: ${issues.join(" ")}`);

  const db = createDb(url);
  const passwordHash = await new PasswordService().hash(password);
  const user = await db.user.upsert({
    where: { email },
    update: { passwordHash, username, name, active: true, failedLogins: 0, lockedUntil: null },
    create: { id: uuidv7(), email, username, name, passwordHash, emailVerifiedAt: new Date() },
    select: { id: true },
  });

  const tenants = await db.tenant.findMany({ select: { id: true, slug: true } });
  for (const t of tenants) {
    await withTenant(db, t.id, async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: t.id, code: "admin" } }, select: { id: true } });
      const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: t.id, userId: user.id } }, select: { id: true } });
      const membershipId = m?.id ?? uuidv7();
      if (m) {
        await tx.membership.update({ where: { id: m.id }, data: { status: "ACTIVE", allBranches: true } });
        await tx.userRole.deleteMany({ where: { membershipId } });
      } else {
        const main = await tx.branch.findFirst({ where: { isMain: true }, select: { id: true } });
        await tx.membership.create({
          data: { id: membershipId, tenantId: t.id, userId: user.id, allBranches: true, defaultBranchId: main?.id ?? null },
        });
      }
      await tx.userRole.create({ data: { tenantId: t.id, membershipId, roleId: role.id } });
    });
    console.log(`  · ${t.slug}: Administrador, todas las sucursales`);
  }
  console.log(`Usuario global listo: ${email} (usuario: ${username}) en ${tenants.length} empresa(s).`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
