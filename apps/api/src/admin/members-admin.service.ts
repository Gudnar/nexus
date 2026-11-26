import { Inject, Injectable } from "@nestjs/common";
import type { InvitationSummary, InviteUserRequest, MemberSummary, UpdateMemberRequest } from "@erp/contracts";
import { uuidv7, writeAudit, type Tx } from "@erp/db";
import { DB, type Db } from "../db";
import type { RequestContext } from "../common/request-context";
import { AppConfig } from "../config";
import { MailService } from "../mail/mail.service";
import { newToken } from "../security/crypto";
import {
  assertBranchesAssignable, assertCanGrant, assertHasManager, badRequest, conflict, forbid, loadActor,
  notFound, rolePermissionCodes, type Actor,
} from "./actor";

const INVITE_DAYS = 7;

type MemberRow = Awaited<ReturnType<typeof loadMembers>>[number];

async function loadMembers(tx: Tx, where: object) {
  return tx.membership.findMany({
    where,
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true, userId: true, status: true, allBranches: true,
      schedule: { select: { id: true, name: true } },
      user: { select: { name: true, email: true, username: true, mfaEnabled: true } },
      roles: { select: { role: { select: { id: true, code: true, name: true } } } },
      branchAccesses: { select: { branchId: true, accessLevel: true, branch: { select: { code: true } } } },
    },
  });
}

const toSummary = (m: MemberRow, youId: string): MemberSummary => ({
  membershipId: m.id,
  userId: m.userId,
  name: m.user.name,
  email: m.user.email,
  username: m.user.username,
  status: m.status,
  role: m.roles[0]?.role ?? null,
  allBranches: m.allBranches,
  branches: m.branchAccesses
    .map((a) => ({ branchId: a.branchId, code: a.branch.code, accessLevel: a.accessLevel }))
    .sort((a, b) => a.code.localeCompare(b.code)),
  mfaEnabled: m.user.mfaEnabled,
  schedule: m.schedule,
  isYou: m.userId === youId,
});

@Injectable()
export class MembersAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  // ───────────── Usuarios ─────────────

  list(ctx: RequestContext): Promise<MemberSummary[]> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const scope = await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel: "VIEW" });
      // Quien no ve todas las sucursales solo ve a las personas con acceso a las suyas.
      const where = actor.allBranches
        ? {}
        : { OR: [{ allBranches: true }, { branchAccesses: { some: { branchId: { in: scope.branchIds } } } }] };
      return (await loadMembers(tx, where)).map((m) => toSummary(m, ctx.auth.userId));
    });
  }

  update(ctx: RequestContext, membershipId: string, req: UpdateMemberRequest): Promise<MemberSummary> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const [target] = await loadMembers(tx, { id: membershipId });
      if (!target) throw notFound("Usuario");
      if (target.userId === ctx.auth.userId) {
        throw forbid("SELF_CHANGE", "No puedes cambiar tu propio acceso. Pídelo a otro administrador.");
      }
      await this.assertCanManageTarget(tx, actor, target);

      const before = { schedule: target.schedule?.name ?? null, status: target.status, role: target.roles[0]?.role.code ?? null, allBranches: target.allBranches, branches: target.branchAccesses.map((a) => a.branch.code) };

      if (req.roleId !== undefined) {
        const role = await tx.role.findUnique({ where: { id: req.roleId }, select: { id: true } });
        if (!role) throw notFound("Rol");
        assertCanGrant(actor, await rolePermissionCodes(tx, role.id));
        await tx.userRole.deleteMany({ where: { membershipId } });
        await tx.userRole.create({ data: { tenantId: ctx.auth.tenantId, membershipId, roleId: role.id } });
      }

      if (req.allBranches !== undefined || req.branches !== undefined) {
        await this.replaceBranches(tx, ctx.auth.tenantId, actor, target, req);
      }

      if (req.scheduleId !== undefined) {
        if (req.scheduleId !== null && !(await tx.userSchedule.findUnique({ where: { id: req.scheduleId }, select: { id: true } }))) throw notFound("Horario");
        await tx.membership.update({ where: { id: membershipId }, data: { scheduleId: req.scheduleId } });
      }

      if (req.status !== undefined && req.status !== target.status) {
        await tx.membership.update({ where: { id: membershipId }, data: { status: req.status } });
        if (req.status === "SUSPENDED") {
          // Corta de inmediato las sesiones de esta persona en ESTA empresa.
          await this.db.session.updateMany({ where: { userId: target.userId, tenantId: ctx.auth.tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
        }
      }

      await assertHasManager(tx);
      const [after] = await loadMembers(tx, { id: membershipId });
      await writeAudit(tx, ctx.auth.tenantId, {
        action: req.status && req.status !== target.status ? `user.${req.status === "SUSPENDED" ? "suspended" : "reactivated"}` : "user.access_updated",
        entityType: "membership", entityId: membershipId, actorUserId: ctx.auth.userId,
        before, after: { schedule: after!.schedule?.name ?? null, status: after!.status, role: after!.roles[0]?.role.code ?? null, allBranches: after!.allBranches, branches: after!.branchAccesses.map((a) => a.branch.code) },
      });
      return toSummary(after!, ctx.auth.userId);
    });
  }

  /** No se puede administrar a quien tiene más poder o está fuera de tus sucursales. */
  private async assertCanManageTarget(tx: Tx, actor: Actor, target: MemberRow): Promise<void> {
    for (const r of target.roles) assertCanGrant(actor, await rolePermissionCodes(tx, r.role.id));
    if (!actor.allBranches) {
      if (target.allBranches) throw forbid("BRANCH_FORBIDDEN", "No puedes administrar a quien accede a todas las sucursales.");
      if (!target.branchAccesses.some((a) => actor.manageBranchIds.has(a.branchId))) {
        throw forbid("BRANCH_FORBIDDEN", "Este usuario está fuera de tus sucursales.");
      }
    }
  }

  private async replaceBranches(tx: Tx, tenantId: string, actor: Actor, target: MemberRow, req: UpdateMemberRequest): Promise<void> {
    const makeAll = req.allBranches ?? target.allBranches;
    if (makeAll && !target.allBranches && !actor.allBranches) {
      throw forbid("FORBIDDEN", "Solo quien accede a todas las sucursales puede otorgar acceso a todas.");
    }
    if (!makeAll && target.allBranches && !actor.allBranches) {
      throw forbid("BRANCH_FORBIDDEN", "No puedes cambiar a quien accede a todas las sucursales.");
    }
    if (makeAll) {
      await tx.membership.update({ where: { id: target.id }, data: { allBranches: true } });
      await tx.userBranchAccess.deleteMany({ where: { membershipId: target.id } });
      return;
    }

    const requested = req.branches ?? target.branchAccesses.map((a) => ({ branchId: a.branchId, accessLevel: a.accessLevel }));
    if (requested.length === 0) throw badRequest("BRANCH_REQUIRED", "Indica al menos una sucursal o acceso a todas.");
    assertBranchesAssignable(actor, requested.map((r) => r.branchId));
    const exist = await tx.branch.count({ where: { id: { in: requested.map((r) => r.branchId) } } });
    if (exist !== new Set(requested.map((r) => r.branchId)).size) throw notFound("Sucursal");

    // Un administrador limitado conserva el acceso de la persona a sucursales que él no administra.
    const kept = actor.allBranches
      ? []
      : target.branchAccesses.filter((a) => !actor.manageBranchIds.has(a.branchId)).map((a) => ({ branchId: a.branchId, accessLevel: a.accessLevel }));
    const finalSet = new Map([...kept, ...requested].map((r) => [r.branchId, r]));

    await tx.membership.update({ where: { id: target.id }, data: { allBranches: false } });
    await tx.userBranchAccess.deleteMany({ where: { membershipId: target.id } });
    await tx.userBranchAccess.createMany({
      data: [...finalSet.values()].map((r) => ({ tenantId, membershipId: target.id, branchId: r.branchId, accessLevel: r.accessLevel })),
    });
  }

  // ───────────── Invitaciones ─────────────

  listInvitations(ctx: RequestContext): Promise<InvitationSummary[]> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const rows = await tx.invitation.findMany({
        where: { acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, email: true, allBranches: true, expiresAt: true, createdAt: true,
          role: { select: { id: true, name: true } },
          branches: { select: { branchId: true, branch: { select: { code: true } } } },
        },
      });
      const now = new Date();
      return rows
        // Un administrador limitado solo ve invitaciones a sus sucursales.
        .filter((r) => actor.allBranches || (!r.allBranches && r.branches.some((b) => actor.manageBranchIds.has(b.branchId))))
        .map((r) => ({
          id: r.id, email: r.email, role: r.role, allBranches: r.allBranches,
          branchCodes: r.branches.map((b) => b.branch.code).sort(),
          expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString(),
          state: r.expiresAt > now ? ("PENDING" as const) : ("EXPIRED" as const),
        }));
    });
  }

  invite(ctx: RequestContext, req: InviteUserRequest): Promise<InvitationSummary> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const role = await tx.role.findUnique({ where: { id: req.roleId }, select: { id: true, name: true } });
      if (!role) throw notFound("Rol");
      assertCanGrant(actor, await rolePermissionCodes(tx, role.id));
      if (req.allBranches && !actor.allBranches) {
        throw forbid("FORBIDDEN", "Solo quien accede a todas las sucursales puede otorgar acceso a todas.");
      }
      const branchIds = req.allBranches ? [] : req.branches.map((b) => b.branchId);
      assertBranchesAssignable(actor, branchIds);
      if (branchIds.length && (await tx.branch.count({ where: { id: { in: branchIds } } })) !== new Set(branchIds).size) throw notFound("Sucursal");

      if (await tx.membership.findFirst({ where: { user: { email: req.email } }, select: { id: true } })) {
        throw conflict("ALREADY_MEMBER", "Esa persona ya pertenece a la empresa.");
      }
      const info = await ctx.tenantInfo();
      const maxUsers = info.planLimits?.["maxUsers"];
      if (maxUsers !== undefined) {
        const used =
          (await tx.membership.count({ where: { status: { in: ["ACTIVE", "INVITED"] } } })) +
          (await tx.invitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, email: { not: req.email } } }));
        if (used >= maxUsers) throw conflict("PLAN_LIMIT", `Tu plan permite hasta ${maxUsers} usuarios.`);
      }

      await tx.invitation.updateMany({ where: { email: req.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const id = uuidv7();
      const { token, hash } = this.makeToken(ctx.auth.tenantId);
      const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
      await tx.invitation.create({
        data: { id, tenantId: ctx.auth.tenantId, email: req.email, roleId: role.id, allBranches: req.allBranches, tokenHash: hash, invitedById: ctx.auth.userId, expiresAt },
      });
      if (branchIds.length) {
        await tx.invitationBranch.createMany({
          data: req.branches.map((b) => ({ tenantId: ctx.auth.tenantId, invitationId: id, branchId: b.branchId, accessLevel: b.accessLevel })),
        });
      }
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "user.invited", entityType: "invitation", entityId: id, actorUserId: ctx.auth.userId,
        after: { email: req.email, role: role.name, allBranches: req.allBranches, branches: branchIds.length },
      });

      const inviter = await this.db.user.findUniqueOrThrow({ where: { id: ctx.auth.userId }, select: { name: true } });
      await this.mail
        .sendInvitation(req.email, info.legalName, inviter.name, role.name, this.inviteUrl(token), INVITE_DAYS)
        .catch(() => undefined);

      const codes = branchIds.length
        ? (await tx.branch.findMany({ where: { id: { in: branchIds } }, select: { code: true } })).map((b) => b.code).sort()
        : [];
      return {
        id, email: req.email, role, allBranches: req.allBranches, branchCodes: codes,
        expiresAt: expiresAt.toISOString(), createdAt: new Date().toISOString(), state: "PENDING" as const,
      };
    });
  }

  revokeInvitation(ctx: RequestContext, id: string): Promise<void> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const inv = await this.visibleInvitation(tx, actor, id);
      await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "user.invitation_revoked", entityType: "invitation", entityId: id, actorUserId: ctx.auth.userId, after: { email: inv.email },
      });
    });
  }

  /** Nuevo enlace (el anterior deja de servir) y nueva vigencia. */
  resendInvitation(ctx: RequestContext, id: string): Promise<void> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const inv = await this.visibleInvitation(tx, actor, id);
      const { token, hash } = this.makeToken(ctx.auth.tenantId);
      await tx.invitation.update({ where: { id }, data: { tokenHash: hash, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
      const [info, role, inviter] = await Promise.all([
        ctx.tenantInfo(),
        tx.role.findUniqueOrThrow({ where: { id: inv.roleId }, select: { name: true } }),
        this.db.user.findUniqueOrThrow({ where: { id: ctx.auth.userId }, select: { name: true } }),
      ]);
      await this.mail.sendInvitation(inv.email, info.legalName, inviter.name, role.name, this.inviteUrl(token), INVITE_DAYS).catch(() => undefined);
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "user.invitation_resent", entityType: "invitation", entityId: id, actorUserId: ctx.auth.userId, after: { email: inv.email },
      });
    });
  }

  private async visibleInvitation(tx: Tx, actor: Actor, id: string) {
    const inv = await tx.invitation.findFirst({
      where: { id, acceptedAt: null, revokedAt: null },
      include: { branches: { select: { branchId: true } } },
    });
    if (!inv) throw notFound("Invitación");
    if (!actor.allBranches && (inv.allBranches || !inv.branches.some((b) => actor.manageBranchIds.has(b.branchId)))) {
      throw forbid("BRANCH_FORBIDDEN", "Esa invitación está fuera de tus sucursales.");
    }
    return inv;
  }

  /** El token lleva el tenant (`<tenantId>.<secreto>`) para poder fijar el contexto RLS al aceptarlo. */
  private makeToken(tenantId: string): { token: string; hash: string } {
    const t = newToken();
    return { token: `${tenantId}.${t.token}`, hash: t.hash };
  }

  private inviteUrl(token: string): string {
    return `${this.config.appPublicUrl}/aceptar-invitacion?token=${token}`;
  }
}
