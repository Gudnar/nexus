import { randomUUID } from "node:crypto";
import { assertUuid, type Tx } from "./context";
import { uuidv7 } from "./uuid7";

export interface DomainEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  branchId?: string | null;
  correlationId?: string;
  /** Si se repite la misma clave dentro del tenant, el evento no se duplica. */
  idempotencyKey?: string;
}

/**
 * Inserta un evento en el outbox dentro de la transacción de negocio (ADR-006).
 * Si la transacción revierte, el evento tampoco existe. Sin secretos en el payload.
 * Debe ejecutarse dentro de `withTenant`. Devuelve `false` si ya existía (idempotencia).
 */
export async function enqueueEvent(tx: Tx, tenantId: string, ev: DomainEventInput): Promise<boolean> {
  assertUuid(tenantId, "tenantId");
  if (ev.branchId) assertUuid(ev.branchId, "branchId");
  const res = await tx.outboxEvent.createMany({
    data: [
      {
        id: uuidv7(),
        tenantId,
        branchId: ev.branchId ?? null,
        eventType: ev.eventType,
        aggregateType: ev.aggregateType,
        aggregateId: ev.aggregateId,
        payload: ev.payload as object,
        correlationId: ev.correlationId ?? null,
        idempotencyKey: ev.idempotencyKey ?? randomUUID(),
      },
    ],
    skipDuplicates: true,
  });
  return res.count === 1;
}
