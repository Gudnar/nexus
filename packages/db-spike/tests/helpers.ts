import type { PrismaClient } from "@prisma/client";
import { APP_URL, MIGRATOR_URL } from "../src/config";
import { makeClient, withTenant } from "../src/tenant-context";
import { uuidv7 } from "../src/uuid7";

/** Cliente con el rol de aplicación (sin BYPASSRLS). */
export const app = makeClient(APP_URL);
/** Cliente propietario: solo para sembrar `tenant` (global) y limpiar. */
export const admin = makeClient(MIGRATOR_URL);

export interface World {
  tenantA: string;
  tenantB: string;
  a: { branch1: string; branch2: string; warehouse1: string; warehouse2: string; customer: string };
  b: { branch1: string; warehouse1: string; customer: string };
}

async function seedTenant(client: PrismaClient, tenantId: string, branches: number) {
  return withTenant(client, tenantId, async (tx) => {
    const out = { branches: [] as string[], warehouses: [] as string[], customer: uuidv7() };
    for (let i = 1; i <= branches; i++) {
      const branchId = uuidv7();
      const warehouseId = uuidv7();
      await tx.branch.create({ data: { id: branchId, tenantId, code: `S${i}`, name: `Sucursal ${i}` } });
      await tx.warehouse.create({ data: { id: warehouseId, tenantId, branchId, code: `W${i}` } });
      out.branches.push(branchId);
      out.warehouses.push(warehouseId);
    }
    await tx.customer.create({ data: { id: out.customer, tenantId, name: "Cliente" } });
    return out;
  });
}

/** Limpia y crea: tenant A (2 sucursales), tenant B (1 sucursal). */
export async function seedWorld(): Promise<World> {
  await admin.$executeRawUnsafe(
    "TRUNCATE sale, warehouse, customer, branch, audit_log, tenant RESTART IDENTITY CASCADE",
  );
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  await admin.tenant.create({ data: { id: tenantA, slug: "a", name: "Empresa A" } });
  await admin.tenant.create({ data: { id: tenantB, slug: "b", name: "Empresa B" } });

  const a = await seedTenant(app, tenantA, 2);
  const b = await seedTenant(app, tenantB, 1);
  return {
    tenantA,
    tenantB,
    a: {
      branch1: a.branches[0]!,
      branch2: a.branches[1]!,
      warehouse1: a.warehouses[0]!,
      warehouse2: a.warehouses[1]!,
      customer: a.customer,
    },
    b: { branch1: b.branches[0]!, warehouse1: b.warehouses[0]!, customer: b.customer },
  };
}

export async function closeAll() {
  await app.$disconnect();
  await admin.$disconnect();
}
