import { Controller, Get, Inject, Query } from "@nestjs/common";
import { DashboardQuery, type DashboardResponse } from "@erp/contracts";
import { Ctx } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { DashboardService } from "./dashboard.service";

@Controller("api/v1/dashboard")
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  /**
   * Cualquier miembro autenticado: el alcance siempre se limita a sus sucursales y cada
   * sección exige su propio permiso. Cabecera X-Branch-Id: UUID o "ALL" (por defecto).
   */
  @Get()
  summary(
    @Ctx() ctx: RequestContext,
    @Query(new ZodPipe(DashboardQuery)) query: DashboardQuery,
  ): Promise<DashboardResponse> {
    return this.dashboard.summary(ctx, query.days);
  }
}
