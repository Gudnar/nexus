import { Injectable } from "@nestjs/common";
import type { BranchDetail, BranchInput, BranchPatch } from "@erp/contracts";
import { uuidv7, writeAudit } from "@erp/db";
import type { RequestContext } from "../common/request-context";
import { conflict, forbid, loadActor, notFound } from "./actor";

@Injectable()
export class BranchesAdminService {
  /** Sucursales del alcance del usuario con su cantidad de usuarios activos. */
  /**
   * Todas las sucursales a las que el usuario tiene acceso, **incluidas las inactivas** (hay que
   * poder reactivarlas). No usa el alcance operativo, que solo contempla las activas.
   */
  list(ctx: RequestContext): Promise<BranchDetail[]> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const accessIds = actor.allBranches
        ? null
        : (await tx.userBranchAccess.findMany({ where: { membershipId: ctx.auth.membershipId }, select: { branchId: true } })).map((a) => a.branchId);
      const scope = { branchIds: accessIds };
      const [branches, explicit, allUsers] = await Promise.all([
        tx.branch.findMany({
          where: scope.branchIds ? { id: { in: scope.branchIds } } : {},
          orderBy: [{ isMain: "desc" }, { code: "asc" }],
          select: { id: true, code: true, name: true, isMain: true, status: true, address: true, phone: true, email: true },
        }),
        tx.userBranchAccess.groupBy({
          by: ["branchId"],
          where: { ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}), membership: { status: "ACTIVE" } },
          _count: { _all: true },
        }),
        tx.membership.count({ where: { allBranches: true, status: "ACTIVE" } }),
      ]);
      const per = new Map(explicit.map((e) => [e.branchId, e._count._all]));
      return branches.map((b) => ({ ...b, activeUsers: (per.get(b.id) ?? 0) + allUsers }));
    });
  }

  create(ctx: RequestContext, input: BranchInput): Promise<BranchDetail> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      if (!actor.allBranches) throw forbid("FORBIDDEN", "Solo quien accede a todas las sucursales puede crear nuevas.");

      const max = (await ctx.tenantInfo()).planLimits?.["maxBranches"];
      if (max !== undefined && (await tx.branch.count({ where: { status: "ACTIVE" } })) >= max) {
        throw conflict("PLAN_LIMIT", `Tu plan permite hasta ${max} sucursales activas.`);
      }
      if (await tx.branch.findUnique({ where: { tenantId_code: { tenantId: ctx.auth.tenantId, code: input.code } }, select: { id: true } })) {
        throw conflict("CODE_TAKEN", "Ya existe una sucursal con ese código.");
      }
      const id = uuidv7();
      const b = await tx.branch.create({
        data: {
          id, tenantId: ctx.auth.tenantId, code: input.code, name: input.name,
          address: input.address || null, phone: input.phone || null, email: input.email || null,
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "branch.created", entityType: "branch", entityId: id, branchId: id,
        actorUserId: ctx.auth.userId, after: { code: b.code, name: b.name },
      });
      return { id, code: b.code, name: b.name, isMain: false, status: b.status, address: b.address, phone: b.phone, email: b.email, activeUsers: 0 };
    });
  }

  update(ctx: RequestContext, id: string, patch: BranchPatch): Promise<BranchDetail> {
    return ctx.run(async (tx) => {
      const actor = await loadActor(ctx, tx);
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw notFound("Sucursal");
      if (!actor.manageBranchIds.has(id)) throw forbid("BRANCH_FORBIDDEN", "No administras esta sucursal.");

      if (patch.status === "INACTIVE" && before.status === "ACTIVE") {
        if (before.isMain) throw conflict("MAIN_BRANCH", "No puedes desactivar la sucursal principal. Designa otra como principal primero.");
        if ((await tx.branch.count({ where: { status: "ACTIVE", id: { not: id } } })) < 1) {
          throw conflict("LAST_BRANCH", "La empresa debe tener al menos una sucursal activa.");
        }
      }
      if (patch.isMain) {
        if (!actor.allBranches) throw forbid("FORBIDDEN", "Solo quien accede a todas las sucursales puede cambiar la principal.");
        if ((patch.status ?? before.status) !== "ACTIVE") throw conflict("MAIN_BRANCH", "La sucursal principal debe estar activa.");
        // El índice parcial exige una sola principal: se retira la anterior primero.
        await tx.branch.updateMany({ where: { isMain: true, id: { not: id } }, data: { isMain: false } });
      }

      const after = await tx.branch.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.address !== undefined ? { address: patch.address || null } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone || null } : {}),
          ...(patch.email !== undefined ? { email: patch.email || null } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.isMain ? { isMain: true } : {}),
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, {
        action: patch.isMain ? "branch.made_main" : patch.status && patch.status !== before.status ? `branch.${patch.status === "ACTIVE" ? "activated" : "deactivated"}` : "branch.updated",
        entityType: "branch", entityId: id, branchId: id, actorUserId: ctx.auth.userId,
        before: { name: before.name, status: before.status, isMain: before.isMain },
        after: { name: after.name, status: after.status, isMain: after.isMain },
      });
      const users = await tx.userBranchAccess.count({ where: { branchId: id, membership: { status: "ACTIVE" } } });
      const all = await tx.membership.count({ where: { allBranches: true, status: "ACTIVE" } });
      return {
        id, code: after.code, name: after.name, isMain: after.isMain, status: after.status,
        address: after.address, phone: after.phone, email: after.email, activeUsers: users + all,
      };
    });
  }
}
