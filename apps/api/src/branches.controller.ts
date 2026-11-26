import { Controller, Get } from "@nestjs/common";
import type { BranchSummary } from "@erp/contracts";
import { Ctx, RequirePermission } from "./common/decorators";
import type { RequestContext } from "./common/request-context";

@Controller("api/v1/branches")
export class BranchesController {
  /**
   * Sin X-Branch-Id: todas las sucursales a las que el usuario tiene acceso.
   * Con X-Branch-Id: solo esa sucursal, validada contra el acceso (403 si no).
   */
  @Get()
  @RequirePermission("branches.read")
  list(@Ctx() ctx: RequestContext): Promise<BranchSummary[]> {
    return ctx.run(async (tx) => {
      const scope = await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel: "VIEW" });
      return tx.branch.findMany({
        where: { id: { in: scope.branchIds } },
        orderBy: [{ isMain: "desc" }, { code: "asc" }],
        select: { id: true, code: true, name: true, isMain: true, status: true },
      });
    });
  }
}
