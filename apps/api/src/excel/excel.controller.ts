import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ImportConfirmRequest, ImportKind, ImportPreviewRequest } from "@erp/contracts";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { ExportsService } from "./exports.service";
import { ImportsService } from "./imports.service";

const uuid = new ParseUUIDPipe();

/**
 * Importación: plantilla → subir (vista previa, NO aplica nada) → confirmar. Los permisos de escritura
 * se comprueban en el servicio según el tipo (catalog.manage / pricing.manage).
 */
@Controller("api/v1/imports")
export class ImportsController {
  constructor(@Inject(ImportsService) private readonly imports: ImportsService) {}

  @Get("template/:kind") @RequirePermission("catalog.read")
  template(@Param("kind") kind: string) {
    const k = ImportKind.safeParse(kind);
    if (!k.success) throw new NotFoundException();
    return this.imports.template(k.data);
  }

  @Get() @RequirePermission("catalog.read")
  list(@Ctx() ctx: RequestContext) { return this.imports.list(ctx); }

  @Post("preview") @HttpCode(200) @RequirePermission("catalog.read")
  preview(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ImportPreviewRequest)) b: ImportPreviewRequest) { return this.imports.preview(ctx, b); }

  @Get(":id") @RequirePermission("catalog.read")
  get(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.imports.get(ctx, id); }

  @Post(":id/confirm") @HttpCode(200) @RequirePermission("catalog.read")
  confirm(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(ImportConfirmRequest)) b: ImportConfirmRequest) { return this.imports.confirm(ctx, id, b); }
}

/** Exportar exige el permiso de lectura del dato y `reports.export` (plan §18.4). */
@Controller("api/v1/exports")
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @Get("products") @RequirePermission("catalog.read", "reports.export")
  products(@Ctx() ctx: RequestContext) { return this.exports.products(ctx); }

  @Get("prices/:listId") @RequirePermission("pricing.read", "reports.export")
  prices(@Ctx() ctx: RequestContext, @Param("listId", uuid) listId: string) { return this.exports.prices(ctx, listId); }
}
