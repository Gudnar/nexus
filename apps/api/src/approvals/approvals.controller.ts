import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApprovalDecisionInput, ApprovalDelegationInput, ApprovalRequestInput, ApprovalWorkflowInput } from "@erp/contracts";
import { z } from "zod";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { ApprovalsService } from "./approvals.service";
import { NotificationsService } from "./notifications.service";

const uuid = new ParseUUIDPipe();
const ListQuery = z.object({ scope: z.enum(["mine", "inbox", "all"]).default("mine"), status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXECUTED"]).optional() });
const NotifQuery = z.object({ unread: z.enum(["true", "false"]).optional() });

/** Aprobaciones: ver lo propio (approvals.read), decidir (approvals.decide), configurar flujos (approvals.manage); avisos del usuario sin permiso especial. */
@Controller("api/v1")
export class ApprovalsController {
  constructor(
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get("approvals/workflows") @RequirePermission("approvals.read")
  workflows(@Ctx() ctx: RequestContext) { return this.approvals.workflows(ctx); }
  @Put("approvals/workflows/:eventType") @RequirePermission("approvals.manage")
  saveWorkflow(@Ctx() ctx: RequestContext, @Param("eventType") e: string, @Body(new ZodPipe(ApprovalWorkflowInput)) b: ApprovalWorkflowInput) { return this.approvals.saveWorkflow(ctx, e, b); }

  @Get("approvals/requests") @RequirePermission("approvals.read")
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) { return this.approvals.list(ctx, q.scope, q.status); }
  @Get("approvals/requests/:id") @RequirePermission("approvals.read")
  get(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.approvals.get(ctx, id); }
  @Post("approvals/requests") @HttpCode(200) @RequirePermission("approvals.read")
  request(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ApprovalRequestInput)) b: ApprovalRequestInput) { return this.approvals.request(ctx, b); }
  @Post("approvals/requests/:id/decide") @HttpCode(200) @RequirePermission("approvals.decide")
  decide(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(ApprovalDecisionInput)) b: ApprovalDecisionInput) { return this.approvals.decide(ctx, id, b); }
  @Post("approvals/requests/:id/cancel") @HttpCode(200) @RequirePermission("approvals.read")
  cancel(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.approvals.cancel(ctx, id); }
  @Post("approvals/requests/:id/retry") @HttpCode(200) @RequirePermission("approvals.decide")
  retry(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.approvals.retry(ctx, id); }

  @Get("approvals/delegations") @RequirePermission("approvals.read")
  delegations(@Ctx() ctx: RequestContext) { return this.approvals.delegations(ctx); }
  @Get("approvals/delegate-candidates") @RequirePermission("approvals.decide")
  candidates(@Ctx() ctx: RequestContext) { return this.approvals.delegateCandidates(ctx); }
  @Post("approvals/delegations") @HttpCode(200) @RequirePermission("approvals.decide")
  delegate(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ApprovalDelegationInput)) b: ApprovalDelegationInput) { return this.approvals.delegate(ctx, b); }
  @Post("approvals/delegations/:id/revoke") @HttpCode(200) @RequirePermission("approvals.read")
  revoke(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.approvals.revokeDelegation(ctx, id); }

  @Get("notifications")
  notifs(@Ctx() ctx: RequestContext, @Query(new ZodPipe(NotifQuery)) q: z.infer<typeof NotifQuery>) { return this.notifications.list(ctx, q.unread === "true"); }
  @Post("notifications/read") @HttpCode(200)
  readAll(@Ctx() ctx: RequestContext) { return this.notifications.markRead(ctx, null); }
  @Post("notifications/:id/read") @HttpCode(200)
  read(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.notifications.markRead(ctx, id); }
}
