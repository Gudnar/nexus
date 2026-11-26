import {
  Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req,
} from "@nestjs/common";
import {
  AcceptInvitationRequest, BranchInput, BranchPatch, InviteUserRequest, RoleInput, RolePatch, ScheduleInput, SchedulePatch,
  UpdateMemberRequest,
  type InvitationInfo,
} from "@erp/contracts";
import { Ctx, Public, RequirePermission, type AppRequest } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { BranchesAdminService } from "./branches-admin.service";
import { InvitationAcceptService } from "./invitation-accept.service";
import { MembersAdminService } from "./members-admin.service";
import { RolesAdminService } from "./roles-admin.service";
import { SchedulesAdminService } from "./schedules-admin.service";

const uuid = new ParseUUIDPipe();

@Controller("api/v1/admin/branches")
export class AdminBranchesController {
  constructor(@Inject(BranchesAdminService) private readonly branches: BranchesAdminService) {}

  @Get()
  @RequirePermission("branches.read")
  list(@Ctx() ctx: RequestContext) {
    return this.branches.list(ctx);
  }

  @Post()
  @RequirePermission("branches.manage")
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(BranchInput)) body: BranchInput) {
    return this.branches.create(ctx, body);
  }

  @Patch(":id")
  @RequirePermission("branches.manage")
  update(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(BranchPatch)) body: BranchPatch) {
    return this.branches.update(ctx, id, body);
  }
}

@Controller("api/v1/admin")
export class AdminMembersController {
  constructor(@Inject(MembersAdminService) private readonly members: MembersAdminService) {}

  @Get("users")
  @RequirePermission("users.read")
  list(@Ctx() ctx: RequestContext) {
    return this.members.list(ctx);
  }

  @Patch("users/:id")
  @RequirePermission("users.manage")
  update(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(UpdateMemberRequest)) body: UpdateMemberRequest) {
    return this.members.update(ctx, id, body);
  }

  @Get("invitations")
  @RequirePermission("users.read")
  invitations(@Ctx() ctx: RequestContext) {
    return this.members.listInvitations(ctx);
  }

  @Post("invitations")
  @RequirePermission("users.manage")
  invite(@Ctx() ctx: RequestContext, @Body(new ZodPipe(InviteUserRequest)) body: InviteUserRequest) {
    return this.members.invite(ctx, body);
  }

  @Post("invitations/:id/resend")
  @HttpCode(204)
  @RequirePermission("users.manage")
  resend(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) {
    return this.members.resendInvitation(ctx, id);
  }

  @Delete("invitations/:id")
  @HttpCode(204)
  @RequirePermission("users.manage")
  revoke(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) {
    return this.members.revokeInvitation(ctx, id);
  }
}

@Controller("api/v1/admin")
export class AdminRolesController {
  constructor(@Inject(RolesAdminService) private readonly roles: RolesAdminService) {}

  @Get("permissions")
  @RequirePermission("roles.read")
  permissions(@Ctx() ctx: RequestContext) {
    return this.roles.permissions(ctx);
  }

  @Get("roles")
  @RequirePermission("roles.read")
  list(@Ctx() ctx: RequestContext) {
    return this.roles.list(ctx);
  }

  @Post("roles")
  @RequirePermission("roles.manage")
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(RoleInput)) body: RoleInput) {
    return this.roles.create(ctx, body);
  }

  @Patch("roles/:id")
  @RequirePermission("roles.manage")
  update(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(RolePatch)) body: RolePatch) {
    return this.roles.update(ctx, id, body);
  }

  @Delete("roles/:id")
  @HttpCode(204)
  @RequirePermission("roles.manage")
  remove(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) {
    return this.roles.remove(ctx, id);
  }
}

@Controller("api/v1/admin/schedules")
export class AdminSchedulesController {
  constructor(@Inject(SchedulesAdminService) private readonly schedules: SchedulesAdminService) {}

  @Get()
  @RequirePermission("users.read")
  list(@Ctx() ctx: RequestContext) {
    return this.schedules.list(ctx);
  }

  @Post()
  @RequirePermission("users.manage")
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ScheduleInput)) body: ScheduleInput) {
    return this.schedules.create(ctx, body);
  }

  @Patch(":id")
  @RequirePermission("users.manage")
  update(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(SchedulePatch)) body: SchedulePatch) {
    return this.schedules.update(ctx, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("users.manage")
  remove(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) {
    return this.schedules.remove(ctx, id);
  }
}

/** Aceptación de invitaciones: pública (la persona aún no tiene sesión). */
@Public()
@Controller("api/v1/public/invitations")
export class PublicInvitationsController {
  constructor(@Inject(InvitationAcceptService) private readonly accept: InvitationAcceptService) {}

  @Post("info")
  @HttpCode(200)
  info(@Body() body: { token?: string }, @Req() req: AppRequest): Promise<InvitationInfo> {
    return this.accept.info(String(body?.token ?? ""), { ip: req.ip });
  }

  @Post("accept")
  @HttpCode(200)
  acceptInvitation(@Body(new ZodPipe(AcceptInvitationRequest)) body: AcceptInvitationRequest, @Req() req: AppRequest) {
    return this.accept.accept(body, { ip: req.ip });
  }
}
