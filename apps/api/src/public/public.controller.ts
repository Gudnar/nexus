import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Post, Req } from "@nestjs/common";
import { RegisterRequest, VerifyTokenRequest, type PublicConfig } from "@erp/contracts";
import { Public, type AppRequest } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { AppConfig } from "../config";
import { DevMailbox } from "../mail/mail.service";
import { PlatformSettingsService } from "../platform/platform.service";
import { RecoveryChannels } from "../account/recovery.service";
import { PASSWORD_MIN_LENGTH } from "../security/password-policy";
import { RegistrationService } from "./registration.service";

@Public()
@Controller("api/v1/public")
export class PublicController {
  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(RecoveryChannels) private readonly channels: RecoveryChannels,
    @Inject(RegistrationService) private readonly registration: RegistrationService,
  ) {}

  /** Lo que la pantalla de acceso necesita saber antes de autenticarse. */
  @Get("config")
  async config(): Promise<PublicConfig> {
    return {
      registrationEnabled: await this.settings.registrationEnabled(),
      recoveryChannels: this.channels.available(),
      passwordMinLength: PASSWORD_MIN_LENGTH,
    };
  }

  @Post("register")
  @HttpCode(202)
  async register(@Body(new ZodPipe(RegisterRequest)) body: RegisterRequest, @Req() req: AppRequest) {
    await this.registration.request(body, { ip: req.ip });
    return { status: "pending_verification" };
  }

  @Post("register/verify")
  @HttpCode(200)
  verify(@Body(new ZodPipe(VerifyTokenRequest)) body: { token: string }, @Req() req: AppRequest) {
    return this.registration.verify(body.token, { ip: req.ip });
  }
}

/** Buzón de desarrollo: solo existe con MAIL_TRANSPORT=log y fuera de producción. */
@Public()
@Controller("api/v1/dev")
export class DevController {
  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DevMailbox) private readonly mailbox: DevMailbox,
  ) {}

  private guard(): void {
    if (this.config.isProduction || this.config.mailTransport !== "log") throw new NotFoundException();
  }

  @Get("mailbox")
  list() {
    this.guard();
    return this.mailbox.messages;
  }

  @Delete("mailbox")
  @HttpCode(204)
  clear() {
    this.guard();
    this.mailbox.clear();
  }
}
