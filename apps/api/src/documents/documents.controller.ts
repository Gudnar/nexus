import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { DepositVoucherParams, DocPaper, DocumentConfig, PrinterInput } from "@erp/contracts";
import { z } from "zod";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { DocumentsService } from "./documents.service";

const uuid = new ParseUUIDPipe();
const PrintTextRequest = z.object({ printerId: z.string().uuid() }).merge(DepositVoucherParams);
const RenderQuery = z.object({ paper: DocPaper.optional() }).merge(DepositVoucherParams);

/** Plantillas e impresoras (documents.manage); imprimir exige el permiso de ver el documento de origen (lo valida el servicio). */
@Controller("api/v1/documents")
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get("templates")
  templates(@Ctx() ctx: RequestContext) { return this.documents.templates(ctx); }
  @Put("templates/:docType") @RequirePermission("documents.manage")
  save(@Ctx() ctx: RequestContext, @Param("docType") t: string, @Body(new ZodPipe(DocumentConfig)) b: DocumentConfig) { return this.documents.saveTemplate(ctx, t, b); }
  @Post("templates/:docType/preview") @HttpCode(200) @RequirePermission("documents.manage")
  preview(@Ctx() ctx: RequestContext, @Param("docType") t: string, @Body(new ZodPipe(DocumentConfig)) b: DocumentConfig) { return this.documents.preview(ctx, t, b); }

  @Get("render/:docType/:id")
  render(@Ctx() ctx: RequestContext, @Param("docType") t: string, @Param("id", uuid) id: string, @Query(new ZodPipe(RenderQuery)) q: z.infer<typeof RenderQuery>) { return this.documents.render(ctx, t, id, q.paper, { amount: q.amount, concept: q.concept }); }

  @Get("printers")
  printers(@Ctx() ctx: RequestContext) { return this.documents.printers(ctx); }
  @Post("printers") @HttpCode(200) @RequirePermission("documents.manage")
  addPrinter(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PrinterInput)) b: PrinterInput) { return this.documents.addPrinter(ctx, b); }
  @Put("printers/:id") @RequirePermission("documents.manage")
  updatePrinter(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(PrinterInput)) b: PrinterInput) { return this.documents.updatePrinter(ctx, id, b); }
  @Post("printers/:id/test") @HttpCode(200) @RequirePermission("documents.manage")
  testPrinter(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.documents.printTest(ctx, id); }
  @Post("printers/:id/drawer") @HttpCode(200)
  drawer(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.documents.openDrawer(ctx, id); }
  @Post("print/:docType/:id") @HttpCode(200)
  printText(@Ctx() ctx: RequestContext, @Param("docType") t: string, @Param("id", uuid) id: string, @Body(new ZodPipe(PrintTextRequest)) b: z.infer<typeof PrintTextRequest>) { return this.documents.printText(ctx, t, id, b.printerId, { amount: b.amount, concept: b.concept }); }
  @Post("printers/:id/deactivate") @HttpCode(200) @RequirePermission("documents.manage")
  deactivate(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.documents.deactivatePrinter(ctx, id); }
}
