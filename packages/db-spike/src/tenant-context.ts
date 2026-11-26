import { Prisma, PrismaClient } from "@prisma/client";

export type Tx = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeClient(datasourceUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl });
}

export function assertUuid(value: string, label = "tenantId"): void {
  if (!UUID_RE.test(value)) throw new Error(`${label} inválido`);
}

/**
 * Ejecuta `fn` dentro de una transacción con el contexto de tenant fijado.
 * `set_config(..., true)` es local a la transacción: al terminar, la conexión
 * vuelve al pool sin contexto (ADR-001, punto 4).
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertUuid(tenantId);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { timeout: 15_000 },
  );
}

/** Contrato de jobs/eventos: el payload debe transportar el tenant; sin él no se ejecuta. */
export async function runTenantJob<P extends { tenantId?: string }, T>(
  prisma: PrismaClient,
  payload: P,
  handler: (tx: Tx, payload: P) => Promise<T>,
): Promise<T> {
  if (!payload.tenantId) throw new Error("job sin tenantId");
  return withTenant(prisma, payload.tenantId, (tx) => handler(tx, payload));
}
