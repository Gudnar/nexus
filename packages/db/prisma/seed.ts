/**
 * Seed de desarrollo. Usa DIRECT_URL (rol propietario).
 *  - Siempre: catálogo global de permisos y plan base.
 *  - SEED_DEMO=1: tenant demo con 2 sucursales y usuarios de ejemplo (clave "cambiar-esto":
 *    el hash real con argon2id llega con el módulo de autenticación).
 */
import { addMember, createDb, provisionTenant, syncPermissionCatalog, uuidv7, withTenant } from "../src";

async function main() {
  const owner = createDb(process.env.DIRECT_URL);
  try {
    await syncPermissionCatalog(owner);
    await owner.plan.upsert({
      where: { code: "base" },
      update: {},
      create: { id: uuidv7(), code: "base", name: "Plan base", limits: { maxUsers: 10, maxBranches: 3 } },
    });
    console.log("Catálogo de permisos y plan base listos.");

    if (process.env.SEED_DEMO === "1") {
      const hash = "pendiente-argon2id";
      const t = await provisionTenant(owner, {
        slug: "demo",
        legalName: "Empresa Demo S.R.L.",
        mainBranch: { code: "CEN", name: "Sucursal Central" },
        admin: { email: "admin@demo.local", name: "Administrador Demo", passwordHash: hash },
      });
      const norte = uuidv7();
      await withTenant(owner, t.tenantId, (tx) =>
        tx.branch.create({ data: { id: norte, tenantId: t.tenantId, code: "NOR", name: "Sucursal Norte" } }),
      );
      await addMember(owner, {
        tenantId: t.tenantId, email: "cajero@demo.local", name: "Cajero Demo", passwordHash: hash,
        roleCode: "cashier", branches: [{ branchId: norte }],
      });
      console.log("Tenant demo creado: admin@demo.local (todas las sucursales), cajero@demo.local (solo Norte).");
    }
    await owner.$disconnect();
  } catch (e) {
    await owner.$disconnect();
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
