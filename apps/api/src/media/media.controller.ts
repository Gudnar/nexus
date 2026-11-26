import { Controller, Get, Header, NotFoundException, Param, StreamableFile } from "@nestjs/common";
import { Public } from "../common/decorators";
import { FILE_RE, MIME, readStored, TENANT_RE, type ImageKind } from "./media.store";

/**
 * Archivos subidos al servidor (fotos de productos cuando no hay Cloudinary). Se sirven sin sesión, como las imágenes de una tienda:
 * el nombre es un identificador aleatorio imposible de adivinar y solo se entregan imágenes (jamás HTML ni SVG).
 */
@Controller("api/v1/public/media")
export class MediaController {
  @Public()
  @Get(":tenantId/:file")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Content-Security-Policy", "default-src 'none'; sandbox")
  async get(@Param("tenantId") tenantId: string, @Param("file") file: string): Promise<StreamableFile> {
    if (!TENANT_RE.test(tenantId) || !FILE_RE.test(file)) throw new NotFoundException({ code: "NOT_FOUND", message: "Archivo no encontrado" });
    const data = await readStored(tenantId, file);
    if (!data) throw new NotFoundException({ code: "NOT_FOUND", message: "Archivo no encontrado" });
    const ext = file.split(".").pop() as ImageKind["ext"];
    return new StreamableFile(data, { type: MIME[ext], disposition: "inline" });
  }
}
