import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { withTenant } from "@erp/db";
import { DB, type Db } from "../db";
import { Clock } from "./clock";
import { describeOpening, evaluate, nextOpening, type ScheduleDef } from "./schedule";

/**
 * Aplica el horario de acceso de una membresía (plan §5.5). Se consulta al iniciar sesión, al
 * renovar el token y en cada petición autenticada: ocultar pantallas no es seguridad.
 * Sin horario asignado no hay restricción.
 */
@Injectable()
export class AccessScheduleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async assertAllowed(tenantId: string, membershipId: string): Promise<void> {
    const m = await withTenant(this.db, tenantId, (tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        select: {
          schedule: {
            select: {
              timezone: true,
              rules: { select: { weekday: true, startMinute: true, endMinute: true } },
              exceptions: { select: { date: true, type: true, startMinute: true, endMinute: true } },
            },
          },
        },
      }),
    );
    const s = m?.schedule;
    if (!s) return;

    const timezone = s.timezone ?? (await this.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } })).timezone;
    const def: ScheduleDef = {
      timezone,
      rules: s.rules,
      exceptions: s.exceptions.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) })),
    };
    const now = this.clock.now();
    if (evaluate(def, now).allowed) return;

    const next = describeOpening(nextOpening(def, now), timezone);
    throw new ForbiddenException({
      code: "OUTSIDE_SCHEDULE",
      message: `Estás fuera de tu horario de acceso. Podrás entrar ${next}.`,
    });
  }
}
