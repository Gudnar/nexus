import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import {
  AddVariantInput, BrandInput, BrandPatch, ImageFileUpload, CategoryInput, CategoryPatch, ProductGroupInput, ProductImageInput, ProductInput, ProductListQuery, ProductPatch, UnitInput, UnitPatch,
} from "@erp/contracts";
import { Ctx, RequirePermission } from "../common/decorators";
import type { RequestContext } from "../common/request-context";
import { ZodPipe } from "../common/zod.pipe";
import { MastersService } from "./masters.service";
import { ProductGroupsService } from "./product-groups.service";
import { ProductImagesService } from "./product-images.service";
import { ProductsService } from "./products.service";

const uuid = new ParseUUIDPipe();

/** Lectura: catalog.read · escritura: catalog.manage. El catálogo es global a la empresa (no por sucursal). */
@Controller("api/v1/catalog")
export class CatalogController {
  constructor(
    @Inject(MastersService) private readonly masters: MastersService,
    @Inject(ProductsService) private readonly products: ProductsService,
    @Inject(ProductImagesService) private readonly images: ProductImagesService,
    @Inject(ProductGroupsService) private readonly groups: ProductGroupsService,
  ) {}

  // Unidades
  @Get("units") @RequirePermission("catalog.read")
  units(@Ctx() ctx: RequestContext) { return this.masters.listUnits(ctx); }
  @Post("units") @RequirePermission("catalog.manage")
  createUnit(@Ctx() ctx: RequestContext, @Body(new ZodPipe(UnitInput)) b: UnitInput) { return this.masters.createUnit(ctx, b); }
  @Patch("units/:id") @RequirePermission("catalog.manage")
  updateUnit(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(UnitPatch)) b: UnitPatch) { return this.masters.updateUnit(ctx, id, b); }

  // Categorías
  @Get("categories") @RequirePermission("catalog.read")
  categories(@Ctx() ctx: RequestContext) { return this.masters.listCategories(ctx); }
  @Post("categories") @RequirePermission("catalog.manage")
  createCategory(@Ctx() ctx: RequestContext, @Body(new ZodPipe(CategoryInput)) b: CategoryInput) { return this.masters.createCategory(ctx, b); }
  @Patch("categories/:id") @RequirePermission("catalog.manage")
  updateCategory(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(CategoryPatch)) b: CategoryPatch) { return this.masters.updateCategory(ctx, id, b); }

  // Marcas
  @Get("brands") @RequirePermission("catalog.read")
  brands(@Ctx() ctx: RequestContext) { return this.masters.listBrands(ctx); }
  @Post("brands") @RequirePermission("catalog.manage")
  createBrand(@Ctx() ctx: RequestContext, @Body(new ZodPipe(BrandInput)) b: BrandInput) { return this.masters.createBrand(ctx, b); }
  @Patch("brands/:id") @RequirePermission("catalog.manage")
  updateBrand(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(BrandPatch)) b: BrandPatch) { return this.masters.updateBrand(ctx, id, b); }

  // Productos
  @Get("products") @RequirePermission("catalog.read")
  list(@Ctx() ctx: RequestContext, @Query(new ZodPipe(ProductListQuery)) q: ProductListQuery) { return this.products.list(ctx, q); }
  @Get("products/:id") @RequirePermission("catalog.read")
  get(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.products.get(ctx, id); }
  @Get("image-storage") @RequirePermission("catalog.read")
  imageStorage(@Ctx() ctx: RequestContext) { return this.images.storage(ctx); }
  @Post("products/:id/images/upload") @HttpCode(200) @RequirePermission("catalog.manage")
  uploadImage(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(ImageFileUpload)) b: ImageFileUpload) { return this.images.upload(ctx, id, b); }
  @Get("products/:id/images") @RequirePermission("catalog.read")
  listImages(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.images.list(ctx, id); }
  @Post("products/:id/images/signature") @HttpCode(200) @RequirePermission("catalog.manage")
  imageSignature(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.images.signature(ctx, id); }
  @Post("products/:id/images") @HttpCode(200) @RequirePermission("catalog.manage")
  addImage(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(ProductImageInput)) b: ProductImageInput) { return this.images.add(ctx, id, b); }
  @Post("products/:id/images/:imageId/primary") @HttpCode(200) @RequirePermission("catalog.manage")
  primaryImage(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Param("imageId", uuid) imageId: string) { return this.images.setPrimary(ctx, id, imageId); }
  @Delete("products/:id/images/:imageId") @HttpCode(204) @RequirePermission("catalog.manage")
  removeImage(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Param("imageId", uuid) imageId: string) { return this.images.remove(ctx, id, imageId); }

  @Post("product-groups") @RequirePermission("catalog.manage")
  createGroup(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ProductGroupInput)) b: ProductGroupInput) { return this.groups.create(ctx, b); }
  @Get("product-groups/:id") @RequirePermission("catalog.read")
  getGroup(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.groups.get(ctx, id); }
  @Post("product-groups/:id/variants") @RequirePermission("catalog.manage")
  addVariant(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(AddVariantInput)) b: AddVariantInput) { return this.groups.addVariant(ctx, id, b); }

  @Post("products") @RequirePermission("catalog.manage")
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ProductInput)) b: ProductInput) { return this.products.create(ctx, b); }
  @Patch("products/:id") @RequirePermission("catalog.manage")
  update(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(ProductPatch)) b: ProductPatch) { return this.products.update(ctx, id, b); }
}
