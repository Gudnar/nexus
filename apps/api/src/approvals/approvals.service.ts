import { Inject, Injectable } from "@nestjs/common";
import {
  APPROVAL_EVENTS, type ApprovalConfig, type ApprovalDecisionInput, type ApprovalDelegationInput, type ApprovalDelegationView,
  type ApprovalRequestInput, type ApprovalRequestView, type ApprovalWorkflowInput, type ApprovalWorkflowView,
} from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type Tx } from "@erp/db";
import { Clock } from "../access/clock";
import { localParts } from "../access/schedule";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { SalesService } from "../sales/sales.service";
import { NotificationsService, type NotifyInput } from "./notifications.service";

/** Etiqueta y si, al aprobarse, el sistema ejecuta la acción por sí mismo. El resto se aprueba y el módulo consulta la aprobación. */
export const EVENTS: Record<(typeof APPROVAL_EVENTS)[number], { label: string; executable: boolean }> = {
  SALE_VOID: { label: "Anulación de venta", executable: true },
  SALE_DISCOUNT: { label: "Descuento extraordinario", executable: false },
  SALE_RETURN: { label: "Devolución o reembolso", executable: false },
  INVENTORY_ADJUSTMENT: { label: "Ajuste de inventario", executable: false },
  CASH_DIFFERENCE: { label: "Diferencia de caja", executable: false },
  CASH_REOPEN: { label: "Reapertura de caja", executable: false },
  PURCHASE_HIGH: { label: "Compra sobre el límite", executable: false },
};
type EventKey = keyof typeof EVENTS;
const isEvent = (s: string): s is EventKey => s in EVENTS;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

type Principals = { roleIds: string[]; userIds: string[] };
type Step = ApprovalConfig["steps"][number];
type ReqRow = Prisma.ApprovalRequestGetPayload<{ include: { decisions: true; escalations: true } }>;

/**
 * Motor de aprobaciones (plan §14). Un workflow por tipo de evento, con niveles; cada solicitud guarda una copia de la regla vigente
 * al pedirse. Decide quien pertenece al nivel (por rol o usuario), por delegación vigente o por escalamiento; quien pide no se aprueba
 * a sí mismo. Las decisiones quedan registradas, no se editan y un nivel se decide una sola vez. Aprobar nunca otorga permisos.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(Clock) private readonly clock: Clock,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(SalesService) private readonly sales: SalesService,
  ) {}

  // ───────────── Workflows ─────────────

  async workflows(ctx: RequestContext): Promise<ApprovalWorkflowView[]> {
    return ctx.run(async (tx) => {
      const rows = await tx.approvalWorkflow.findMany({ include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      const by = new Map(rows.map((r) => [r.eventType, r]));
      return APPROVAL_EVENTS.map((e) => {
        const w = by.get(e);
        return {
          eventType: e, label: EVENTS[e].label, executable: EVENTS[e].executable, enabled: w?.enabled ?? false, version: w?.currentVersion ?? 0,
          config: (w?.versions[0]?.config as ApprovalConfig | undefined) ?? null,
        };
      });
    });
  }

  async saveWorkflow(ctx: RequestContext, eventType: string, input: ApprovalWorkflowInput): Promise<ApprovalWorkflowView> {
    if (!isEvent(eventType)) throw badRequest("EVENT_UNKNOWN", "Tipo de evento desconocido.");
    await ctx.run(async (tx) => {
      const roles = new Set(input.config.steps.flatMap((s) => [...s.roleIds, ...(s.escalateTo?.roleIds ?? [])]));
      if (roles.size && (await tx.role.count({ where: { id: { in: [...roles] } } })) !== roles.size) throw badRequest("ROLE_UNKNOWN", "Algún rol aprobador no existe.");
      const users = new Set(input.config.steps.flatMap((s) => [...s.userIds, ...(s.escalateTo?.userIds ?? [])]));
      if (users.size && (await tx.membership.count({ where: { userId: { in: [...users] }, status: "ACTIVE" } })) !== users.size) throw badRequest("USER_UNKNOWN", "Algún usuario aprobador no existe o está inactivo.");
      let w = await tx.approvalWorkflow.findUnique({ where: { tenantId_eventType: { tenantId: ctx.auth.tenantId, eventType } } });
      w ??= await tx.approvalWorkflow.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, eventType, name: EVENTS[eventType].label } });
      const version = w.currentVersion + 1;
      await tx.approvalWorkflowVersion.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, workflowId: w.id, version, config: input.config as unknown as Prisma.InputJsonValue, createdById: ctx.auth.userId } });
      await tx.approvalWorkflow.update({ where: { id: w.id }, data: { enabled: input.enabled, currentVersion: version } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "approval.workflow_saved", entityType: "approval_workflow", entityId: w.id, actorUserId: ctx.auth.userId, after: { eventType, enabled: input.enabled, version } });
    });
    return (await this.workflows(ctx)).find((w) => w.eventType === eventType)!;
  }

  /** ¿Esta operación debe pasar por aprobación? (flujo activo y, si hay mínimo, el importe lo alcanza). */
  async requires(ctx: RequestContext, eventType: EventKey, amount?: number): Promise<boolean> {
    return ctx.run(async (tx) => {
      const w = await tx.approvalWorkflow.findFirst({ where: { eventType, enabled: true }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      if (!w?.versions[0]) return false;
      const cfg = w.versions[0].config as unknown as ApprovalConfig;
      return cfg.minAmount === undefined || (amount ?? 0) >= cfg.minAmount;
    });
  }

  /** Si la anulación de esa venta exige aprobación, la vía directa se cierra para todos: hay que pedirla y que otra persona la apruebe. */
  async assertVoidAllowedDirectly(ctx: RequestContext, saleId: string): Promise<void> {
    const total = await ctx.run(async (tx) => (await tx.sale.findUnique({ where: { id: saleId }, select: { total: true } }))?.total);
    if (total === undefined) return; // el servicio de ventas responderá "no encontrada"
    if (await this.requires(ctx, "SALE_VOID", Number(total))) {
      throw conflict("APPROVAL_REQUIRED", "Anular esta venta requiere aprobación: solicítala desde Aprobaciones.");
    }
  }

  // ───────────── Solicitudes ─────────────

  async request(ctx: RequestContext, input: ApprovalRequestInput): Promise<ApprovalRequestView> {
    const { eventType } = input;
    await ctx.tenantInfo();
    const id = await ctx.run(async (tx) => {
      const w = await tx.approvalWorkflow.findFirst({ where: { eventType, enabled: true }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      if (!w?.versions[0]) throw conflict("NO_WORKFLOW", `"${EVENTS[eventType].label}" no tiene un flujo de aprobación activo.`);
      const cfg = w.versions[0].config as unknown as ApprovalConfig;
      let amount = input.amount;
      let title: string = EVENTS[eventType].label;
      let subjectType = "general";
      let branchId: string | null = null;
      if (eventType === "SALE_VOID") {
        if (!input.subjectId) throw badRequest("SUBJECT_REQUIRED", "Indica la venta que se quiere anular.");
        const s = await tx.sale.findUnique({ where: { id: input.subjectId }, select: { id: true, code: true, status: true, total: true, branchId: true } });
        if (!s) throw notFound("Venta");
        if (s.status !== "CONFIRMED") throw conflict("INVALID_STATE", "Solo se pide anular una venta confirmada.");
        amount = Number(s.total);
        title = `Anular venta ${s.code}`;
        subjectType = "sale";
        branchId = s.branchId;
      }
      if (cfg.minAmount !== undefined && (amount ?? 0) < cfg.minAmount) throw conflict("NOT_REQUIRED", "Este importe no requiere aprobación.");
      if (input.subjectId && (await tx.approvalRequest.count({ where: { eventType, subjectId: input.subjectId, status: { in: ["PENDING", "APPROVED"] } } }))) {
        throw conflict("ALREADY_REQUESTED", "Ya existe una solicitud en curso para este documento.");
      }
      const now = this.clock.now();
      const step = cfg.steps[0]!;
      const rid = uuidv7();
      if (!(await tx.sequence.findFirst({ where: { documentType: "APPROVAL", branchId: null }, select: { id: true } }))) {
        await tx.sequence.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, branchId: null, documentType: "APPROVAL", prefix: "AP-", padding: 6 } });
      }
      const code = (await nextSequenceNumber(tx, "APPROVAL")).formatted;
      await tx.approvalRequest.create({
        data: {
          id: rid, tenantId: ctx.auth.tenantId, branchId, code, workflowId: w.id, workflowVersion: w.currentVersion, eventType, subjectType,
          subjectId: input.subjectId ?? null, title, amount: amount === undefined ? null : new Prisma.Decimal(amount), reason: input.reason,
          payload: (input.data ?? {}) as Prisma.InputJsonValue, configSnapshot: cfg as unknown as Prisma.InputJsonValue,
          requestedById: ctx.auth.userId, dueAt: step.dueHours ? new Date(now.getTime() + step.dueHours * 3_600_000) : null,
        },
      });
      await this.notifyApprovers(tx, ctx.auth.tenantId, step, ctx.auth.userId, cfg.forbidSelfApproval, { type: "APPROVAL_REQUESTED", title: `Aprobación pendiente: ${title}`, body: input.reason, link: "/aprobaciones", refType: "approval_request", refId: rid });
      await writeAudit(tx, ctx.auth.tenantId, { action: "approval.requested", entityType: "approval_request", entityId: rid, branchId, actorUserId: ctx.auth.userId, after: { code, eventType, amount: amount ?? null, reason: input.reason } });
      return rid;
    });
    return this.get(ctx, id);
  }

  async list(ctx: RequestContext, scope: "mine" | "inbox" | "all", status?: string): Promise<ApprovalRequestView[]> {
    const perms = await ctx.permissions();
    const canSeeAll = perms.has("approvals.manage") || perms.has("approvals.decide");
    await ctx.tenantInfo();
    return ctx.run(async (tx) => {
      await this.escalateDue(tx, ctx.auth.tenantId);
      const where: Prisma.ApprovalRequestWhereInput = {};
      if (status) where.status = status as never;
      if (scope === "mine" || !canSeeAll) where.requestedById = ctx.auth.userId;
      else if (scope === "inbox") where.status = "PENDING";
      const rows = await tx.approvalRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { decisions: { orderBy: { step: "asc" } }, escalations: true } });
      const views = await this.views(ctx, tx, rows, perms.has("approvals.decide"));
      return scope === "inbox" && canSeeAll ? views.filter((v) => v.canDecide) : views;
    });
  }

  async get(ctx: RequestContext, id: string): Promise<ApprovalRequestView> {
    const perms = await ctx.permissions();
    await ctx.tenantInfo();
    return ctx.run(async (tx) => {
      await this.escalateDue(tx, ctx.auth.tenantId);
      const r = await tx.approvalRequest.findUnique({ where: { id }, include: { decisions: { orderBy: { step: "asc" } }, escalations: true } });
      if (!r) throw notFound("Solicitud");
      if (r.requestedById !== ctx.auth.userId && !perms.has("approvals.manage") && !perms.has("approvals.decide")) throw notFound("Solicitud");
      return (await this.views(ctx, tx, [r], perms.has("approvals.decide")))[0]!;
    });
  }

  async cancel(ctx: RequestContext, id: string): Promise<ApprovalRequestView> {
    await ctx.run(async (tx) => {
      const r = await this.lock(tx, ctx, id);
      if (r.requestedById !== ctx.auth.userId) throw forbid("NOT_REQUESTER", "Solo quien pidió la aprobación puede cancelarla.");
      if (r.status !== "PENDING") throw conflict("INVALID_STATE", "La solicitud ya no está pendiente.");
      await tx.approvalRequest.update({ where: { id }, data: { status: "CANCELLED", resolvedAt: this.clock.now(), resolvedById: ctx.auth.userId } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "approval.cancelled", entityType: "approval_request", entityId: id, branchId: r.branchId, actorUserId: ctx.auth.userId });
    });
    return this.get(ctx, id);
  }

  async decide(ctx: RequestContext, id: string, input: ApprovalDecisionInput): Promise<ApprovalRequestView> {
    const tz = (await ctx.tenantInfo()).timezone;
    const finalApproved = await ctx.run(async (tx) => {
      await this.escalateDue(tx, ctx.auth.tenantId);
      const r = await this.lock(tx, ctx, id);
      if (r.status !== "PENDING") throw conflict("INVALID_STATE", "La solicitud ya fue resuelta.");
      const cfg = r.configSnapshot as unknown as ApprovalConfig;
      const step = cfg.steps[r.currentStep - 1]!;
      const today = localParts(this.clock.now(), tz).date;
      const el = await this.eligibility(tx, ctx, r, step, today);
      if (!el.ok) throw forbid("NOT_APPROVER", "No te corresponde decidir este nivel de la solicitud.");
      if (cfg.forbidSelfApproval && (r.requestedById === ctx.auth.userId || el.onBehalfOf === r.requestedById)) {
        throw forbid("SELF_APPROVAL", "No puedes decidir una solicitud que tú mismo hiciste.");
      }
      await tx.approvalDecision.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, requestId: id, step: r.currentStep, deciderId: ctx.auth.userId, onBehalfOfId: el.onBehalfOf ?? null, decision: input.decision, note: input.note ?? null } });
      const now = this.clock.now();
      let last = false;
      if (input.decision === "REJECT") {
        await tx.approvalRequest.update({ where: { id }, data: { status: "REJECTED", resolvedAt: now, resolvedById: ctx.auth.userId } });
        await this.notifications.notify(tx, ctx.auth.tenantId, [r.requestedById], { type: "APPROVAL_REJECTED", title: `Rechazada: ${r.title}`, body: input.note ?? null, link: "/aprobaciones", severity: "WARN", refType: "approval_request", refId: id });
      } else if (r.currentStep < cfg.steps.length) {
        const next = cfg.steps[r.currentStep]!;
        await tx.approvalRequest.update({ where: { id }, data: { currentStep: r.currentStep + 1, dueAt: next.dueHours ? new Date(now.getTime() + next.dueHours * 3_600_000) : null } });
        await this.notifyApprovers(tx, ctx.auth.tenantId, next, r.requestedById, cfg.forbidSelfApproval, { type: "APPROVAL_REQUESTED", title: `Aprobación pendiente: ${r.title}`, body: r.reason, link: "/aprobaciones", refType: "approval_request", refId: id });
      } else {
        last = true;
        await tx.approvalRequest.update({ where: { id }, data: { status: "APPROVED", resolvedAt: now, resolvedById: ctx.auth.userId } });
        await this.notifications.notify(tx, ctx.auth.tenantId, [r.requestedById], { type: "APPROVAL_APPROVED", title: `Aprobada: ${r.title}`, body: input.note ?? null, link: "/aprobaciones", refType: "approval_request", refId: id });
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: input.decision === "APPROVE" ? "approval.approved" : "approval.rejected", entityType: "approval_request", entityId: id, branchId: r.branchId, actorUserId: ctx.auth.userId, after: { step: r.currentStep, onBehalfOf: el.onBehalfOf ?? null, note: input.note ?? null } });
      return last;
    });
    const executionError = finalApproved ? await this.execute(ctx, id) : null;
    const v = await this.get(ctx, id);
    return executionError ? { ...v, executionError } : v;
  }

  /** Reintenta la acción de una solicitud aprobada que no pudo ejecutarse. */
  async retry(ctx: RequestContext, id: string): Promise<ApprovalRequestView> {
    await ctx.tenantInfo();
    const err = await this.execute(ctx, id);
    const v = await this.get(ctx, id);
    return err ? { ...v, executionError: err } : v;
  }

  /** Ejecuta la acción asociada una única vez (idempotente: si ya está EXECUTED no hace nada). Devuelve el error, si lo hubo. */
  private async execute(ctx: RequestContext, id: string): Promise<string | null> {
    const r = await ctx.run((tx) => tx.approvalRequest.findUnique({ where: { id }, select: { status: true, eventType: true, subjectId: true, reason: true, code: true } }));
    if (!r) throw notFound("Solicitud");
    if (r.status === "EXECUTED") return null;
    if (r.status !== "APPROVED") throw conflict("INVALID_STATE", "Solo se ejecuta una solicitud aprobada.");
    if (isEvent(r.eventType) && EVENTS[r.eventType].executable) {
      try {
        if (r.eventType === "SALE_VOID" && r.subjectId) await this.sales.voidSale(ctx, r.subjectId, `${r.reason} (aprobación ${r.code})`);
      } catch (e) {
        const msg = (e as { response?: { message?: string } }).response?.message ?? (e as Error).message;
        return `La aprobación quedó registrada pero la acción no se pudo ejecutar: ${msg}`;
      }
    }
    await ctx.run(async (tx) => {
      const u = await tx.approvalRequest.updateMany({ where: { id, status: "APPROVED" }, data: { status: "EXECUTED", executedAt: this.clock.now() } });
      if (u.count) await writeAudit(tx, ctx.auth.tenantId, { action: "approval.executed", entityType: "approval_request", entityId: id, actorUserId: ctx.auth.userId });
    });
    return null;
  }

  /** ¿Hay una aprobación ya concedida (aprobada o ejecutada) para esa operación? Para módulos que consultan en vez de ejecutar. */
  async isApproved(ctx: RequestContext, eventType: EventKey, subjectId: string): Promise<boolean> {
    return ctx.run(async (tx) => (await tx.approvalRequest.count({ where: { eventType, subjectId, status: { in: ["APPROVED", "EXECUTED"] } } })) > 0);
  }

  // ───────────── Delegaciones ─────────────

  async delegations(ctx: RequestContext): Promise<ApprovalDelegationView[]> {
    const tz = (await ctx.tenantInfo()).timezone;
    const perms = await ctx.permissions();
    return ctx.run(async (tx) => {
      const rows = await tx.approvalDelegation.findMany({ where: perms.has("approvals.manage") ? {} : { OR: [{ delegatorId: ctx.auth.userId }, { delegateId: ctx.auth.userId }] }, orderBy: { createdAt: "desc" }, take: 200 });
      const names = await this.names(tx, rows.flatMap((d) => [d.delegatorId, d.delegateId]));
      const today = localParts(this.clock.now(), tz).date;
      return rows.map((d) => {
        const from = d.validFrom.toISOString().slice(0, 10);
        const to = d.validTo.toISOString().slice(0, 10);
        return {
          id: d.id, delegator: { id: d.delegatorId, name: names.get(d.delegatorId) ?? "—" }, delegate: { id: d.delegateId, name: names.get(d.delegateId) ?? "—" },
          eventType: d.eventType, validFrom: from, validTo: to, revoked: !!d.revokedAt, active: !d.revokedAt && from <= today && today <= to,
        };
      });
    });
  }

  async delegate(ctx: RequestContext, input: ApprovalDelegationInput): Promise<ApprovalDelegationView> {
    if (input.delegateUserId === ctx.auth.userId) throw badRequest("SELF_DELEGATION", "No puedes delegarte a ti mismo.");
    const id = await ctx.run(async (tx) => {
      const m = await tx.membership.findFirst({ where: { userId: input.delegateUserId, status: "ACTIVE" }, select: { id: true } });
      if (!m) throw badRequest("USER_UNKNOWN", "El usuario elegido no existe o está inactivo.");
      const d = await tx.approvalDelegation.create({
        data: { id: uuidv7(), tenantId: ctx.auth.tenantId, delegatorId: ctx.auth.userId, delegateId: input.delegateUserId, eventType: input.eventType ?? null, validFrom: new Date(`${input.validFrom}T00:00:00Z`), validTo: new Date(`${input.validTo}T00:00:00Z`), createdById: ctx.auth.userId },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "approval.delegated", entityType: "approval_delegation", entityId: d.id, actorUserId: ctx.auth.userId, after: { delegate: input.delegateUserId, eventType: input.eventType ?? null, from: input.validFrom, to: input.validTo } });
      await this.notifications.notify(tx, ctx.auth.tenantId, [input.delegateUserId], { type: "APPROVAL_DELEGATED", title: "Te delegaron aprobaciones", body: `Del ${input.validFrom} al ${input.validTo}`, link: "/aprobaciones" });
      return d.id;
    });
    return (await this.delegations(ctx)).find((d) => d.id === id)!;
  }

  async revokeDelegation(ctx: RequestContext, id: string): Promise<ApprovalDelegationView> {
    const perms = await ctx.permissions();
    await ctx.run(async (tx) => {
      const d = await tx.approvalDelegation.findUnique({ where: { id } });
      if (!d) throw notFound("Delegación");
      if (d.delegatorId !== ctx.auth.userId && !perms.has("approvals.manage")) throw forbid("NOT_OWNER", "Solo quien delegó (o un administrador de aprobaciones) puede revocarla.");
      if (!d.revokedAt) {
        await tx.approvalDelegation.update({ where: { id }, data: { revokedAt: this.clock.now() } });
        await writeAudit(tx, ctx.auth.tenantId, { action: "approval.delegation_revoked", entityType: "approval_delegation", entityId: id, actorUserId: ctx.auth.userId });
      }
    });
    return (await this.delegations(ctx)).find((d) => d.id === id)!;
  }

  /** Personas a las que se puede delegar (usuarios activos con permiso de decidir, salvo uno mismo). */
  async delegateCandidates(ctx: RequestContext): Promise<{ id: string; name: string }[]> {
    return ctx.run(async (tx) => {
      const ms = await tx.membership.findMany({
        where: { status: "ACTIVE", userId: { not: ctx.auth.userId }, roles: { some: { role: { permissions: { some: { permission: { code: "approvals.decide" } } } } } } },
        select: { userId: true, user: { select: { name: true } } },
      });
      return ms.map((m) => ({ id: m.userId, name: m.user.name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
    });
  }

  // ───────────── Internos ─────────────

  private async lock(tx: Tx, ctx: RequestContext, id: string) {
    await tx.$queryRaw`SELECT id FROM approval_request WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const r = await tx.approvalRequest.findUnique({ where: { id } });
    if (!r) throw notFound("Solicitud");
    return r;
  }

  private async roleIdsOf(tx: Tx, userId: string): Promise<string[]> {
    const m = await tx.membership.findFirst({ where: { userId, status: "ACTIVE" }, select: { roles: { select: { roleId: true } } } });
    return m?.roles.map((r) => r.roleId) ?? [];
  }

  private matches(p: Principals, userId: string, roleIds: string[]): boolean {
    return p.userIds.includes(userId) || p.roleIds.some((r) => roleIds.includes(r));
  }

  /** Quién puede decidir el nivel en curso: el nivel, lo ampliado por escalamiento y, por delegación, quien actúa en nombre de ellos. */
  private async eligibility(tx: Tx, ctx: RequestContext, r: { id: string; currentStep: number; eventType: string }, step: Step, today: string): Promise<{ ok: boolean; onBehalfOf?: string }> {
    const esc = await tx.approvalEscalation.findMany({ where: { requestId: r.id, step: r.currentStep } });
    const p: Principals = {
      roleIds: [...step.roleIds, ...esc.flatMap((e) => strings(e.targetRoles))],
      userIds: [...step.userIds, ...esc.flatMap((e) => strings(e.targetUsers))],
    };
    if (this.matches(p, ctx.auth.userId, await this.roleIdsOf(tx, ctx.auth.userId))) return { ok: true };
    const day = new Date(`${today}T00:00:00Z`);
    const dels = await tx.approvalDelegation.findMany({
      where: { delegateId: ctx.auth.userId, revokedAt: null, validFrom: { lte: day }, validTo: { gte: day }, OR: [{ eventType: null }, { eventType: r.eventType }] },
    });
    for (const d of dels) {
      if (this.matches(p, d.delegatorId, await this.roleIdsOf(tx, d.delegatorId))) return { ok: true, onBehalfOf: d.delegatorId };
    }
    return { ok: false };
  }

  /** Avisa a quienes pueden decidir el nivel (roles y usuarios), sin avisar a quien pidió si no puede aprobar lo suyo. */
  private async notifyApprovers(tx: Tx, tenantId: string, step: Principals, requesterId: string, forbidSelf: boolean, n: NotifyInput) {
    const ms = await tx.membership.findMany({
      where: { status: "ACTIVE", OR: [{ userId: { in: step.userIds } }, { roles: { some: { roleId: { in: step.roleIds } } } }] },
      select: { userId: true },
    });
    await this.notifications.notify(tx, tenantId, ms.map((m) => m.userId).filter((u) => !(forbidSelf && u === requesterId)), { ...n, severity: "WARN" });
  }

  /** Amplía quién decide un nivel vencido con `escalateTo` (una vez por nivel). Corre al consultar o decidir, sin temporizador. */
  private async escalateDue(tx: Tx, tenantId: string): Promise<void> {
    const due = await tx.approvalRequest.findMany({ where: { status: "PENDING", dueAt: { lte: this.clock.now() } } });
    for (const r of due) {
      const cfg = r.configSnapshot as unknown as ApprovalConfig;
      const step = cfg.steps[r.currentStep - 1];
      if (!step?.escalateTo) continue;
      if (await tx.approvalEscalation.count({ where: { requestId: r.id, step: r.currentStep } })) continue;
      await tx.approvalEscalation.create({ data: { id: uuidv7(), tenantId, requestId: r.id, step: r.currentStep, targetRoles: step.escalateTo.roleIds, targetUsers: step.escalateTo.userIds } });
      await this.notifyApprovers(tx, tenantId, step.escalateTo, r.requestedById, cfg.forbidSelfApproval, { type: "APPROVAL_ESCALATED", title: `Escalada: ${r.title}`, body: `Pasó el plazo sin decisión. ${r.reason}`, link: "/aprobaciones", refType: "approval_request", refId: r.id });
      await writeAudit(tx, tenantId, { action: "approval.escalated", entityType: "approval_request", entityId: r.id, branchId: r.branchId, after: { step: r.currentStep } });
    }
  }

  private async names(tx: Tx, userIds: string[]): Promise<Map<string, string>> {
    const ms = await tx.membership.findMany({ where: { userId: { in: [...new Set(userIds)] } }, select: { userId: true, user: { select: { name: true } } } });
    return new Map(ms.map((m) => [m.userId, m.user.name]));
  }

  private async views(ctx: RequestContext, tx: Tx, rows: ReqRow[], mayDecide: boolean): Promise<ApprovalRequestView[]> {
    const names = await this.names(tx, rows.flatMap((r) => [r.requestedById, ...r.decisions.flatMap((d) => [d.deciderId, ...(d.onBehalfOfId ? [d.onBehalfOfId] : [])])]));
    const today = localParts(this.clock.now(), (await ctx.tenantInfo()).timezone).date;
    const out: ApprovalRequestView[] = [];
    for (const r of rows) {
      const cfg = r.configSnapshot as unknown as ApprovalConfig;
      const step = cfg.steps[r.currentStep - 1];
      let can = false;
      if (mayDecide && r.status === "PENDING" && step) {
        const el = await this.eligibility(tx, ctx, r, step, today);
        can = el.ok && !(cfg.forbidSelfApproval && (r.requestedById === ctx.auth.userId || el.onBehalfOf === r.requestedById));
      }
      out.push({
        id: r.id, code: r.code, eventType: r.eventType, eventLabel: isEvent(r.eventType) ? EVENTS[r.eventType].label : r.eventType, title: r.title, reason: r.reason,
        amount: r.amount?.toString() ?? null, status: r.status, currentStep: r.currentStep, totalSteps: cfg.steps.length, stepName: r.status === "PENDING" ? step?.name ?? null : null,
        subjectId: r.subjectId, subjectType: r.subjectType, requestedBy: { id: r.requestedById, name: names.get(r.requestedById) ?? "—" },
        dueAt: r.dueAt?.toISOString() ?? null, escalated: r.escalations.some((e) => e.step === r.currentStep), createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
        canDecide: can,
        decisions: r.decisions.map((d) => ({ step: d.step, decision: d.decision, note: d.note, by: names.get(d.deciderId) ?? "—", onBehalfOf: d.onBehalfOfId ? names.get(d.onBehalfOfId) ?? "—" : null, at: d.createdAt.toISOString() })),
      });
    }
    return out;
  }
}
