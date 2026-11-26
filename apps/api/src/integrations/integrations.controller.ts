import { Body, Controller, Get, HttpCode, Inject, Post, Put } from "@nestjs/common";
import { CloudinaryInput } from "@erp/contracts";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { IntegrationsService } from "./integrations.service";

/** Integraciones con servicios externos (solo quien tiene integrations.manage). */
@Controller("api/v1/integrations")
export class IntegrationsController {
  constructor(@Inject(IntegrationsService) private readonly integrations: IntegrationsService) {}

  @Get() @RequirePermission("integrations.manage")
  list(@Ctx() ctx: RequestContext) { return this.integrations.list(ctx); }
  @Put("cloudinary") @RequirePermission("integrations.manage")
  save(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CloudinaryInput)) b: CloudinaryInput) { return this.integrations.saveCloudinary(ctx, b); }
  @Post("cloudinary/test") @HttpCode(200) @RequirePermission("integrations.manage")
  test(@Ctx() ctx: RequestContext) { return this.integrations.testCloudinary(ctx); }
}
