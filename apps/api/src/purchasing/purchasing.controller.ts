import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { BankAccountInput, BankAccountPatch, GoodsReceiptInput, PurchaseOrderInput, PurchaseOrderPatch, PurchaseStatus, ReverseRequest, SupplierInput, SupplierPatch } from "@erp/contracts";
import { z } from "zod";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { PurchasingService } from "./purchasing.service";

const uuid = new ParseUUIDPipe();
const OrdersQuery = z.object({ status: PurchaseStatus.optional(), supplierId: z.string().uuid().optional() });

/** Compras. Lectura: purchases.read · proveedores y órdenes: purchases.manage · recepciones: purchases.receive. */
@Controller("api/v1/purchasing")
export class PurchasingController {
  constructor(@Inject(PurchasingService) private readonly purchasing: PurchasingService) {}

  @Get("suppliers") @RequirePermission("purchases.read")
  suppliers(@Ctx() ctx: RequestContext) { return this.purchasing.listSuppliers(ctx); }
  @Post("suppliers") @RequirePermission("purchases.manage")
  createSupplier(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SupplierInput)) b: SupplierInput) { return this.purchasing.createSupplier(ctx, b); }
  @Patch("suppliers/:id") @RequirePermission("purchases.manage")
  updateSupplier(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(SupplierPatch)) b: SupplierPatch) { return this.purchasing.updateSupplier(ctx, id, b); }

  @Get("suppliers/:id/bank-accounts") @RequirePermission("purchases.read")
  bankAccounts(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.purchasing.listBankAccounts(ctx, id); }
  @Post("suppliers/:id/bank-accounts") @RequirePermission("purchases.manage")
  addBankAccount(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(BankAccountInput)) b: BankAccountInput) { return this.purchasing.createBankAccount(ctx, id, b); }
  @Patch("suppliers/:id/bank-accounts/:accountId") @RequirePermission("purchases.manage")
  updateBankAccount(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Param("accountId", uuid) accountId: string, @Body(new ZodPipe(BankAccountPatch)) b: BankAccountPatch) { return this.purchasing.updateBankAccount(ctx, id, accountId, b); }
  @Get("suppliers/:id/history") @RequirePermission("purchases.read")
  history(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.purchasing.supplierHistory(ctx, id); }

  @Get("orders") @RequirePermission("purchases.read")
  orders(@Ctx() ctx: RequestContext, @Query(new ZodPipe(OrdersQuery)) q: z.infer<typeof OrdersQuery>) { return this.purchasing.listOrders(ctx, q); }
  @Get("orders/:id") @RequirePermission("purchases.read")
  order(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.purchasing.getOrder(ctx, id); }
  @Post("orders") @RequirePermission("purchases.manage")
  createOrder(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PurchaseOrderInput)) b: PurchaseOrderInput) { return this.purchasing.createOrder(ctx, b); }
  @Patch("orders/:id") @RequirePermission("purchases.manage")
  updateOrder(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(PurchaseOrderPatch)) b: PurchaseOrderPatch) { return this.purchasing.updateOrder(ctx, id, b); }
  @Post("orders/:id/issue") @HttpCode(200) @RequirePermission("purchases.manage")
  issue(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.purchasing.issueOrder(ctx, id); }
  @Post("orders/:id/cancel") @HttpCode(200) @RequirePermission("purchases.manage")
  cancel(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.purchasing.cancelOrder(ctx, id); }
  @Post("orders/:id/close") @HttpCode(200) @RequirePermission("purchases.manage")
  close(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.purchasing.closeOrder(ctx, id); }

  @Get("receipts") @RequirePermission("purchases.read")
  receipts(@Ctx() ctx: RequestContext) { return this.purchasing.listReceipts(ctx); }
  @Post("receipts") @RequirePermission("purchases.receive")
  receive(@Ctx() ctx: RequestContext, @Body(new ZodPipe(GoodsReceiptInput)) b: GoodsReceiptInput) { return this.purchasing.createReceipt(ctx, b); }
  @Post("receipts/:id/void") @HttpCode(200) @RequirePermission("purchases.receive")
  voidReceipt(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(ReverseRequest)) b: ReverseRequest) { return this.purchasing.voidReceipt(ctx, id, b.reason); }
}
