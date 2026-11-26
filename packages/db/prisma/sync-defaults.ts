/**
 * Pone al día las empresas existentes tras actualizar el sistema (permisos nuevos para el
 * Administrador, unidades de medida por defecto). Idempotente. Usa DIRECT_URL (rol propietario).
 *   pnpm --filter @erp/db sync:defaults
 */
import { createDb, syncTenantDefaults } from "../src";

async function main() {
  const owner = createDb(process.env.DIRECT_URL);
  try {
    const r = await syncTenantDefaults(owner);
    console.log(`Empresas: ${r.tenants} · permisos concedidos a administradores: ${r.adminGrants} · unidades creadas: ${r.unitsCreated}`);
  } finally {
    await owner.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
