import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { SupplierPaymentInput } from "@erp/contracts";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { FinanceService } from "./finance.service";

const uuid = new ParseUUIDPipe();

/** Cuentas por cobrar (sales.read), por pagar (purchases.read) y pagos a proveedores (purchases.pay). El alcance por sucursal lo valida el servicio. */
@Controller("api/v1/finance")
export class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  @Get("receivables") @RequirePermission("sales.read")
  receivables(@Ctx() ctx: RequestContext) { return this.finance.receivables(ctx); }
  @Get("receivables/customers/:id") @RequirePermission("sales.read")
  receivableDetail(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.finance.receivableDetail(ctx, id); }

  @Get("payables") @RequirePermission("purchases.read")
  payables(@Ctx() ctx: RequestContext) { return this.finance.payables(ctx); }
  @Get("payables/suppliers/:id") @RequirePermission("purchases.read")
  payableDetail(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.finance.payableDetail(ctx, id); }

  @Get("supplier-payments") @RequirePermission("purchases.read")
  payments(@Ctx() ctx: RequestContext, @Query("supplierId", new ParseUUIDPipe({ optional: true })) supplierId?: string) { return this.finance.listPayments(ctx, supplierId); }
  @Post("supplier-payments") @RequirePermission("purchases.pay")
  pay(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SupplierPaymentInput)) b: SupplierPaymentInput) { return this.finance.pay(ctx, b); }
}
