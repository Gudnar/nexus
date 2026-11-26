import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { withTenant, type Db, type Tx } from "@erp/db";
import { AppConfig } from "../config";
import { DB, WORKER_DB } from "../db";

/** Evento tal como lo recibe un consumidor. */
export interface OutboxEvent {
  id: string;
  tenantId: string;
  branchId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  idempotencyKey: string;
  attempts: number;
}

export interface HandlerContext {
  /** Transacción con el contexto (RLS) del tenant del evento, con el rol de aplicación. */
  tx: Tx;
}
export type OutboxHandler = (event: OutboxEvent, ctx: HandlerContext) => Promise<void>;

/** Suscripciones por tipo de evento. Los consumidores deben ser idempotentes (entrega al menos una vez). */
@Injectable()
export class OutboxHandlers {
  private readonly handlers = new Map<string, OutboxHandler[]>();

  on(eventType: string, handler: OutboxHandler): void {
    this.handlers.set(eventType, [...(this.handlers.get(eventType) ?? []), handler]);
  }

  for(eventType: string): OutboxHandler[] {
    return this.handlers.get(eventType) ?? [];
  }

  clear(): void {
    this.handlers.clear();
  }
}

export interface RunResult {
  claimed: number;
  processed: number;
  failed: number;
  dead: number;
}

interface Row {
  id: string; tenant_id: string; branch_id: string | null; event_type: string; aggregate_type: string;
  aggregate_id: string; payload: Record<string, unknown>; correlation_id: string | null;
  idempotency_key: string; attempts: number;
}

/**
 * Despacha los eventos del outbox (ADR-006).
 *  - Reclama lotes con `FOR UPDATE SKIP LOCKED`: varios workers no se pisan.
 *  - Respeta el orden por agregado: un evento no sale mientras haya otro anterior pendiente del mismo.
 *  - Entrega al menos una vez; reintenta con espera exponencial y pasa a DEAD tras `maxAttempts`.
 *  - Las columnas son TIMESTAMP sin zona y Prisma escribe UTC: toda comparación usa (now() AT TIME ZONE 'UTC'),
 *    no now() a secas (que sigue la zona del servidor).
 *  - Lee con el rol `erp_worker` (política propia sobre outbox_event) y ejecuta a los consumidores
 *    con el rol de aplicación y el contexto del tenant del evento.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Outbox");
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(WORKER_DB) private readonly workerDb: Db | null,
    @Inject(DB) private readonly appDb: Db,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(OutboxHandlers) private readonly registry: OutboxHandlers,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.workerDb) {
      this.logger.warn("WORKER_DATABASE_URL no configurada: el outbox no se despacha en este proceso.");
      return;
    }
    if (!this.config.outboxAutostart) return;
    const tick = () => {
      void this.runOnce().catch((e) => this.logger.error(e instanceof Error ? e.message : String(e)));
    };
    this.timer = setInterval(tick, this.config.outboxPollMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Un ciclo: reclama y procesa hasta `batch` eventos. Sin solapamiento dentro del mismo proceso. */
  async runOnce(batch = 20): Promise<RunResult> {
    const result: RunResult = { claimed: 0, processed: 0, failed: 0, dead: 0 };
    if (!this.workerDb || this.running) return result;
    this.running = true;
    try {
      await this.workerDb.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Row[]>`
            SELECT o.id, o.tenant_id, o.branch_id, o.event_type, o.aggregate_type, o.aggregate_id,
                   o.payload, o.correlation_id, o.idempotency_key, o.attempts
              FROM outbox_event o
             WHERE o.status IN ('PENDING', 'FAILED')
               AND o.available_at <= (now() AT TIME ZONE 'UTC')
               AND NOT EXISTS (
                     SELECT 1 FROM outbox_event e
                      WHERE e.tenant_id = o.tenant_id
                        AND e.aggregate_type = o.aggregate_type
                        AND e.aggregate_id = o.aggregate_id
                        AND e.status IN ('PENDING', 'FAILED')
                        AND e.occurred_at < o.occurred_at)
             ORDER BY o.occurred_at
             LIMIT ${batch}
               FOR UPDATE OF o SKIP LOCKED`;
          result.claimed = rows.length;

          for (const r of rows) {
            const event: OutboxEvent = {
              id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, eventType: r.event_type,
              aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, payload: r.payload,
              correlationId: r.correlation_id, idempotencyKey: r.idempotency_key, attempts: r.attempts,
            };
            try {
              // Un fallo del consumidor revierte SU trabajo, no el reclamo de los demás eventos.
              await withTenant(this.appDb, event.tenantId, async (appTx) => {
                for (const h of this.registry.for(event.eventType)) await h(event, { tx: appTx });
              });
              await tx.$executeRaw`UPDATE outbox_event SET status = 'PROCESSED', processed_at = (now() AT TIME ZONE 'UTC'), last_error = NULL WHERE id = ${event.id}::uuid`;
              result.processed++;
            } catch (e) {
              const attempts = event.attempts + 1;
              const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
              if (attempts >= this.config.outboxMaxAttempts) {
                await tx.$executeRaw`UPDATE outbox_event SET status = 'DEAD', attempts = ${attempts}, last_error = ${message} WHERE id = ${event.id}::uuid`;
                result.dead++;
                this.logger.error(`Evento ${event.eventType} (${event.id}) descartado tras ${attempts} intentos: ${message}`);
              } else {
                const delaySeconds = Math.min(3600, 2 ** attempts * 5); // 10 s, 20 s, 40 s …
                await tx.$executeRaw`UPDATE outbox_event SET status = 'FAILED', attempts = ${attempts}, last_error = ${message},
                                            available_at = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${delaySeconds}) WHERE id = ${event.id}::uuid`;
                result.failed++;
              }
            }
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    } finally {
      this.running = false;
    }
    return result;
  }
}
