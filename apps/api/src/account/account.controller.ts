import { Body, Controller, Get, HttpCode, Inject, Patch, Post } from "@nestjs/common";
import {
  ChangePasswordRequest, MfaConfirmRequest, MfaEnableRequest, MfaSetupRequest, UpdateProfileRequest,
  type MfaEnableResponse, type MfaSetupResponse, type SecurityOverview,
} from "@erp/contracts";
import { writeAudit } from "@erp/db";
import { Ctx } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { AccountService } from "./account.service";
import { MfaService } from "./mfa.service";

/** Seguridad de la cuenta propia: perfil, contraseña y MFA. Requiere sesión, no permisos de rol. */
@Controller("api/v1/me")
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  private audit(ctx: RequestContext, action: string, after?: Record<string, unknown>) {
    return ctx.run((tx) =>
      writeAudit(tx, ctx.auth.tenantId, {
        action, entityType: "user", entityId: ctx.auth.userId, actorUserId: ctx.auth.userId, after,
      }),
    );
  }

  @Get("security")
  security(@Ctx() ctx: RequestContext): Promise<SecurityOverview> {
    return this.account.overview(ctx.auth.userId);
  }

  @Patch("profile")
  async profile(@Ctx() ctx: RequestContext, @Body(new ZodPipe(UpdateProfileRequest)) body: UpdateProfileRequest) {
    const out = await this.account.updateProfile(ctx.auth.userId, body);
    await this.audit(ctx, "account.profile_updated", { fields: Object.keys(body) });
    return out;
  }

  @Post("password")
  @HttpCode(204)
  async password(
    @Ctx() ctx: RequestContext,
    @Body(new ZodPipe(ChangePasswordRequest)) body: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    await this.account.changePassword(ctx.auth.userId, ctx.auth.sessionId, body.currentPassword, body.newPassword);
    await this.audit(ctx, "account.password_changed");
  }

  @Post("mfa/setup")
  @HttpCode(200)
  setup(@Ctx() ctx: RequestContext, @Body(new ZodPipe(MfaSetupRequest)) body: { password: string }): Promise<MfaSetupResponse> {
    return this.mfa.beginSetup(ctx.auth.userId, body.password);
  }

  @Post("mfa/enable")
  @HttpCode(200)
  async enable(@Ctx() ctx: RequestContext, @Body(new ZodPipe(MfaEnableRequest)) body: { code: string }): Promise<MfaEnableResponse> {
    const out = await this.mfa.enable(ctx.auth.userId, body.code);
    await this.audit(ctx, "account.mfa_enabled");
    await this.account.notifyMfaChanged(ctx.auth.userId, true);
    return out;
  }

  @Post("mfa/disable")
  @HttpCode(204)
  async disable(@Ctx() ctx: RequestContext, @Body(new ZodPipe(MfaConfirmRequest)) body: { password: string; code: string }): Promise<void> {
    await this.mfa.disable(ctx.auth.userId, body.password, body.code);
    await this.audit(ctx, "account.mfa_disabled");
    await this.account.notifyMfaChanged(ctx.auth.userId, false);
  }

  @Post("mfa/recovery-codes")
  @HttpCode(200)
  async recoveryCodes(
    @Ctx() ctx: RequestContext,
    @Body(new ZodPipe(MfaConfirmRequest)) body: { password: string; code: string },
  ): Promise<MfaEnableResponse> {
    const out = await this.mfa.regenerateRecoveryCodes(ctx.auth.userId, body.password, body.code);
    await this.audit(ctx, "account.mfa_recovery_codes_regenerated");
    return out;
  }
}
