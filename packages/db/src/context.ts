import { Prisma, PrismaClient } from "@prisma/client";

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDb(datasourceUrl?: string): PrismaClient {
  return new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);
}

export function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new Error(`${label} inválido`);
}

/**
 * Ejecuta `fn` en una transacción con el tenant fijado para RLS.
 * `set_config(..., true)` es local a la transacción: al terminar, la conexión vuelve
 * al pool sin contexto (ADR-001, punto 4). Es el ÚNICO camino para tocar tablas
 * tenant-scoped.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: { timeout?: number } = {},
): Promise<T> {
  assertUuid(tenantId, "tenantId");
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    // maxWait: tiempo para obtener una conexión del pool (Prisma trae 2 s: con carga, encolar no debe fallar).
    { timeout: opts.timeout ?? 15_000, maxWait: 10_000 },
  );
}

/**
 * Contexto de usuario SIN tenant: solo permite leer las propias membresías (política
 * `user_self_read`). Se usa en el login para decidir a qué tenant entrar.
 */
export async function withUserContext<T>(
  db: Db,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertUuid(userId, "userId");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** Contrato de jobs/eventos: el payload transporta el tenant; sin él no se ejecuta. */
export async function runTenantJob<P extends { tenantId?: string }, T>(
  db: Db,
  payload: P,
  handler: (tx: Tx, payload: P) => Promise<T>,
): Promise<T> {
  if (!payload.tenantId) throw new Error("job sin tenantId");
  return withTenant(db, payload.tenantId, (tx) => handler(tx, payload));
}
