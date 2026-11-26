import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { AdjustmentRequest, KardexQuery, ReverseRequest, StockQuery, ValuationPolicyInput, WarehouseInput, WarehousePatch } from "@erp/contracts";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { InventoryService } from "./inventory.service";

const uuid = new ParseUUIDPipe();

/**
 * Inventario. Lectura: inventory.read · almacenes y valoración: inventory.manage · ajustes y reversas:
 * inventory.adjust.approve. El alcance por sucursal lo resuelve y valida el servicio en cada llamada.
 */
@Controller("api/v1/inventory")
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Get("warehouses") @RequirePermission("inventory.read")
  warehouses(@Ctx() ctx: RequestContext) { return this.inventory.listWarehouses(ctx); }
  @Post("warehouses") @RequirePermission("inventory.manage")
  createWarehouse(@Ctx() ctx: RequestContext, @Body(new ZodPipe(WarehouseInput)) b: WarehouseInput) { return this.inventory.createWarehouse(ctx, b); }
  @Patch("warehouses/:id") @RequirePermission("inventory.manage")
  updateWarehouse(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(WarehousePatch)) b: WarehousePatch) { return this.inventory.updateWarehouse(ctx, id, b); }

  @Get("stock") @RequirePermission("inventory.read")
  stock(@Ctx() ctx: RequestContext, @Query(new ZodPipe(StockQuery)) q: StockQuery) { return this.inventory.stock(ctx, q); }
  @Get("stock/lots") @RequirePermission("inventory.read")
  lots(@Ctx() ctx: RequestContext, @Query("productId", uuid) productId: string, @Query("warehouseId", new ParseUUIDPipe({ optional: true })) warehouseId?: string) {
    return this.inventory.lotBalances(ctx, productId, warehouseId);
  }
  @Get("kardex") @RequirePermission("inventory.read")
  kardex(@Ctx() ctx: RequestContext, @Query(new ZodPipe(KardexQuery)) q: KardexQuery) { return this.inventory.kardex(ctx, q); }

  @Get("adjustments") @RequirePermission("inventory.read")
  adjustments(@Ctx() ctx: RequestContext) { return this.inventory.listAdjustments(ctx); }
  @Post("adjustments") @RequirePermission("inventory.adjust.approve")
  adjust(@Ctx() ctx: RequestContext, @Body(new ZodPipe(AdjustmentRequest)) b: AdjustmentRequest) { return this.inventory.createAdjustment(ctx, b); }
  @Post("movements/:id/reverse") @HttpCode(200) @RequirePermission("inventory.adjust.approve")
  reverse(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(ReverseRequest)) b: ReverseRequest) { return this.inventory.reverseMovement(ctx, id, b); }

  @Get("valuation/policy") @RequirePermission("inventory.read")
  policies(@Ctx() ctx: RequestContext) { return this.inventory.listPolicies(ctx); }
  @Post("valuation/policy") @HttpCode(200) @RequirePermission("inventory.manage")
  setPolicy(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ValuationPolicyInput)) b: ValuationPolicyInput) { return this.inventory.setPolicy(ctx, b); }
  @Get("reconciliation") @RequirePermission("inventory.manage")
  reconciliation(@Ctx() ctx: RequestContext) { return this.inventory.reconcile(ctx); }
}
