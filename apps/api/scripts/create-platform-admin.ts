/**
 * Crea (o actualiza la contraseña de) un administrador global de la plataforma.
 *   PLATFORM_DATABASE_URL=... pnpm --filter @erp/api platform:admin <correo> "<nombre>" <contraseña>
 * Usa el rol de plataforma; la contraseña se guarda con argon2id.
 */
import { createDb, uuidv7 } from "@erp/db";
import { PasswordService } from "../src/auth/password.service";
import { assertPasswordPolicy } from "../src/security/password-policy";

async function main() {
  const [email, , password] = process.argv.slice(2);
  const url = process.env.PLATFORM_DATABASE_URL;
  if (!url || !email || !password) {
    console.error('Uso: PLATFORM_DATABASE_URL=... tsx scripts/create-platform-admin.ts <correo> "<nombre>" <contraseña>');
    process.exit(1);
  }
  assertPasswordPolicy(password, { email });
  const db = createDb(url);
  const hash = await new PasswordService().hash(password);
  const e = email.trim().toLowerCase();
  await db.platformUser.upsert({
    where: { email: e },
    update: { passwordHash: hash, failedLogins: 0, lockedUntil: null, active: true },
    create: { id: uuidv7(), email: e, passwordHash: hash, role: "SUPER_ADMIN" },
  });
  console.log(`Administrador global listo: ${e}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
