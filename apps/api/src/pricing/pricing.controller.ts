import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import {
  BulkPricesRequest, PriceListInput, PriceListPatch, QuoteRequest, SetPricesRequest, TaxCodeInput, TaxCodePatch, TaxProfileInput, TaxProfilePatch, TaxRateInput,
} from "@erp/contracts";
import { z } from "zod";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { PricingService } from "./pricing.service";
import { TaxesService } from "./taxes.service";

const uuid = new ParseUUIDPipe();
const GridQuery = z.object({ categoryId: z.string().uuid().optional(), q: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(500).default(500) });
const PricesQuery = z.object({ q: z.string().trim().max(80).optional(), cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

/** Lectura y cotización: pricing.read · escritura: pricing.manage. */
@Controller("api/v1/pricing")
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @Get("lists") @RequirePermission("pricing.read")
  lists(@Ctx() ctx: RequestContext) { return this.pricing.list(ctx); }
  @Post("lists") @RequirePermission("pricing.manage")
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(PriceListInput)) b: PriceListInput) { return this.pricing.create(ctx, b); }
  @Patch("lists/:id") @RequirePermission("pricing.manage")
  update(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(PriceListPatch)) b: PriceListPatch) { return this.pricing.update(ctx, id, b); }

  @Get("lists/:id/prices") @RequirePermission("pricing.read")
  prices(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Query(new ZodPipe(PricesQuery)) q: z.infer<typeof PricesQuery>) { return this.pricing.prices(ctx, id, q); }
  @Get("lists/:id/grid") @RequirePermission("pricing.read")
  grid(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Query(new ZodPipe(GridQuery)) q: z.infer<typeof GridQuery>) { return this.pricing.grid(ctx, id, q); }
  @Post("lists/:id/prices/bulk") @HttpCode(200) @RequirePermission("pricing.manage")
  bulk(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(BulkPricesRequest)) b: BulkPricesRequest) { return this.pricing.bulkSetPrices(ctx, id, b); }
  @Put("lists/:id/prices/:productId") @RequirePermission("pricing.manage")
  setPrices(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Param("productId", uuid) productId: string, @Body(new ZodPipe(SetPricesRequest)) b: SetPricesRequest) {
    return this.pricing.setPrices(ctx, id, productId, b);
  }
  @Delete("lists/:id/prices/:productId") @HttpCode(204) @RequirePermission("pricing.manage")
  remove(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Param("productId", uuid) productId: string) { return this.pricing.removePrice(ctx, id, productId); }
  @Get("lists/:id/prices/:productId/history") @RequirePermission("pricing.manage")
  history(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Param("productId", uuid) productId: string) { return this.pricing.history(ctx, id, productId); }

  @Post("quote") @HttpCode(200) @RequirePermission("pricing.read")
  quote(@Ctx() ctx: RequestContext, @Body(new ZodPipe(QuoteRequest)) b: QuoteRequest) { return this.pricing.quote(ctx, b); }
}

/** Capas 1 y 2 del modelo fiscal. Lectura: taxes.read · escritura: taxes.manage. */
@Controller("api/v1/taxes")
export class TaxesController {
  constructor(@Inject(TaxesService) private readonly taxes: TaxesService) {}

  @Get("codes") @RequirePermission("taxes.read")
  codes(@Ctx() ctx: RequestContext) { return this.taxes.listCodes(ctx); }
  @Post("codes") @RequirePermission("taxes.manage")
  createCode(@Ctx() ctx: RequestContext, @Body(new ZodPipe(TaxCodeInput)) b: TaxCodeInput) { return this.taxes.createCode(ctx, b); }
  @Patch("codes/:id") @RequirePermission("taxes.manage")
  updateCode(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(TaxCodePatch)) b: TaxCodePatch) { return this.taxes.updateCode(ctx, id, b); }
  @Post("codes/:id/rates") @RequirePermission("taxes.manage")
  addRate(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(TaxRateInput)) b: TaxRateInput) { return this.taxes.addRate(ctx, id, b); }

  @Get("profiles") @RequirePermission("taxes.read")
  profiles(@Ctx() ctx: RequestContext) { return this.taxes.listProfiles(ctx); }
  @Post("profiles") @RequirePermission("taxes.manage")
  createProfile(@Ctx() ctx: RequestContext, @Body(new ZodPipe(TaxProfileInput)) b: TaxProfileInput) { return this.taxes.createProfile(ctx, b); }
  @Patch("profiles/:id") @RequirePermission("taxes.manage")
  updateProfile(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(TaxProfilePatch)) b: TaxProfilePatch) { return this.taxes.updateProfile(ctx, id, b); }
}
