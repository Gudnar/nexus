import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import {
  ForgotPasswordRequest, LoginRequest, MfaVerifyRequest, RefreshRequest, ResetPasswordRequest,
  type RecoveryChannel,
} from "@erp/contracts";
import { RecoveryService } from "../account/recovery.service";
import { Ctx, Public, type AppRequest } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { AuthService } from "./auth.service";

const meta = (req: AppRequest) => ({
  ip: req.ip,
  userAgent: Array.isArray(req.headers["user-agent"]) ? req.headers["user-agent"][0] : req.headers["user-agent"],
});

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RecoveryService) private readonly recovery: RecoveryService,
  ) {}

  /** Devuelve tokens, o un desafío MFA (`mfaRequired`) si la cuenta tiene verificación en dos pasos. */
  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodPipe(LoginRequest)) body: LoginRequest, @Req() req: AppRequest) {
    return this.auth.login(body, meta(req));
  }

  @Public()
  @Post("mfa/verify")
  @HttpCode(200)
  verifyMfa(@Body(new ZodPipe(MfaVerifyRequest)) body: MfaVerifyRequest, @Req() req: AppRequest) {
    return this.auth.verifyMfa(body.mfaToken, body.code, meta(req));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(new ZodPipe(RefreshRequest)) body: RefreshRequest, @Req() req: AppRequest) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Ctx() ctx: RequestContext): Promise<void> {
    await this.auth.logout(ctx.auth.sessionId);
  }

  /** Respuesta siempre 202 e idéntica, exista o no la cuenta. */
  @Public()
  @Post("password/forgot")
  @HttpCode(202)
  async forgot(
    @Body(new ZodPipe(ForgotPasswordRequest)) body: { identifier: string; channel: RecoveryChannel },
    @Req() req: AppRequest,
  ) {
    await this.recovery.forgot(body.identifier, body.channel, meta(req));
    return { status: "accepted" };
  }

  @Public()
  @Post("password/reset")
  @HttpCode(204)
  async reset(
    @Body(new ZodPipe(ResetPasswordRequest)) body: { token: string; password: string; mfaCode?: string },
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.recovery.reset(body.token, body.password, body.mfaCode, meta(req));
  }
}
