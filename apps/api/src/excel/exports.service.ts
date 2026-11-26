import { ConflictException, Injectable } from "@nestjs/common";
import type { ExcelFile } from "@erp/contracts";
import { notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { buildWorkbook, EXPORT_MAX_ROWS } from "./xlsx";

const stamp = () => new Date().toISOString().slice(0, 10);
const tooMany = () => new ConflictException({ code: "EXPORT_TOO_LARGE", message: `La exportación supera ${EXPORT_MAX_ROWS} filas. Filtra los datos e inténtalo de nuevo.` });

/**
 * Exportaciones Excel. Las columnas coinciden con las plantillas de importación: lo exportado se puede
 * corregir y volver a importar. Todo el texto pasa por la neutralización de fórmulas (`safeCell`).
 */
@Injectable()
export class ExportsService {
  async products(ctx: RequestContext): Promise<ExcelFile> {
    return ctx.run(async (tx) => {
      if ((await tx.product.count()) > EXPORT_MAX_ROWS) throw tooMany();
      const rows = await tx.product.findMany({
        orderBy: { code: "asc" },
        select: {
          code: true, name: true, description: true, kind: true, trackLots: true, trackExpiry: true, status: true,
          category: { select: { code: true } }, brand: { select: { name: true } }, baseUnit: { select: { code: true } },
          taxProfile: { select: { code: true } }, barcodes: { select: { barcode: true }, orderBy: { barcode: "asc" } },
        },
      });
      return {
        fileName: `productos-${stamp()}.xlsx`,
        contentBase64: await buildWorkbook([{
          name: "Productos",
          columns: [
            { header: "Código", width: 16 }, { header: "Nombre", width: 34 }, { header: "Descripción", width: 34 }, { header: "Tipo" },
            { header: "Categoría (código)" }, { header: "Marca" }, { header: "Unidad base (código)" }, { header: "Perfil fiscal (código)" },
            { header: "Lote", width: 8 }, { header: "Vencimiento", width: 13 }, { header: "Código de barras", width: 28 }, { header: "Estado", width: 11 },
          ],
          rows: rows.map((p) => [
            p.code, p.name, p.description, p.kind === "SERVICE" ? "Servicio" : "Bien", p.category?.code, p.brand?.name, p.baseUnit.code,
            p.taxProfile?.code, p.trackLots ? "Sí" : "No", p.trackExpiry ? "Sí" : "No", p.barcodes.map((b) => b.barcode).join(";"),
            p.status === "ACTIVE" ? "Activo" : "Inactivo",
          ]),
        }]),
      };
    });
  }

  async prices(ctx: RequestContext, listId: string): Promise<ExcelFile> {
    return ctx.run(async (tx) => {
      const list = await tx.priceList.findUnique({ where: { id: listId }, select: { code: true, name: true, priceMode: true } });
      if (!list) throw notFound("Lista de precios");
      const pps = await tx.productPrice.findMany({
        where: { priceListId: listId }, orderBy: { product: { code: "asc" } }, take: EXPORT_MAX_ROWS + 1,
        select: { product: { select: { code: true, name: true } }, tiers: { orderBy: { minQuantity: "asc" } } },
      });
      if (pps.length > EXPORT_MAX_ROWS) throw tooMany();
      return {
        fileName: `precios-${list.code}-${stamp()}.xlsx`,
        contentBase64: await buildWorkbook([{
          name: "Precios",
          columns: [
            { header: "Código de producto", width: 20 }, { header: "Nombre (solo referencia)", width: 34 },
            { header: "Cantidad mínima", width: 16 }, { header: "Cantidad máxima", width: 16 },
            { header: "Precio unitario", width: 24 },
          ],
          rows: pps.flatMap((pp) => pp.tiers.map((t) => [pp.product.code, pp.product.name, Number(t.minQuantity), t.maxQuantity === null ? null : Number(t.maxQuantity), Number(t.unitPrice)])),
        }]),
      };
    });
  }
}
