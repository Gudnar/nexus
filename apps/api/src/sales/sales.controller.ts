import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import {
  CustomerInput, CustomerPatch, PosProductQuery, SalePreviewRequest, SaleSearchQuery, PaymentInput, SaleReturnInput, QuoteConvertRequest, SalesSettings, QuoteReserveRequest, QuoteInput, QuotePatch, QuoteStatus, SaleConfirmRequest, SaleInput, SalePatch, SaleStatus, SaleVoidRequest,
} from "@erp/contracts";
import { z } from "zod";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { InventoryService } from "../inventory/inventory.service";
import { ApprovalsService } from "../approvals/approvals.service";
import { PosService } from "./pos.service";
import { SalesQueryService } from "./sales-query.service";
import { ReturnsService } from "./returns.service";
import { CustomersService } from "./customers.service";
import { QuotesService } from "./quotes.service";
import { SalesService } from "./sales.service";

const uuid = new ParseUUIDPipe();
const CustomerQuery = z.object({ q: z.string().trim().max(80).optional() });
const SalesQuery = z.object({ status: SaleStatus.optional(), customerId: z.string().uuid().optional(), paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]).optional() });
const QuotesQuery = z.object({ status: QuoteStatus.optional(), customerId: z.string().uuid().optional() });

/** Clientes (customers.*), cotizaciones y ventas (sales.*). El alcance por sucursal lo valida cada servicio. */
@Controller("api/v1/sales")
export class SalesController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(QuotesService) private readonly quotes: QuotesService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(ReturnsService) private readonly returns: ReturnsService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(SalesQueryService) private readonly query: SalesQueryService,
    @Inject(PosService) private readonly pos: PosService,
  ) {}

  /** Almacenes desde los que se puede vender (quien vende no necesita ver todo el inventario). */
  @Get("warehouses") @RequirePermission("sales.create")
  warehouses(@Ctx() ctx: RequestContext) { return this.inventory.listWarehouses(ctx); }

  // Clientes
  @Get("customers") @RequirePermission("customers.read")
  listCustomers(@Ctx() ctx: RequestContext, @Query(new ZodPipe(CustomerQuery)) q: z.infer<typeof CustomerQuery>) { return this.customers.list(ctx, q.q); }
  @Get("customers/:id") @RequirePermission("customers.read")
  getCustomer(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.customers.get(ctx, id); }
  @Post("customers") @RequirePermission("customers.manage")
  createCustomer(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CustomerInput)) b: CustomerInput) { return this.customers.create(ctx, b); }
  @Patch("customers/:id") @RequirePermission("customers.manage")
  updateCustomer(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CustomerPatch)) b: CustomerPatch) { return this.customers.update(ctx, id, b); }

  // Punto de venta
  @Get("product-search") @RequirePermission("sales.create")
  productSearch(@Ctx() ctx: RequestContext, @Query(new ZodPipe(PosProductQuery)) q: PosProductQuery) { return this.pos.searchProducts(ctx, q); }
  @Post("preview") @HttpCode(200) @RequirePermission("sales.create")
  preview(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SalePreviewRequest)) b: SalePreviewRequest) { return this.pos.preview(ctx, b); }

  // Consulta e historial
  @Get("search") @RequirePermission("sales.read")
  search(@Ctx() ctx: RequestContext, @Query(new ZodPipe(SaleSearchQuery)) q: SaleSearchQuery) { return this.query.search(ctx, q); }
  @Get("sellers") @RequirePermission("sales.read")
  sellers(@Ctx() ctx: RequestContext) { return this.query.sellers(ctx); }

  // Dónde se cobra (en el punto de venta o solo en caja)
  @Get("settings") @RequirePermission("sales.read")
  settings(@Ctx() ctx: RequestContext) { return this.sales.getSettings(ctx); }
  @Put("settings") @RequirePermission("tenant.settings.update")
  setSettings(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SalesSettings)) b: SalesSettings) { return this.sales.setSettings(ctx, b); }

  // Ventas
  @Get("orders") @RequirePermission("sales.read")
  listSales(@Ctx() ctx: RequestContext, @Query(new ZodPipe(SalesQuery)) q: z.infer<typeof SalesQuery>) { return this.sales.list(ctx, q); }
  @Get("orders/:id") @RequirePermission("sales.read")
  getSale(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.sales.get(ctx, id); }
  @Post("orders") @RequirePermission("sales.create")
  createSale(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SaleInput)) b: SaleInput) { return this.sales.create(ctx, b); }
  @Patch("orders/:id") @RequirePermission("sales.update_draft")
  updateSale(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(SalePatch)) b: SalePatch) { return this.sales.update(ctx, id, b); }
  @Post("orders/:id/discard") @HttpCode(200) @RequirePermission("sales.update_draft")
  discard(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.sales.discard(ctx, id); }
  @Post("orders/:id/confirm") @HttpCode(200) @RequirePermission("sales.confirm")
  confirm(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(SaleConfirmRequest)) b: SaleConfirmRequest) { return this.sales.confirm(ctx, id, b); }
  @Post("orders/:id/payments") @HttpCode(200) @RequirePermission("sales.collect")
  collect(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(PaymentInput)) b: PaymentInput) { return this.sales.collect(ctx, id, b); }
  @Post("orders/:id/void") @HttpCode(200) @RequirePermission("sales.execute_void")
  async voidSale(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(SaleVoidRequest)) b: SaleVoidRequest) {
    await this.approvals.assertVoidAllowedDirectly(ctx, id);
    return this.sales.voidSale(ctx, id, b.reason);
  }

  // Devoluciones (notas de crédito internas)
  @Get("returns") @RequirePermission("sales.read")
  listReturns(@Ctx() ctx: RequestContext, @Query("saleId", new ParseUUIDPipe({ optional: true })) saleId?: string) { return this.returns.list(ctx, saleId); }
  @Get("returns/:id") @RequirePermission("sales.read")
  getReturn(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.returns.get(ctx, id); }
  @Post("orders/:id/returns") @RequirePermission("sales.return")
  createReturn(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(SaleReturnInput)) b: SaleReturnInput) { return this.returns.create(ctx, id, b); }

  // Cotizaciones
  @Get("quotes") @RequirePermission("sales.read")
  listQuotes(@Ctx() ctx: RequestContext, @Query(new ZodPipe(QuotesQuery)) q: z.infer<typeof QuotesQuery>) { return this.quotes.list(ctx, q); }
  @Get("quotes/:id") @RequirePermission("sales.read")
  getQuote(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.quotes.get(ctx, id); }
  @Post("quotes") @RequirePermission("sales.create")
  createQuote(@Ctx() ctx: RequestContext, @Body(new ZodPipe(QuoteInput)) b: QuoteInput) { return this.quotes.create(ctx, b); }
  @Patch("quotes/:id") @RequirePermission("sales.update_draft")
  updateQuote(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(QuotePatch)) b: QuotePatch) { return this.quotes.update(ctx, id, b); }
  @Post("quotes/:id/send") @HttpCode(200) @RequirePermission("sales.create")
  sendQuote(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.quotes.send(ctx, id); }
  @Post("quotes/:id/accept") @HttpCode(200) @RequirePermission("sales.create")
  acceptQuote(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.quotes.accept(ctx, id); }
  @Post("quotes/:id/reject") @HttpCode(200) @RequirePermission("sales.create")
  rejectQuote(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.quotes.reject(ctx, id); }
  @Post("quotes/:id/cancel") @HttpCode(200) @RequirePermission("sales.create")
  cancelQuote(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.quotes.cancel(ctx, id); }
  @Post("quotes/:id/reserve") @HttpCode(200) @RequirePermission("sales.create")
  reserveQuote(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(QuoteReserveRequest)) b: QuoteReserveRequest) { return this.quotes.reserve(ctx, id, b); }
  @Post("quotes/:id/convert") @HttpCode(200) @RequirePermission("sales.create")
  convertQuote(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(QuoteConvertRequest)) b: QuoteConvertRequest) { return this.quotes.convert(ctx, id, b); }
}
