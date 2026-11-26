import { Inject, Injectable } from "@nestjs/common";
import { type DashboardResponse, PENDING_DASHBOARD_MODULES } from "@erp/contracts";
import type { RequestContext } from "../common/request-context";
import { DB, type Db } from "../db";

/**
 * Panel consolidado del tenant (plan §2.3). El alcance (todas las sucursales accesibles o
 * una concreta) lo resuelve y valida `RequestContext.branchScope`. Cada sección exige su
 * propio permiso y, si falta, se devuelve `null` (no se rellena con datos parciales).
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async summary(ctx: RequestContext, days: number): Promise<DashboardResponse> {
    const perms = await ctx.permissions();
    const since = new Date(Date.now() - days * 86_400_000);
    const visible: string[] = [];

    const data = await ctx.run(async (tx) => {
      const scope = await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel: "VIEW" });
      const me = await tx.membership.findUniqueOrThrow({
        where: { id: ctx.auth.membershipId },
        select: { allBranches: true },
      });
      const ids = scope.branchIds;
      const branchRows = await tx.branch.findMany({
        where: { id: { in: ids } },
        orderBy: [{ isMain: "desc" }, { code: "asc" }],
        select: { id: true, code: true, name: true, isMain: true, status: true },
      });

      let branches: DashboardResponse["branches"] = null;
      if (perms.has("branches.read")) {
        visible.push("branches");
        const [explicit, allBranchesUsers] = await Promise.all([
          tx.userBranchAccess.groupBy({
            by: ["branchId"],
            where: { branchId: { in: ids }, membership: { status: "ACTIVE" } },
            _count: { _all: true },
          }),
          tx.membership.count({ where: { allBranches: true, status: "ACTIVE" } }),
        ]);
        const byBranch = new Map(explicit.map((e) => [e.branchId, e._count._all]));
        branches = branchRows.map((b) => ({ ...b, activeUsers: (byBranch.get(b.id) ?? 0) + allBranchesUsers }));
      }

      let users: DashboardResponse["users"] = null;
      if (perms.has("users.read")) {
        visible.push("users");
        const rows = await tx.membership.groupBy({
          by: ["status"],
          where: { OR: [{ allBranches: true }, { branchAccesses: { some: { branchId: { in: ids } } } }] },
          _count: { _all: true },
        });
        const n = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
        users = { active: n("ACTIVE"), suspended: n("SUSPENDED"), invited: n("INVITED") };
      }

      let activity: DashboardResponse["activity"] = null;
      let system: DashboardResponse["system"] = null;
      let actorIds: string[] = [];
      if (perms.has("audit.read")) {
        visible.push("activity", "system");
        // Los eventos de nivel tenant (sin sucursal) solo los ve quien tiene acceso a todas.
        const includeTenantLevel = scope.all && me.allBranches;
        const branchFilter = includeTenantLevel
          ? { OR: [{ branchId: { in: ids } }, { branchId: null }] }
          : { branchId: { in: ids } };

        const [recent, counts, outbox] = await Promise.all([
          tx.auditLog.findMany({
            where: { occurredAt: { gte: since }, ...branchFilter },
            orderBy: { occurredAt: "desc" },
            take: 20,
            select: { id: true, occurredAt: true, action: true, entityType: true, entityId: true, branchId: true, actorUserId: true },
          }),
          tx.auditLog.groupBy({
            by: ["action"],
            where: { occurredAt: { gte: since }, ...branchFilter },
            _count: { _all: true },
            orderBy: { _count: { action: "desc" } },
            take: 10,
          }),
          tx.outboxEvent.groupBy({ by: ["status"], where: branchFilter, _count: { _all: true } }),
        ]);
        actorIds = [...new Set(recent.map((r) => r.actorUserId).filter((x): x is string => !!x))];
        activity = {
          includesTenantLevelEvents: includeTenantLevel,
          actionCounts: counts.map((c) => ({ action: c.action, count: c._count._all })),
          recent: recent.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString(), actorName: null })),
        };
        const o = (s: string) => outbox.find((x) => x.status === s)?._count._all ?? 0;
        system = { outbox: { pending: o("PENDING"), failed: o("FAILED"), dead: o("DEAD") } };
      }

      return { scope, me, branchRows, branches, users, activity, system, actorIds };
    });

    // Nombres de actores: tabla global de usuarios, fuera de la transacción del tenant.
    if (data.activity && data.actorIds.length) {
      const names = new Map(
        (await this.db.user.findMany({ where: { id: { in: data.actorIds } }, select: { id: true, name: true } })).map(
          (u) => [u.id, u.name],
        ),
      );
      for (const r of data.activity.recent) r.actorName = r.actorUserId ? (names.get(r.actorUserId) ?? null) : null;
    }

    const { scope, me, branchRows } = data;
    return {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      scope: {
        mode: scope.all ? "ALL" : "BRANCH",
        restricted: scope.all && !me.allBranches,
        label: scope.all
          ? me.allBranches ? "Todas las sucursales" : "Todas mis sucursales"
          : `Sucursal ${branchRows[0]?.code ?? ""} — ${branchRows[0]?.name ?? ""}`.trim(),
        branchIds: scope.branchIds,
      },
      visibleSections: visible,
      branches: data.branches,
      users: data.users,
      activity: data.activity,
      system: data.system,
      pendingModules: [...PENDING_DASHBOARD_MODULES],
    };
  }
}
