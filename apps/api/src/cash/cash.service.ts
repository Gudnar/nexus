import { Inject, Injectable } from "@nestjs/common";
import type {
  CashCloseInput, CashCountInput, CashDecisionInput, CashMovementInput, CashMovementView, CashOpenInput, CashRegisterInput, CashRegisterPatch, CashRegisterSummary,
  CashSessionDetail, CashSessionSummary, CashSettings, CashTransferInput, PaymentMethod,
} from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const TOLERANCE_KEY = "cash.differenceTolerance";

/** Suma de un conteo por denominación. */
export function denominationTotal(d: Record<string, number>): Prisma.Decimal {
  return Object.entries(d).reduce((s, [k, n]) => s.add(D(k).mul(n)), D(0));
}

const sessionInclude = {
  register: { select: { id: true, code: true, name: true, kind: true } },
} satisfies Prisma.CashSessionInclude;
type SessionRow = Prisma.CashSessionGetPayload<{ include: typeof sessionInclude }>;

/**
 * Cajas, turnos y arqueos (plan §13, ADR-005). Una sesión abierta por caja; el libro de movimientos es inmutable y la sesión solo
 * recibe movimientos mientras está ABIERTA (lo impone un trigger). El efectivo esperado lo calcula el sistema; las diferencias
 * necesitan justificación y, sobre la tolerancia, la aprobación de OTRA persona. El cierre es una foto inmutable.
 */
@Injectable()
export class CashService {
  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  // ───────────── Cajas ─────────────

  listRegisters(ctx: RequestContext): Promise<CashRegisterSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.cashRegister.findMany({
        where: { branchId: { in: ids } }, orderBy: [{ code: "asc" }],
        include: { branch: { select: { id: true, code: true, name: true } }, sessions: { where: { status: { in: ["OPEN", "CLOSING"] } }, select: { id: true, code: true, status: true, responsibleId: true } } },
      });
      const names = await this.userNames(tx, rows.flatMap((r) => r.sessions.map((s) => s.responsibleId)));
      return rows.map((r) => ({
        id: r.id, code: r.code, name: r.name, kind: r.kind, status: r.status, branch: r.branch,
        activeSession: r.sessions[0] ? { id: r.sessions[0].id, code: r.sessions[0].code, status: r.sessions[0].status as "OPEN" | "CLOSING", responsible: names.get(r.sessions[0].responsibleId) ?? "—" } : null,
      }));
    });
  }

  createRegister(ctx: RequestContext, input: CashRegisterInput): Promise<CashRegisterSummary> {
    return ctx.run(async (tx) => {
      if (!(await this.branches(ctx, tx, "MANAGE")).includes(input.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso de administración a esa sucursal.");
      const id = uuidv7();
      try {
        await tx.cashRegister.create({ data: { id, tenantId: ctx.auth.tenantId, branchId: input.branchId, code: input.code, name: input.name, kind: input.kind } });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe una caja con ese código.");
        throw e;
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.register_created", entityType: "cash_register", entityId: id, branchId: input.branchId, actorUserId: ctx.auth.userId, after: input });
      return this.registerSummary(tx, id);
    });
  }

  updateRegister(ctx: RequestContext, id: string, patch: CashRegisterPatch): Promise<CashRegisterSummary> {
    return ctx.run(async (tx) => {
      const r = await tx.cashRegister.findUnique({ where: { id }, select: { branchId: true } });
      if (!r) throw notFound("Caja");
      if (!(await this.branches(ctx, tx, "MANAGE")).includes(r.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso de administración a esa sucursal.");
      if (patch.status === "INACTIVE" && (await tx.cashSession.findFirst({ where: { registerId: id, status: { in: ["OPEN", "CLOSING"] } }, select: { id: true } }))) {
        throw conflict("REGISTER_IN_USE", "La caja tiene un turno abierto: ciérralo antes de desactivarla.");
      }
      await tx.cashRegister.update({ where: { id }, data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.register_updated", entityType: "cash_register", entityId: id, branchId: r.branchId, actorUserId: ctx.auth.userId, after: patch });
      return this.registerSummary(tx, id);
    });
  }

  private async registerSummary(tx: Tx, id: string): Promise<CashRegisterSummary> {
    const r = await tx.cashRegister.findUniqueOrThrow({
      where: { id }, include: { branch: { select: { id: true, code: true, name: true } }, sessions: { where: { status: { in: ["OPEN", "CLOSING"] } }, select: { id: true, code: true, status: true, responsibleId: true } } },
    });
    const names = await this.userNames(tx, r.sessions.map((s) => s.responsibleId));
    return {
      id: r.id, code: r.code, name: r.name, kind: r.kind, status: r.status, branch: r.branch,
      activeSession: r.sessions[0] ? { id: r.sessions[0].id, code: r.sessions[0].code, status: r.sessions[0].status as "OPEN" | "CLOSING", responsible: names.get(r.sessions[0].responsibleId) ?? "—" } : null,
    };
  }

  // ───────────── Ajustes ─────────────

  getSettings(ctx: RequestContext): Promise<CashSettings> {
    return ctx.run(async (tx) => ({ differenceTolerance: await this.tolerance(tx) }));
  }
  setSettings(ctx: RequestContext, input: CashSettings): Promise<CashSettings> {
    return ctx.run(async (tx) => {
      await tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: ctx.auth.tenantId, key: TOLERANCE_KEY } },
        create: { tenantId: ctx.auth.tenantId, key: TOLERANCE_KEY, value: { amount: input.differenceTolerance } }, update: { value: { amount: input.differenceTolerance } },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.settings_changed", entityType: "tenant_setting", entityId: TOLERANCE_KEY, actorUserId: ctx.auth.userId, after: input });
      return input;
    });
  }
  private async tolerance(tx: Tx): Promise<number> {
    const s = await tx.tenantSetting.findFirst({ where: { key: TOLERANCE_KEY } });
    const v = (s?.value as { amount?: number } | null)?.amount;
    return typeof v === "number" ? v : 0;
  }

  // ───────────── Sesiones ─────────────

  list(ctx: RequestContext, q: { status?: "OPEN" | "CLOSING" | "CLOSED"; registerId?: string }): Promise<CashSessionSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.cashSession.findMany({ where: { branchId: { in: ids }, ...(q.status ? { status: q.status } : {}), ...(q.registerId ? { registerId: q.registerId } : {}) }, orderBy: { openedAt: "desc" }, take: 100, include: sessionInclude });
      return this.summaries(tx, rows);
    });
  }

  /** La sesión abierta (o en cierre) en la que puedo operar: soy responsable o participante. */
  mine(ctx: RequestContext): Promise<CashSessionSummary[]> {
    return ctx.run(async (tx) => {
      const rows = await tx.cashSession.findMany({
        where: { status: { in: ["OPEN", "CLOSING"] }, OR: [{ responsibleId: ctx.auth.userId }, { participants: { some: { userId: ctx.auth.userId } } }] },
        orderBy: { openedAt: "desc" }, include: sessionInclude,
      });
      return this.summaries(tx, rows);
    });
  }

  get(ctx: RequestContext, id: string): Promise<CashSessionDetail> {
    return ctx.run((tx) => this.detail(ctx, tx, id));
  }

  async open(ctx: RequestContext, input: CashOpenInput): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      const reg = await tx.cashRegister.findUnique({ where: { id: input.registerId }, select: { id: true, branchId: true, status: true } });
      if (!reg) throw notFound("Caja");
      if (!(await this.branches(ctx, tx, "OPERATE")).includes(reg.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de esa caja.");
      if (reg.status !== "ACTIVE") throw conflict("REGISTER_INACTIVE", "La caja está inactiva.");
      const opening = denominationTotal(input.denominations);
      const id = uuidv7();
      try {
        const code = await this.nextCode(tx, ctx.auth.tenantId);
        await tx.cashSession.create({
          data: { id, tenantId: ctx.auth.tenantId, branchId: reg.branchId, registerId: reg.id, code, responsibleId: ctx.auth.userId, openingCash: opening, openingDenominations: input.denominations, openNote: input.note?.trim() || null },
        });
      } catch (e) {
        if (isUnique(e)) throw conflict("REGISTER_BUSY", "Esa caja ya tiene un turno abierto.");
        throw e;
      }
      if (opening.gt(0)) await this.post(tx, ctx, { sessionId: id, branchId: reg.branchId, type: "OPENING", method: "CASH", amount: opening, note: "Fondo inicial" });
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.session_opened", entityType: "cash_session", entityId: id, branchId: reg.branchId, actorUserId: ctx.auth.userId, after: { opening: opening.toString() } });
      return this.detail(ctx, tx, id);
    });
  }

  addParticipant(ctx: RequestContext, id: string, userId: string): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id, "manage");
      if (s.status !== "OPEN") throw conflict("INVALID_STATE", "Solo se agregan participantes a un turno abierto.");
      const m = await tx.membership.findFirst({ where: { userId, status: "ACTIVE" }, select: { id: true } });
      if (!m) throw notFound("Usuario");
      if (userId === s.responsibleId) throw badRequest("ALREADY_RESPONSIBLE", "Esa persona ya es la responsable del turno.");
      try {
        await tx.cashSessionParticipant.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, sessionId: id, userId } });
      } catch (e) {
        if (isUnique(e)) throw conflict("ALREADY_PARTICIPANT", "Ya participa en este turno.");
        throw e;
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.participant_added", entityType: "cash_session", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { userId } });
      return this.detail(ctx, tx, id);
    });
  }

  // ───────────── Movimientos ─────────────

  /** Ingreso (no ligado a una venta), gasto o retiro de efectivo/otro medio. */
  movement(ctx: RequestContext, id: string, input: CashMovementInput): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id, "operate");
      if (s.status !== "OPEN") throw conflict("SESSION_NOT_OPEN", "El turno no está abierto.");
      const out = input.type !== "INCOME";
      if (out && input.method === "CASH") {
        const have = await this.expectedCash(tx, id);
        if (D(input.amount).gt(have)) throw conflict("INSUFFICIENT_CASH", `No hay tanto efectivo en la caja (esperado ${have.toString()}).`);
      }
      await this.post(tx, ctx, { sessionId: id, branchId: s.branchId, type: input.type, method: input.method, amount: out ? D(input.amount).neg() : D(input.amount), note: input.note });
      await writeAudit(tx, ctx.auth.tenantId, { action: `cash.${input.type.toLowerCase()}`, entityType: "cash_session", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { amount: input.amount, method: input.method, note: input.note } });
      return this.detail(ctx, tx, id);
    });
  }

  /** Traspaso de efectivo entre dos turnos abiertos (p. ej. de una caja a la bóveda): dos movimientos ligados. */
  transfer(ctx: RequestContext, id: string, input: CashTransferInput): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      if (input.toSessionId === id) throw badRequest("SAME_SESSION", "El origen y el destino deben ser distintos.");
      // Bloqueo en orden estable para que dos traspasos cruzados no se interbloqueen.
      const [first, second] = [id, input.toSessionId].sort();
      await tx.$queryRaw`SELECT id FROM cash_session WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id IN (${first}::uuid, ${second}::uuid) ORDER BY id FOR UPDATE`;
      const from = await this.lock(ctx, tx, id, "operate");
      const to = await tx.cashSession.findUnique({ where: { id: input.toSessionId }, select: { id: true, status: true, branchId: true } });
      if (!to) throw notFound("Turno de destino");
      if (from.status !== "OPEN" || to.status !== "OPEN") throw conflict("SESSION_NOT_OPEN", "Ambos turnos deben estar abiertos.");
      const have = await this.expectedCash(tx, id);
      if (D(input.amount).gt(have)) throw conflict("INSUFFICIENT_CASH", `No hay tanto efectivo en la caja de origen (esperado ${have.toString()}).`);
      const group = uuidv7();
      const note = input.note?.trim() || "Traspaso de efectivo";
      await this.post(tx, ctx, { sessionId: id, branchId: from.branchId, type: "TRANSFER_OUT", method: "CASH", amount: D(input.amount).neg(), note, groupId: group });
      await this.post(tx, ctx, { sessionId: to.id, branchId: to.branchId, type: "TRANSFER_IN", method: "CASH", amount: D(input.amount), note, groupId: group });
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.transferred", entityType: "cash_session", entityId: id, branchId: from.branchId, actorUserId: ctx.auth.userId, after: { to: to.id, amount: input.amount } });
      return this.detail(ctx, tx, id);
    });
  }

  /** Anula un movimiento con otro de signo contrario (el original no se toca). Solo en un turno abierto. */
  reverse(ctx: RequestContext, movementId: string, reason: string): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      const m = await tx.cashMovement.findUnique({ where: { id: movementId } });
      if (!m) throw notFound("Movimiento");
      const s = await this.lock(ctx, tx, m.sessionId, "operate");
      if (s.status !== "OPEN") throw conflict("SESSION_NOT_OPEN", "Solo se revierte en un turno abierto.");
      if (m.type === "OPENING" || m.type === "REVERSAL" || m.type === "TRANSFER_IN" || m.type === "TRANSFER_OUT") throw badRequest("NOT_REVERSIBLE", "Ese tipo de movimiento no se revierte desde aquí.");
      if (m.type === "SALE_PAYMENT" || m.type === "REFUND") throw badRequest("NOT_REVERSIBLE", "Los cobros y reintegros de ventas se corrigen desde la venta (devolución).");
      if (await tx.cashMovement.findFirst({ where: { reversalOfId: m.id }, select: { id: true } })) throw conflict("ALREADY_REVERSED", "Ese movimiento ya fue revertido.");
      if (m.amount.gt(0) && m.method === "CASH" && m.amount.gt(await this.expectedCash(tx, s.id))) throw conflict("INSUFFICIENT_CASH", "No hay efectivo suficiente para revertir ese ingreso.");
      await this.post(tx, ctx, { sessionId: s.id, branchId: s.branchId, type: "REVERSAL", method: m.method, amount: m.amount.neg(), note: `Reverso: ${reason}`, reversalOfId: m.id });
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.reversed", entityType: "cash_movement", entityId: movementId, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { reason } });
      return this.detail(ctx, tx, s.id);
    });
  }

  // ───────────── Arqueo y cierre ─────────────

  /** Arqueo parcial (sin cerrar): compara el efectivo contado con el esperado. */
  count(ctx: RequestContext, id: string, input: CashCountInput): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id, "operate");
      if (s.status !== "OPEN") throw conflict("SESSION_NOT_OPEN", "El turno no está abierto.");
      const expected = await this.expectedCash(tx, id);
      const counted = denominationTotal(input.denominations);
      await tx.cashCount.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, sessionId: id, isClosing: false, expectedCash: expected, countedCash: counted, difference: counted.sub(expected), denominations: input.denominations, note: input.note?.trim() || null, countedById: ctx.auth.userId } });
      return this.detail(ctx, tx, id);
    });
  }

  /**
   * Cierra el turno. Se bloquea la sesión y pasa a CLOSING (ya no entra ningún movimiento), se calcula el efectivo esperado y se
   * compara con lo contado. Sin diferencia o dentro de la tolerancia, cierra; con diferencia mayor queda esperando la decisión de
   * otra persona. Toda diferencia exige justificación.
   */
  close(ctx: RequestContext, id: string, input: CashCloseInput): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id, "operate");
      if (s.status !== "OPEN") throw conflict("INVALID_STATE", "Solo se cierra un turno abierto.");
      const expected = await this.expectedCash(tx, id);
      const counted = denominationTotal(input.denominations);
      const diff = counted.sub(expected);
      if (!diff.isZero() && !input.justification?.trim()) throw badRequest("JUSTIFICATION_REQUIRED", `Hay una diferencia de ${diff.toString()}: indica la justificación.`);

      await tx.cashSession.update({ where: { id }, data: { status: "CLOSING", closingRequestedAt: new Date() } });
      const countId = uuidv7();
      await tx.cashCount.create({ data: { id: countId, tenantId: ctx.auth.tenantId, sessionId: id, isClosing: true, expectedCash: expected, countedCash: counted, difference: diff, denominations: input.denominations, note: input.justification?.trim() || null, countedById: ctx.auth.userId } });

      if (diff.isZero()) {
        await this.finish(tx, ctx, s, { expected, counted, diff, denominations: input.denominations, justification: null, decision: null });
      } else if (diff.abs().lte(D(await this.tolerance(tx)))) {
        await tx.cashDifference.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, sessionId: id, countId, amount: diff, justification: input.justification!.trim(), status: "APPROVED", requestedById: ctx.auth.userId, decidedAt: new Date(), decisionNote: "Dentro de la tolerancia" } });
        await this.finish(tx, ctx, s, { expected, counted, diff, denominations: input.denominations, justification: input.justification!.trim(), decision: "Dentro de la tolerancia" });
      } else {
        await tx.cashDifference.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, sessionId: id, countId, amount: diff, justification: input.justification!.trim(), status: "PENDING", requestedById: ctx.auth.userId } });
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.closing_requested", entityType: "cash_session", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { expected: expected.toString(), counted: counted.toString(), difference: diff.toString() } });
      return this.detail(ctx, tx, id);
    });
  }

  /** Aprueba o rechaza la diferencia de un cierre. Quien cerró no puede decidir sobre su propia diferencia. */
  decide(ctx: RequestContext, id: string, input: CashDecisionInput): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id, "view");
      if (s.status !== "CLOSING") throw conflict("INVALID_STATE", "El turno no está esperando una decisión.");
      const diff = await tx.cashDifference.findFirst({ where: { sessionId: id, status: "PENDING" }, include: { count: true } });
      if (!diff) throw conflict("NO_PENDING_DIFFERENCE", "No hay una diferencia pendiente.");
      if (diff.requestedById === ctx.auth.userId) throw forbid("SELF_APPROVAL", "No puedes decidir sobre la diferencia de tu propio cierre.");
      await tx.cashDifference.update({ where: { id: diff.id }, data: { status: input.approve ? "APPROVED" : "REJECTED", decidedById: ctx.auth.userId, decidedAt: new Date(), decisionNote: input.note } });
      if (input.approve) {
        await this.finish(tx, ctx, s, { expected: diff.count.expectedCash, counted: diff.count.countedCash, diff: diff.amount, denominations: diff.count.denominations as Record<string, number>, justification: diff.justification, decision: input.note });
      } else {
        await tx.cashSession.update({ where: { id }, data: { status: "OPEN", closingRequestedAt: null } }); // vuelve a contarse
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: input.approve ? "cash.difference_approved" : "cash.difference_rejected", entityType: "cash_session", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { amount: diff.amount.toString(), note: input.note } });
      return this.detail(ctx, tx, id);
    });
  }

  /** Reabre un turno cerrado (el cierre original se conserva como versión anterior). */
  reopen(ctx: RequestContext, id: string, reason: string): Promise<CashSessionDetail> {
    return ctx.run(async (tx) => {
      const s = await this.lock(ctx, tx, id, "operate");
      if (s.status !== "CLOSED") throw conflict("INVALID_STATE", "Solo se reabre un turno cerrado.");
      try {
        await tx.cashSession.update({ where: { id }, data: { status: "OPEN", closedAt: null, closedById: null, closingRequestedAt: null, reopenedCount: { increment: 1 } } });
      } catch (e) {
        if (isUnique(e)) throw conflict("REGISTER_BUSY", "Esa caja ya tiene otro turno abierto.");
        throw e;
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "cash.session_reopened", entityType: "cash_session", entityId: id, branchId: s.branchId, actorUserId: ctx.auth.userId, after: { reason } });
      return this.detail(ctx, tx, id);
    });
  }

  // ───────────── Reportes ─────────────

  /** Totales por medio de pago, agrupados por caja y por responsable, en un rango de fechas (UTC). */
  report(ctx: RequestContext, q: { from?: string; to?: string }) {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      if (ids.length === 0) return { byRegister: [], byUser: [], total: [] };
      const range = Prisma.sql`${q.from ? Prisma.sql`AND m.created_at >= ${q.from}::date` : Prisma.empty} ${q.to ? Prisma.sql`AND m.created_at < (${q.to}::date + 1)` : Prisma.empty}`;
      const scope = Prisma.sql`m.branch_id IN (${Prisma.join(ids.map((b) => Prisma.sql`${b}::uuid`))})`;
      const byRegister = await tx.$queryRaw<{ code: string; name: string; branch_id: string; method: string; income: Prisma.Decimal; outflow: Prisma.Decimal }[]>(Prisma.sql`
        SELECT r.code, r.name, r.branch_id, m.method::text AS method, COALESCE(SUM(m.amount) FILTER (WHERE m.amount > 0), 0) AS income, COALESCE(-SUM(m.amount) FILTER (WHERE m.amount < 0), 0) AS outflow
          FROM cash_movement m JOIN cash_session s ON s.tenant_id = m.tenant_id AND s.id = m.session_id JOIN cash_register r ON r.tenant_id = s.tenant_id AND r.id = s.register_id
         WHERE ${scope} ${range} GROUP BY r.code, r.name, r.branch_id, m.method ORDER BY r.code, m.method`);
      const byUser = await tx.$queryRaw<{ responsible_id: string; method: string; income: Prisma.Decimal; outflow: Prisma.Decimal }[]>(Prisma.sql`
        SELECT s.responsible_id, m.method::text AS method, COALESCE(SUM(m.amount) FILTER (WHERE m.amount > 0), 0) AS income, COALESCE(-SUM(m.amount) FILTER (WHERE m.amount < 0), 0) AS outflow
          FROM cash_movement m JOIN cash_session s ON s.tenant_id = m.tenant_id AND s.id = m.session_id
         WHERE ${scope} ${range} GROUP BY s.responsible_id, m.method ORDER BY s.responsible_id, m.method`);
      const total = await tx.$queryRaw<{ method: string; income: Prisma.Decimal; outflow: Prisma.Decimal }[]>(Prisma.sql`
        SELECT m.method::text AS method, COALESCE(SUM(m.amount) FILTER (WHERE m.amount > 0), 0) AS income, COALESCE(-SUM(m.amount) FILTER (WHERE m.amount < 0), 0) AS outflow
          FROM cash_movement m WHERE ${scope} ${range} GROUP BY m.method ORDER BY m.method`);
      const names = await this.userNames(tx, byUser.map((u) => u.responsible_id));
      const fmt = (r: { income: Prisma.Decimal; outflow: Prisma.Decimal }) => ({ income: D(r.income).toString(), outflow: D(r.outflow).toString(), net: D(r.income).sub(D(r.outflow)).toString() });
      return {
        byRegister: byRegister.map((r) => ({ registerCode: r.code, registerName: r.name, branchId: r.branch_id, method: r.method, ...fmt(r) })),
        byUser: byUser.map((u) => ({ userId: u.responsible_id, name: names.get(u.responsible_id) ?? "—", method: u.method, ...fmt(u) })),
        total: total.map((t) => ({ method: t.method, ...fmt(t) })),
      };
    });
  }

  // ───────────── Integración con ventas ─────────────

  /**
   * Registra en la caja un cobro (entrada) o reintegro (salida) de una venta. Con caja configurada en la sucursal, el efectivo EXIGE un
   * turno abierto a tu nombre (responsable o participante); los otros medios se registran en el turno si hay uno. El turno se bloquea
   * en lectura compartida: un cierre concurrente espera y, si gana, el movimiento ya no encuentra turno abierto.
   * Sin cajas en la sucursal no hay control de caja y devuelve null.
   */
  async attach(
    tx: Tx, ctx: RequestContext,
    p: { branchId: string; method: PaymentMethod; amount: Prisma.Decimal.Value; direction: "IN" | "OUT"; sourceType: string; sourceId: string; note?: string; requestedSessionId?: string; movementType?: "SALE_PAYMENT" | "REFUND" | "SUPPLIER_PAYMENT" },
  ): Promise<string | null> {
    const regs = await tx.cashRegister.count({ where: { branchId: p.branchId, status: "ACTIVE" } });
    if (regs === 0) return null;
    const rows = await tx.$queryRaw<{ id: string; responsible_id: string; branch_id: string }[]>`
      SELECT s.id, s.responsible_id, s.branch_id FROM cash_session s
       WHERE s.tenant_id = ${ctx.auth.tenantId}::uuid AND s.branch_id = ${p.branchId}::uuid AND s.status = 'OPEN'
         AND (s.responsible_id = ${ctx.auth.userId}::uuid OR EXISTS (SELECT 1 FROM cash_session_participant x WHERE x.tenant_id = s.tenant_id AND x.session_id = s.id AND x.user_id = ${ctx.auth.userId}::uuid))
       ORDER BY (s.responsible_id = ${ctx.auth.userId}::uuid) DESC, s.opened_at DESC
       FOR SHARE OF s`;
    const pick = p.requestedSessionId ? rows.find((r) => r.id === p.requestedSessionId) : rows[0];
    if (p.requestedSessionId && !pick) throw forbid("CASH_SESSION_FORBIDDEN", "No operas en el turno de caja indicado, o ya no está abierto.");
    if (!pick) {
      if (p.method === "CASH") throw conflict("CASH_SESSION_REQUIRED", "Para cobrar, devolver o pagar en efectivo necesitas un turno de caja abierto en esta sucursal.");
      return null;
    }
    const amount = D(p.amount);
    if (p.direction === "OUT" && p.method === "CASH") {
      // Una salida de efectivo no puede dejar la caja en negativo; se serializa con otras salidas bloqueando el turno.
      await tx.$queryRaw`SELECT id FROM cash_session WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${pick.id}::uuid FOR UPDATE`;
      const have = await this.expectedCash(tx, pick.id);
      if (amount.gt(have)) throw conflict("INSUFFICIENT_CASH", `No hay tanto efectivo en la caja para esa salida (esperado ${have.toString()}).`);
    }
    await this.post(tx, ctx, {
      sessionId: pick.id, branchId: p.branchId, type: p.movementType ?? (p.direction === "IN" ? "SALE_PAYMENT" : "REFUND"), method: p.method, amount: p.direction === "IN" ? amount : amount.neg(),
      sourceType: p.sourceType, sourceId: p.sourceId, note: p.note,
    });
    return pick.id;
  }

  // ───────────── Internos ─────────────

  private async post(
    tx: Tx, ctx: RequestContext,
    m: { sessionId: string; branchId: string; type: "OPENING" | "SUPPLIER_PAYMENT" | "SALE_PAYMENT" | "REFUND" | "INCOME" | "EXPENSE" | "WITHDRAWAL" | "TRANSFER_IN" | "TRANSFER_OUT" | "REVERSAL"; method: PaymentMethod; amount: Prisma.Decimal.Value; note?: string | null; sourceType?: string; sourceId?: string; groupId?: string; reversalOfId?: string },
  ): Promise<string> {
    const id = uuidv7();
    await tx.cashMovement.create({
      data: {
        id, tenantId: ctx.auth.tenantId, branchId: m.branchId, sessionId: m.sessionId, type: m.type, method: m.method, amount: m.amount, note: m.note ?? null,
        sourceType: m.sourceType ?? null, sourceId: m.sourceId ?? null, groupId: m.groupId ?? null, reversalOfId: m.reversalOfId ?? null, actorId: ctx.auth.userId,
      },
    });
    return id;
  }

  /** Efectivo esperado: saldo inicial + ingresos − egresos − retiros ± reversos (todo está en el libro, en efectivo). */
  private async expectedCash(tx: Tx, sessionId: string): Promise<Prisma.Decimal> {
    const r = await tx.cashMovement.aggregate({ where: { sessionId, method: "CASH" }, _sum: { amount: true } });
    return r._sum.amount ?? D(0);
  }

  /** Bloquea la sesión y comprueba quién puede operarla: responsable, participante o quien administra cajas. */
  private async lock(ctx: RequestContext, tx: Tx, id: string, need: "view" | "operate" | "manage") {
    await tx.$queryRaw`SELECT id FROM cash_session WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const s = await tx.cashSession.findUnique({ where: { id }, select: { id: true, status: true, branchId: true, registerId: true, responsibleId: true, openingCash: true, code: true, reopenedCount: true, participants: { select: { userId: true } } } });
    if (!s) throw notFound("Turno de caja");
    const visible = await this.branches(ctx, tx, "VIEW");
    if (!visible.includes(s.branchId)) throw notFound("Turno de caja");
    if (need === "view") return s;
    const perms = await ctx.permissions();
    const isManager = perms.has("cash.manage");
    const mine = s.responsibleId === ctx.auth.userId || s.participants.some((p) => p.userId === ctx.auth.userId);
    if (!(await this.branches(ctx, tx, "OPERATE")).includes(s.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese turno.");
    if (need === "manage" ? !(isManager || s.responsibleId === ctx.auth.userId) : !(mine || isManager)) throw forbid("NOT_IN_SESSION", "No participas en ese turno de caja.");
    return s;
  }

  /** Cierra la sesión definitivamente y guarda la foto inmutable del cierre. */
  private async finish(
    tx: Tx, ctx: RequestContext, s: { id: string; branchId: string; registerId: string; responsibleId: string; openingCash: Prisma.Decimal; code: string },
    r: { expected: Prisma.Decimal; counted: Prisma.Decimal; diff: Prisma.Decimal; denominations: Record<string, number>; justification: string | null; decision: string | null },
  ) {
    const totals = await tx.cashMovement.groupBy({ by: ["method"], where: { sessionId: s.id }, _sum: { amount: true } });
    const inflow = await tx.cashMovement.groupBy({ by: ["method"], where: { sessionId: s.id, amount: { gt: 0 } }, _sum: { amount: true } });
    const reg = await tx.cashRegister.findUniqueOrThrow({ where: { id: s.registerId }, select: { code: true, name: true } });
    const version = (await tx.cashClosing.count({ where: { sessionId: s.id } })) + 1;
    const names = await this.userNames(tx, [s.responsibleId, ctx.auth.userId]);
    const snapshot = {
      session: s.code, register: reg, responsible: names.get(s.responsibleId) ?? s.responsibleId, closedBy: names.get(ctx.auth.userId) ?? ctx.auth.userId, openingCash: s.openingCash.toString(),
      totalsByMethod: totals.map((t) => ({ method: t.method, net: (t._sum.amount ?? D(0)).toString(), income: (inflow.find((i) => i.method === t.method)?._sum.amount ?? D(0)).toString() })),
      expectedCash: r.expected.toString(), countedCash: r.counted.toString(), difference: r.diff.toString(), denominations: r.denominations, justification: r.justification, decision: r.decision,
    };
    await tx.cashClosing.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, sessionId: s.id, version, snapshot, closedById: ctx.auth.userId } });
    await tx.cashSession.update({ where: { id: s.id }, data: { status: "CLOSED", closedAt: new Date(), closedById: ctx.auth.userId } });
  }

  private async userNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids)];
    if (uniq.length === 0) return new Map();
    const rows = await tx.membership.findMany({ where: { userId: { in: uniq } }, select: { userId: true, user: { select: { name: true } } } });
    return new Map(rows.map((m) => [m.userId, m.user.name]));
  }

  private async summaries(tx: Tx, rows: SessionRow[]): Promise<CashSessionSummary[]> {
    const names = await this.userNames(tx, rows.map((r) => r.responsibleId));
    const sums = await tx.cashMovement.groupBy({ by: ["sessionId"], where: { sessionId: { in: rows.map((r) => r.id) }, method: "CASH" }, _sum: { amount: true } });
    const exp = new Map(sums.map((x) => [x.sessionId, x._sum.amount ?? D(0)]));
    return rows.map((r) => toSummary(r, names.get(r.responsibleId) ?? "—", exp.get(r.id) ?? D(0)));
  }

  private async detail(ctx: RequestContext, tx: Tx, id: string): Promise<CashSessionDetail> {
    const s = await tx.cashSession.findUnique({ where: { id }, include: sessionInclude });
    if (!s || !(await this.branches(ctx, tx, "VIEW")).includes(s.branchId)) throw notFound("Turno de caja");
    const [participants, movements, counts, differences, closings, totals] = await Promise.all([
      tx.cashSessionParticipant.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" } }),
      tx.cashMovement.findMany({ where: { sessionId: id }, orderBy: { seq: "desc" }, take: 200 }),
      tx.cashCount.findMany({ where: { sessionId: id }, orderBy: { countedAt: "desc" } }),
      tx.cashDifference.findMany({ where: { sessionId: id }, orderBy: { createdAt: "desc" } }),
      tx.cashClosing.findMany({ where: { sessionId: id }, orderBy: { version: "asc" }, select: { version: true, closedAt: true } }),
      tx.$queryRaw<{ method: PaymentMethod; income: Prisma.Decimal; outflow: Prisma.Decimal }[]>`
        SELECT method::text AS method, COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS income, COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0) AS outflow
          FROM cash_movement WHERE tenant_id = ${s.tenantId}::uuid AND session_id = ${id}::uuid GROUP BY method ORDER BY method`,
    ]);
    const names = await this.userNames(tx, [s.responsibleId, ...participants.map((p) => p.userId), ...movements.map((m) => m.actorId).filter(Boolean) as string[]]);
    const expected = await this.expectedCash(tx, id);
    return {
      ...toSummary(s, names.get(s.responsibleId) ?? "—", expected), openNote: s.openNote,
      totals: totals.map((t) => ({ method: t.method, income: D(t.income).toString(), outflow: D(t.outflow).toString(), net: D(t.income).sub(D(t.outflow)).toString() })),
      participants: participants.map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? "—" })),
      movements: movements.map(toMovement(names)),
      counts: counts.map((c) => ({ id: c.id, isClosing: c.isClosing, expectedCash: c.expectedCash.toString(), countedCash: c.countedCash.toString(), difference: c.difference.toString(), countedAt: c.countedAt.toISOString(), note: c.note })),
      differences: differences.map((d) => ({ id: d.id, amount: d.amount.toString(), justification: d.justification, status: d.status, decisionNote: d.decisionNote, decidedAt: d.decidedAt?.toISOString() ?? null })),
      closings: closings.map((c) => ({ version: c.version, closedAt: c.closedAt.toISOString() })),
    };
  }

  private async nextCode(tx: Tx, tenantId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "CASH_SESSION", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "CASH_SESSION", prefix: "SC-", padding: 6 } });
    }
    return (await nextSequenceNumber(tx, "CASH_SESSION")).formatted;
  }
}

const toSummary = (s: SessionRow, responsibleName: string, expected: Prisma.Decimal): CashSessionSummary => ({
  id: s.id, code: s.code, status: s.status, register: s.register, branchId: s.branchId, responsible: { id: s.responsibleId, name: responsibleName },
  openedAt: s.openedAt.toISOString(), closedAt: s.closedAt?.toISOString() ?? null, openingCash: s.openingCash.toString(), reopenedCount: s.reopenedCount, expectedCash: expected.toString(),
});
const toMovement = (names: Map<string, string>) => (m: Prisma.CashMovementGetPayload<object>): CashMovementView => ({
  id: m.id, seq: m.seq.toString(), type: m.type, method: m.method, amount: m.amount.toString(), note: m.note, sourceType: m.sourceType, reversalOfId: m.reversalOfId,
  actor: m.actorId ? names.get(m.actorId) ?? null : null, createdAt: m.createdAt.toISOString(),
});
