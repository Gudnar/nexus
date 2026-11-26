import { Inject, Injectable } from "@nestjs/common";
import type { ImageFileUpload, ImageStorageInfo, ImageUploadSignature, ProductImageInput, ProductImageView } from "@erp/contracts";
import { uuidv7, writeAudit } from "@erp/db";
import { badRequest, conflict, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { destroy, isCloudUrl, signParams, thumbOf, uploadUrl } from "../integrations/cloudinary.client";
import { IntegrationsService } from "../integrations/integrations.service";
import { MAX_UPLOAD_BYTES, removeStored, saveFile, sniffImage } from "../media/media.store";

export const MAX_IMAGES = 6;
const MAX_BYTES = MAX_UPLOAD_BYTES;
const noCloud = () => conflict("INTEGRATION_NOT_READY", "Para subir fotos primero conecta Cloudinary en Configuración → Integraciones.");

export const imageView = (i: { id: string; url: string; publicId: string; isPrimary: boolean; position: number; bytes: number | null; width: number | null; height: number | null }): ProductImageView => ({
  id: i.id, url: i.url, thumbUrl: thumbOf(i.url), publicId: i.publicId, isPrimary: i.isPrimary, position: i.position, bytes: i.bytes, width: i.width, height: i.height,
});

/** Fotos de producto, guardadas en Cloudinary: el navegador las sube con una firma del servidor y aquí se registran. */
@Injectable()
export class ProductImagesService {
  constructor(@Inject(IntegrationsService) private readonly integrations: IntegrationsService) {}

  /** Dónde se guardan las fotos hoy: en Cloudinary si está activo; si no, en el servidor. */
  async storage(ctx: RequestContext): Promise<ImageStorageInfo> {
    return { mode: (await this.integrations.creds(ctx)) ? "CLOUDINARY" : "SERVER", maxImages: MAX_IMAGES, maxBytes: MAX_BYTES };
  }

  /** Sube la foto al servidor (solo cuando Cloudinary no está activo). Se valida por sus bytes, no por su nombre. */
  async upload(ctx: RequestContext, productId: string, input: ImageFileUpload): Promise<ProductImageView> {
    if (await this.integrations.creds(ctx)) throw conflict("CLOUDINARY_ACTIVE", "Cloudinary está activo: las fotos se suben allí.");
    const data = Buffer.from(input.contentBase64, "base64");
    if (data.length === 0) throw badRequest("IMAGE_INVALID", "El archivo está vacío.");
    if (data.length > MAX_BYTES) throw badRequest("IMAGE_TOO_BIG", "La foto supera los 5 MB.");
    const kind = sniffImage(data);
    if (!kind) throw badRequest("IMAGE_INVALID", "El archivo no es una imagen JPG, PNG, WebP o GIF.");
    const id = uuidv7();
    const file = `${id}.${kind.ext}`;
    const view = await ctx.run(async (tx) => {
      if (!(await tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw notFound("Producto");
      const existing = await tx.productImage.findMany({ where: { productId }, select: { position: true } });
      if (existing.length >= MAX_IMAGES) throw conflict("IMAGE_LIMIT", `Un producto admite hasta ${MAX_IMAGES} fotos.`);
      const img = await tx.productImage.create({
        data: {
          id, tenantId: ctx.auth.tenantId, productId, url: `/media/${ctx.auth.tenantId}/${file}`, publicId: `local/${file}`, bytes: data.length,
          position: existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0, isPrimary: existing.length === 0,
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "product.image_added", entityType: "product", entityId: productId, actorUserId: ctx.auth.userId, after: { publicId: img.publicId, storage: "server" } });
      return imageView(img);
    });
    // El archivo se escribe al final: si la base falla no queda un archivo huérfano.
    try { await saveFile(ctx.auth.tenantId, file, data); } catch (e) {
      await ctx.run((tx) => tx.productImage.delete({ where: { id } }));
      throw e;
    }
    return view;
  }

  async list(ctx: RequestContext, productId: string): Promise<ProductImageView[]> {
    return ctx.run(async (tx) => {
      if (!(await tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw notFound("Producto");
      return (await tx.productImage.findMany({ where: { productId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })).map(imageView);
    });
  }

  async signature(ctx: RequestContext, productId: string): Promise<ImageUploadSignature> {
    const creds = await this.integrations.creds(ctx);
    if (!creds) throw noCloud();
    await ctx.run(async (tx) => {
      if (!(await tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw notFound("Producto");
      if ((await tx.productImage.count({ where: { productId } })) >= MAX_IMAGES) throw conflict("IMAGE_LIMIT", `Un producto admite hasta ${MAX_IMAGES} fotos.`);
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signParams({ folder: creds.folder, timestamp }, creds.apiSecret);
    return { uploadUrl: uploadUrl(creds.cloudName), cloudName: creds.cloudName, apiKey: creds.apiKey, timestamp, folder: creds.folder, signature, maxBytes: MAX_BYTES };
  }

  async add(ctx: RequestContext, productId: string, input: ProductImageInput): Promise<ProductImageView> {
    const creds = await this.integrations.creds(ctx);
    if (!creds) throw noCloud();
    // La foto debe ser de NUESTRA nube y de nuestra carpeta: no se aceptan direcciones cualquiera.
    if (!isCloudUrl(input.url, creds.cloudName) || !input.publicId.startsWith(`${creds.folder}/`)) throw badRequest("IMAGE_NOT_ALLOWED", "La imagen no pertenece a tu cuenta de Cloudinary.");
    if (input.bytes !== undefined && input.bytes > MAX_BYTES) throw badRequest("IMAGE_TOO_BIG", "La foto supera los 5 MB.");
    return ctx.run(async (tx) => {
      if (!(await tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw notFound("Producto");
      const existing = await tx.productImage.findMany({ where: { productId }, select: { position: true } });
      if (existing.length >= MAX_IMAGES) throw conflict("IMAGE_LIMIT", `Un producto admite hasta ${MAX_IMAGES} fotos.`);
      if (await tx.productImage.findFirst({ where: { publicId: input.publicId }, select: { id: true } })) throw conflict("IMAGE_EXISTS", "Esa foto ya está registrada.");
      const img = await tx.productImage.create({
        data: {
          id: uuidv7(), tenantId: ctx.auth.tenantId, productId, url: input.url, publicId: input.publicId, bytes: input.bytes ?? null, width: input.width ?? null, height: input.height ?? null,
          position: existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0, isPrimary: existing.length === 0,
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "product.image_added", entityType: "product", entityId: productId, actorUserId: ctx.auth.userId, after: { publicId: input.publicId } });
      return imageView(img);
    });
  }

  async setPrimary(ctx: RequestContext, productId: string, imageId: string): Promise<ProductImageView[]> {
    await ctx.run(async (tx) => {
      const img = await tx.productImage.findFirst({ where: { id: imageId, productId } });
      if (!img) throw notFound("Foto");
      await tx.productImage.updateMany({ where: { productId, isPrimary: true }, data: { isPrimary: false } });
      await tx.productImage.update({ where: { id: imageId }, data: { isPrimary: true } });
    });
    return this.list(ctx, productId);
  }

  async remove(ctx: RequestContext, productId: string, imageId: string): Promise<void> {
    const publicId = await ctx.run(async (tx) => {
      const img = await tx.productImage.findFirst({ where: { id: imageId, productId } });
      if (!img) throw notFound("Foto");
      await tx.productImage.delete({ where: { id: imageId } });
      if (img.isPrimary) {
        const next = await tx.productImage.findFirst({ where: { productId }, orderBy: { position: "asc" } });
        if (next) await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "product.image_removed", entityType: "product", entityId: productId, actorUserId: ctx.auth.userId, after: { publicId: img.publicId } });
      return img.publicId;
    });
    // Se borra también del lugar donde estaba guardada; si falla, la foto ya no está en el producto de todas formas.
    if (publicId.startsWith("local/")) return removeStored(ctx.auth.tenantId, publicId.slice(6));
    const creds = await this.integrations.creds(ctx);
    if (creds) await destroy(creds, publicId, this.integrations.fetchFn);
  }
}
