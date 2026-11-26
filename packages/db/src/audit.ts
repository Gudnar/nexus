import { assertUuid, type Tx } from "./context";
import { uuidv7 } from "./uuid7";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string;
  branchId?: string | null;
  actorUserId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  correlationId?: string;
}

/** Registra una entrada de auditoría append-only. Debe ejecutarse dentro de `withTenant`. */
export async function writeAudit(tx: Tx, tenantId: string, a: AuditInput): Promise<void> {
  assertUuid(tenantId, "tenantId");
  await tx.auditLog.create({
    data: {
      id: uuidv7(),
      tenantId,
      branchId: a.branchId ?? null,
      actorUserId: a.actorUserId ?? null,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ?? null,
      before: (a.before ?? undefined) as object | undefined,
      after: (a.after ?? undefined) as object | undefined,
      ip: a.ip ?? null,
      correlationId: a.correlationId ?? null,
    },
  });
}
