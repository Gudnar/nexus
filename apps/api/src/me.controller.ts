import { Controller, Get, Inject } from "@nestjs/common";
import type { MeResponse } from "@erp/contracts";
import { Ctx } from "./common/decorators";
import type { RequestContext } from "./common/request-context";
import { DB, type Db } from "./db";

@Controller("api/v1/me")
export class MeController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async me(@Ctx() ctx: RequestContext): Promise<MeResponse> {
    const permissions = [...(await ctx.permissions())].sort();
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: ctx.auth.userId },
      select: { id: true, email: true, username: true, name: true },
    });
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: ctx.auth.tenantId },
      select: { id: true, slug: true, legalName: true },
    });
    return ctx.run(async (tx) => {
      const m = await tx.membership.findUniqueOrThrow({
        where: { id: ctx.auth.membershipId },
        select: { id: true, allBranches: true, defaultBranchId: true },
      });
      const scope = await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel: "VIEW" });
      const branches = await tx.branch.findMany({
        where: { id: { in: scope.branchIds } },
        orderBy: [{ isMain: "desc" }, { code: "asc" }],
        select: { id: true, code: true, name: true, isMain: true, status: true },
      });
      return {
        user, tenant, membershipId: m.id, allBranches: m.allBranches,
        defaultBranchId: m.defaultBranchId, permissions, branches,
      };
    });
  }
}

