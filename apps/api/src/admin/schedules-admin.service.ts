import { Injectable } from "@nestjs/common";
import type { ScheduleInput, SchedulePatch, ScheduleSummary } from "@erp/contracts";
import { uuidv7, writeAudit, type Tx } from "@erp/db";
import { hhmmToMinutes, isValidTimezone, minutesToHHMM } from "../access/schedule";
import type { RequestContext } from "../common/request-context";
import { badRequest, conflict, notFound } from "./actor";

type Row = Awaited<ReturnType<typeof loadSchedules>>[number];

const include = {
  rules: { select: { weekday: true, startMinute: true, endMinute: true }, orderBy: [{ weekday: "asc" as const }, { startMinute: "asc" as const }] },
  exceptions: { select: { date: true, type: true, startMinute: true, endMinute: true, reason: true }, orderBy: { date: "asc" as const } },
  _count: { select: { memberships: true } },
};

function loadSchedules(tx: Tx, where: object = {}) {
  return tx.userSchedule.findMany({ where, orderBy: { name: "asc" }, include });
}

const toSummary = (s: Row, tenantTz: string): ScheduleSummary => ({
  id: s.id,
  name: s.name,
  timezone: s.timezone,
  effectiveTimezone: s.timezone ?? tenantTz,
  rules: s.rules.map((r) => ({ weekday: r.weekday, start: minutesToHHMM(r.startMinute), end: minutesToHHMM(r.endMinute) })),
  exceptions: s.exceptions.map((e) => ({
    date: e.date.toISOString().slice(0, 10), type: e.type,
    start: e.startMinute === null ? null : minutesToHHMM(e.startMinute),
    end: e.endMinute === null ? null : minutesToHHMM(e.endMinute),
    reason: e.reason,
  })),
  members: s._count.memberships,
});

@Injectable()
export class SchedulesAdminService {
  list(ctx: RequestContext): Promise<ScheduleSummary[]> {
    return ctx.run(async (tx) => {
      const tz = (await ctx.tenantInfo()).timezone;
      return (await loadSchedules(tx)).map((s) => toSummary(s, tz));
    });
  }

  create(ctx: RequestContext, input: ScheduleInput): Promise<ScheduleSummary> {
    return ctx.run(async (tx) => {
      const info = await ctx.tenantInfo();
      this.assertTimezone(input.timezone);
      if (await tx.userSchedule.findUnique({ where: { tenantId_name: { tenantId: ctx.auth.tenantId, name: input.name } }, select: { id: true } })) {
        throw conflict("NAME_TAKEN", "Ya existe un horario con ese nombre.");
      }
      const id = uuidv7();
      await tx.userSchedule.create({ data: { id, tenantId: ctx.auth.tenantId, name: input.name, timezone: input.timezone ?? null } });
      await this.replaceChildren(tx, ctx.auth.tenantId, id, input.rules, input.exceptions);
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "schedule.created", entityType: "schedule", entityId: id, actorUserId: ctx.auth.userId,
        after: { name: input.name, rules: input.rules.length, exceptions: input.exceptions.length },
      });
      const [s] = await loadSchedules(tx, { id });
      return toSummary(s!, info.timezone);
    });
  }

  update(ctx: RequestContext, id: string, patch: SchedulePatch): Promise<ScheduleSummary> {
    return ctx.run(async (tx) => {
      const info = await ctx.tenantInfo();
      const [before] = await loadSchedules(tx, { id });
      if (!before) throw notFound("Horario");
      if (patch.timezone !== undefined) this.assertTimezone(patch.timezone);
      if (patch.name !== undefined && patch.name !== before.name &&
        (await tx.userSchedule.findUnique({ where: { tenantId_name: { tenantId: ctx.auth.tenantId, name: patch.name } }, select: { id: true } }))) {
        throw conflict("NAME_TAKEN", "Ya existe un horario con ese nombre.");
      }
      await tx.userSchedule.update({
        where: { id },
        data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}) },
      });
      if (patch.rules !== undefined || patch.exceptions !== undefined) {
        await this.replaceChildren(tx, ctx.auth.tenantId, id, patch.rules, patch.exceptions);
      }
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "schedule.updated", entityType: "schedule", entityId: id, actorUserId: ctx.auth.userId,
        before: { name: before.name, rules: before.rules.length, exceptions: before.exceptions.length },
        after: { name: patch.name ?? before.name, rules: patch.rules?.length ?? before.rules.length, exceptions: patch.exceptions?.length ?? before.exceptions.length },
      });
      const [s] = await loadSchedules(tx, { id });
      return toSummary(s!, info.timezone);
    });
  }

  remove(ctx: RequestContext, id: string): Promise<void> {
    return ctx.run(async (tx) => {
      const s = await tx.userSchedule.findUnique({ where: { id }, select: { name: true, _count: { select: { memberships: true } } } });
      if (!s) throw notFound("Horario");
      if (s._count.memberships > 0) throw conflict("SCHEDULE_IN_USE", "Hay usuarios con este horario. Cámbiales el horario primero.");
      await tx.userSchedule.delete({ where: { id } });
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "schedule.deleted", entityType: "schedule", entityId: id, actorUserId: ctx.auth.userId, before: { name: s.name },
      });
    });
  }

  private assertTimezone(tz: string | null | undefined): void {
    if (tz && !isValidTimezone(tz)) throw badRequest("INVALID_TIMEZONE", "Zona horaria no válida (usa nombres como America/La_Paz).");
  }

  private async replaceChildren(
    tx: Tx, tenantId: string, scheduleId: string,
    rules: ScheduleInput["rules"] | undefined, exceptions: ScheduleInput["exceptions"] | undefined,
  ): Promise<void> {
    if (rules !== undefined) {
      await tx.scheduleRule.deleteMany({ where: { scheduleId } });
      if (rules.length) {
        await tx.scheduleRule.createMany({
          data: rules.map((r) => ({
            id: uuidv7(), tenantId, scheduleId, weekday: r.weekday,
            startMinute: hhmmToMinutes(r.start), endMinute: hhmmToMinutes(r.end),
          })),
        });
      }
    }
    if (exceptions !== undefined) {
      await tx.scheduleException.deleteMany({ where: { scheduleId } });
      if (exceptions.length) {
        await tx.scheduleException.createMany({
          data: exceptions.map((e) => ({
            id: uuidv7(), tenantId, scheduleId, date: new Date(`${e.date}T00:00:00Z`), type: e.type,
            startMinute: e.start === undefined ? null : hhmmToMinutes(e.start),
            endMinute: e.end === undefined ? null : hhmmToMinutes(e.end),
            reason: e.reason || null,
          })),
        });
      }
    }
  }
}
