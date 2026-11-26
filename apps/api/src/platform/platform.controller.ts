import {
  type CanActivate, Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Put, Post, Req, UseGuards,
  type ExecutionContext, UnauthorizedException,
} from "@nestjs/common";
import { CreateTenantRequest, PlatformLoginRequest, SetRegistrationRequest, UpdateTenantRequest } from "@erp/contracts";
import { TokenService } from "../auth/token.service";
import { Public, type AppRequest } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { PlatformAuthService, PlatformSettingsService } from "./platform.service";
import { PlatformTenantsService } from "./tenants.service";

interface PlatformRequest extends AppRequest {
  platformUserId?: string;
}

/** Solo tokens con audiencia "erp-platform": un token de tenant nunca sirve aquí (ni al revés). */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(PlatformAuthService) private readonly platform: PlatformAuthService,
  ) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    const req = host.switchToHttp().getRequest<PlatformRequest>();
    const header = req.headers["authorization"];
    const value = Array.isArray(header) ? header[0] : header;
    const token = value?.startsWith("Bearer ") ? value.slice(7).trim() : undefined;
    const id = token ? await this.tokens.verifyPlatform(token) : null;
    const user = id ? await this.platform.find(id) : null;
    if (!user) throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Autenticación de plataforma requerida" });
    req.platformUserId = user.id;
    return true;
  }
}

@Controller("api/v1/platform")
export class PlatformController {
  constructor(
    @Inject(PlatformAuthService) private readonly auth: PlatformAuthService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(PlatformTenantsService) private readonly tenants: PlatformTenantsService,
  ) {}

  @Public()
  @Post("auth/login")
  @HttpCode(200)
  login(@Body(new ZodPipe(PlatformLoginRequest)) body: { email: string; password: string; totp?: string }, @Req() req: AppRequest) {
    return this.auth.login(body.email, body.password, body.totp, req.ip);
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Get("settings")
  get() {
    return this.settings.get();
  }

  @Public()
  @UseGuards(PlatformGuard)
  @Put("settings/registration")
  setRegistration(@Body(new ZodPipe(SetRegistrationRequest)) body: { enabled: boolean }, @Req() req: PlatformRequest) {
    return this.settings.setRegistration(body.enabled, req.platformUserId!);
  }

  @Public() @UseGuards(PlatformGuard) @Get("plans")
  plans() { return this.tenants.plans(); }

  @Public() @UseGuards(PlatformGuard) @Get("tenants")
  listTenants() { return this.tenants.list(); }

  @Public() @UseGuards(PlatformGuard) @Post("tenants") @HttpCode(200)
  createTenant(@Body(new ZodPipe(CreateTenantRequest)) body: CreateTenantRequest, @Req() req: PlatformRequest) { return this.tenants.create(body, req.platformUserId!); }

  @Public() @UseGuards(PlatformGuard) @Patch("tenants/:id")
  updateTenant(@Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(UpdateTenantRequest)) body: UpdateTenantRequest, @Req() req: PlatformRequest) { return this.tenants.update(id, body, req.platformUserId!); }
}
