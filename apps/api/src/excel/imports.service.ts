import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  ProductInput, ProductPatch,
  type ExcelFile, type ImportConfirmRequest, type ImportJobSummary, type ImportKind, type ImportPreview, type ImportPreviewRequest, type ImportResult,
} from "@erp/contracts";
import { Prisma, uuidv7, writeAudit, type Tx } from "@erp/db";
import { forbid, notFound } from "../admin/actor";
import { ProductsService } from "../catalog/products.service";
import type { RequestContext } from "../common/request-context";
import { PricingService } from "../pricing/pricing.service";
import { validateTiers } from "../pricing/tiers";
import { buildWorkbook, MAX_FILE_BYTES, parseBool, parseNumber, readSheet, type SheetRow } from "./xlsx";

interface Totals { rows: number; valid: number; errors: number; create: number; update: number }
interface RowError { row: number; message: string }
interface StoredRow { row: number; action: "CREATE" | "UPDATE" | "SET_PRICES"; key: string; summary: string; data: any }

const PERMISSION: Record<ImportKind, string> = { PRODUCTS: "catalog.manage", PRICES: "pricing.manage" };

// Columnas de cada plantilla (clave normalizada → título)
const PRODUCT_COLUMNS = [
  "Código", "Nombre", "Descripción", "Tipo", "Categoría (código)", "Marca", "Unidad base (código)",
  "Perfil fiscal (código)", "Lote", "Vencimiento", "Código de barras", "Estado",
];
const PRICE_COLUMNS = ["Código de producto", "Cantidad mínima", "Cantidad máxima", "Precio unitario"];

const STATUS_WORDS: Record<string, "ACTIVE" | "INACTIVE"> = { activo: "ACTIVE", active: "ACTIVE", inactivo: "INACTIVE", inactive: "INACTIVE" };
const issueText = (path: (string | number)[], message: string) => (path.length ? `${path.join(".")}: ${message}` : message);

@Injectable()
export class ImportsService {
  constructor(
    @Inject(ProductsService) private readonly products: ProductsService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  // ───────────── Plantillas ─────────────

  async template(kind: ImportKind): Promise<ExcelFile> {
    if (kind === "PRODUCTS") {
      return {
        fileName: "plantilla-productos.xlsx",
        contentBase64: await buildWorkbook([
          {
            name: "Productos",
            columns: PRODUCT_COLUMNS.map((h) => ({ header: h, width: h === "Nombre" || h === "Descripción" ? 32 : 20 })),
            rows: [["", "Gaseosa Cola 500 ml", "Botella PET", "Bien", "GASEOSAS", "Cola Sur", "UND", "GENERAL", "No", "No", "7790001000012", "Activo"]],
          },
          {
            name: "Instrucciones",
            columns: [{ header: "Cómo llenar la plantilla", width: 110 }],
            rows: [
              ["Una fila por producto. La primera fila (cabecera) no se modifica."],
              ["Código: vacío = se genera automáticamente. Si el código ya existe, la fila ACTUALIZA ese producto (las celdas vacías no cambian nada)."],
              ["Nombre y Unidad base son obligatorios al crear. La unidad base no se puede cambiar en productos existentes."],
              ["Tipo: Bien o Servicio. Lote / Vencimiento: Sí o No (el vencimiento requiere lote; los servicios no llevan lote)."],
              ["Categoría (por código), Marca (por nombre), Unidad y Perfil fiscal (por código) deben existir antes de importar."],
              ["Código de barras: varios separados por punto y coma (;). Cada código pertenece a un solo producto."],
              ["Nada se guarda al subir el archivo: primero verás una vista previa con los errores por fila y deberás confirmar."],
            ],
          },
        ]),
      };
    }
    return {
      fileName: "plantilla-precios.xlsx",
      contentBase64: await buildWorkbook([
        {
          name: "Precios",
          columns: PRICE_COLUMNS.map((h) => ({ header: h, width: 22 })),
          rows: [["P-000001", 1, 10, 25.5], ["P-000001", 10, 50, 24], ["P-000001", 50, "", 22.5]],
        },
        {
          name: "Instrucciones",
          columns: [{ header: "Cómo llenar la plantilla", width: 110 }],
          rows: [
            ["Una fila por tramo de precio. Varias filas con el mismo código de producto forman sus tramos."],
            ["Los tramos cubren [mínima, máxima): la máxima es exclusiva y debe coincidir con la mínima del tramo siguiente."],
            ["El último tramo se deja con la cantidad máxima vacía (sin límite). No puede haber huecos ni solapes."],
            ["El precio unitario es el de la lista de destino (con o sin impuestos, según la modalidad de esa lista)."],
            ["Importar reemplaza TODOS los tramos de los productos que aparezcan en el archivo; los demás no se tocan."],
          ],
        },
      ]),
    };
  }

  // ───────────── Vista previa ─────────────

  async preview(ctx: RequestContext, req: ImportPreviewRequest): Promise<ImportPreview> {
    await this.assertPermission(ctx, req.kind);
    const buffer = this.decode(req.contentBase64);
    const sheet = await readSheet(buffer);

    return ctx.run(async (tx) => {
      if (req.kind === "PRICES" && !(await tx.priceList.findUnique({ where: { id: req.priceListId! }, select: { id: true } }))) throw notFound("Lista de precios");

      const result = req.kind === "PRODUCTS" ? await this.validateProducts(tx, sheet) : await this.validatePrices(tx, sheet);
      const totals: Totals = {
        rows: sheet.rows.length, valid: result.rows.length, errors: new Set(result.errors.map((e) => e.row)).size,
        create: result.rows.filter((r) => r.action === "CREATE").length,
        update: result.rows.filter((r) => r.action !== "CREATE").length,
      };
      const id = uuidv7();
      await tx.importJob.create({
        data: {
          id, tenantId: ctx.auth.tenantId, kind: req.kind, fileName: req.fileName.slice(0, 200),
          fileHash: createHash("sha256").update(buffer).digest("hex"), priceListId: req.priceListId ?? null,
          totals: totals as unknown as Prisma.InputJsonValue, errors: result.errors as unknown as Prisma.InputJsonValue,
          rows: result.rows as unknown as Prisma.InputJsonValue, createdById: ctx.auth.userId,
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, {
        action: "import.previewed", entityType: "import_job", entityId: id, actorUserId: ctx.auth.userId, after: { kind: req.kind, ...totals },
      });
      return this.toPreview(id, req.kind, "PREVIEWED", req.fileName, totals, result.errors, result.rows);
    });
  }

  list(ctx: RequestContext): Promise<ImportJobSummary[]> {
    return ctx.run(async (tx) =>
      (await tx.importJob.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, kind: true, status: true, fileName: true, totals: true, createdAt: true, appliedAt: true } })).map((j) => ({
        id: j.id, kind: j.kind, status: j.status, fileName: j.fileName, totals: j.totals as unknown as Totals,
        createdAt: j.createdAt.toISOString(), appliedAt: j.appliedAt?.toISOString() ?? null,
      })),
    );
  }

  get(ctx: RequestContext, id: string): Promise<ImportPreview> {
    return ctx.run(async (tx) => {
      const j = await tx.importJob.findUnique({ where: { id } });
      if (!j) throw notFound("Importación");
      return this.toPreview(j.id, j.kind, j.status, j.fileName, j.totals as unknown as Totals, j.errors as unknown as RowError[], j.rows as unknown as StoredRow[]);
    });
  }

  // ───────────── Confirmación ─────────────

  /**
   * Aplica la importación en UNA transacción (todo o nada). Es idempotente: una importación ya
   * aplicada no se vuelve a aplicar (ni siquiera con dos confirmaciones simultáneas: la segunda espera
   * al bloqueo de la fila y encuentra el estado final).
   */
  async confirm(ctx: RequestContext, id: string, req: ImportConfirmRequest): Promise<ImportResult> {
    const job = await ctx.run((tx) => tx.importJob.findUnique({ where: { id }, select: { kind: true } }));
    if (!job) throw notFound("Importación");
    await this.assertPermission(ctx, job.kind);

    try {
      return await ctx.run(async (tx) => {
        const claimed = await tx.importJob.updateMany({ where: { id, status: "PREVIEWED" }, data: { status: "APPLIED", appliedAt: new Date() } });
        if (claimed.count !== 1) throw new ConflictException({ code: "ALREADY_APPLIED", message: "Esta importación ya fue aplicada o no está disponible." });

        const j = await tx.importJob.findUniqueOrThrow({ where: { id } });
        const errors = j.errors as unknown as RowError[];
        const rows = j.rows as unknown as StoredRow[];
        if (errors.length > 0 && !req.skipInvalid) {
          throw new ConflictException({ code: "HAS_ERRORS", message: `El archivo tiene ${new Set(errors.map((e) => e.row)).size} fila(s) con errores. Corrígelas y vuelve a subirlo, o confirma importando solo las filas válidas.` });
        }

        let created = 0;
        let updated = 0;
        for (const r of rows) {
          try {
            if (r.action === "CREATE") { await this.products.createTx(tx, ctx, ProductInput.parse(r.data)); created++; }
            else if (r.action === "UPDATE") { await this.products.updateTx(tx, ctx, r.data.productId, ProductPatch.parse(r.data.patch)); updated++; }
            else { await this.pricing.writeTiers(tx, ctx, j.priceListId!, r.data.productId, r.data.tiers); updated++; }
          } catch (e) {
            const msg = (e as { response?: { message?: string } }).response?.message ?? (e instanceof Error ? e.message : "error");
            throw new ConflictException({ code: "IMPORT_ROW_FAILED", message: `Fila ${r.row}: ${msg}. No se aplicó ningún cambio.` });
          }
        }
        const skipped = new Set(errors.map((e) => e.row)).size;
        const result = { created, updated, skipped };
        await tx.importJob.update({ where: { id }, data: { result } });
        await writeAudit(tx, ctx.auth.tenantId, { action: "import.applied", entityType: "import_job", entityId: id, actorUserId: ctx.auth.userId, after: { kind: j.kind, ...result } });
        return { jobId: id, ...result };
      }, { timeout: 120_000 });
    } catch (e) {
      // Se conserva el motivo para quien revise la importación; el estado sigue siendo PREVIEWED (se puede reintentar).
      const code = (e as { response?: { code?: string } }).response?.code;
      if (code === "IMPORT_ROW_FAILED") {
        await ctx.run((tx) => tx.importJob.updateMany({ where: { id, status: "PREVIEWED" }, data: { result: { error: (e as { response: { message: string } }).response.message } } })).catch(() => undefined);
      }
      throw e;
    }
  }

  // ───────────── Validación de productos ─────────────

  private async validateProducts(tx: Tx, sheet: { headers: string[]; rows: SheetRow[] }) {
    if (!sheet.headers.includes("nombre")) throw new BadRequestException({ code: "INVALID_FILE", message: "Falta la columna «Nombre»." });

    const [units, cats, brands, profiles, existing, barcodes] = await Promise.all([
      tx.unitOfMeasure.findMany({ select: { id: true, code: true, status: true } }),
      tx.category.findMany({ select: { id: true, code: true } }),
      tx.brand.findMany({ select: { id: true, name: true } }),
      tx.taxProfile.findMany({ select: { id: true, code: true, appliesTo: true } }),
      tx.product.findMany({ select: { id: true, code: true, baseUnitId: true, kind: true, trackLots: true, trackExpiry: true } }),
      tx.productBarcode.findMany({ select: { barcode: true, productId: true } }),
    ]);
    const unitBy = new Map(units.map((u) => [u.code.toLowerCase(), u]));
    const catBy = new Map(cats.map((c) => [c.code.toLowerCase(), c.id]));
    const brandBy = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));
    const profBy = new Map(profiles.map((p) => [p.code.toLowerCase(), p]));
    const prodBy = new Map(existing.map((p) => [p.code.toLowerCase(), p]));
    const barcodeOwner = new Map(barcodes.map((b) => [b.barcode.toLowerCase(), b.productId]));

    const get = (c: Record<string, string>, ...keys: string[]) => keys.map((k) => c[k]).find((v) => v !== undefined && v !== "") ?? "";
    const errors: RowError[] = [];
    const rows: StoredRow[] = [];
    const seenCodes = new Set<string>();
    const seenBarcodes = new Map<string, number>();

    for (const { row, cells } of sheet.rows) {
      const err = (message: string) => errors.push({ row, message });
      const before = errors.length;
      const code = get(cells, "codigo");
      const name = get(cells, "nombre");
      const desc = get(cells, "descripcion");
      const kindRaw = normalizeKind(get(cells, "tipo"));
      const catCode = get(cells, "categoria codigo", "categoria");
      const brandName = get(cells, "marca");
      const unitCode = get(cells, "unidad base codigo", "unidad base", "unidad");
      const profCode = get(cells, "perfil fiscal codigo", "perfil fiscal");
      const lots = parseBool(get(cells, "lote"));
      const expiry = parseBool(get(cells, "vencimiento"));
      const barcodeRaw = get(cells, "codigo de barras");
      const statusRaw = get(cells, "estado").toLowerCase();

      if (kindRaw === null) err("Tipo no válido: usa «Bien» o «Servicio».");
      if (lots === null) err("Lote no válido: usa «Sí» o «No».");
      if (expiry === null) err("Vencimiento no válido: usa «Sí» o «No».");
      const status = statusRaw ? STATUS_WORDS[statusRaw] : undefined;
      if (statusRaw && !status) err("Estado no válido: usa «Activo» o «Inactivo».");

      let categoryId: string | undefined;
      if (catCode) { categoryId = catBy.get(catCode.toLowerCase()); if (!categoryId) err(`Categoría no encontrada: ${catCode}`); }
      let brandId: string | undefined;
      if (brandName) { brandId = brandBy.get(brandName.toLowerCase()); if (!brandId) err(`Marca no encontrada: ${brandName}`); }
      let taxProfileId: string | undefined;
      if (profCode) {
        const p = profBy.get(profCode.toLowerCase());
        if (!p) err(`Perfil fiscal no encontrado: ${profCode}`);
        else if (p.appliesTo !== "PRODUCT") err(`El perfil fiscal ${profCode} no es de productos.`);
        else taxProfileId = p.id;
      }
      const barcodeList = barcodeRaw ? barcodeRaw.split(/[;,]/).map((b) => b.trim()).filter(Boolean) : undefined;

      const found = code ? prodBy.get(code.toLowerCase()) : undefined;
      if (code) {
        if (seenCodes.has(code.toLowerCase())) err(`El código ${code} está repetido en el archivo.`);
        seenCodes.add(code.toLowerCase());
      }
      for (const b of barcodeList ?? []) {
        const lower = b.toLowerCase();
        const owner = barcodeOwner.get(lower);
        if (owner && owner !== found?.id) err(`El código de barras ${b} ya pertenece a otro producto.`);
        const first = seenBarcodes.get(lower);
        if (first !== undefined && first !== row) err(`El código de barras ${b} está repetido en la fila ${first}.`);
        seenBarcodes.set(lower, row);
      }

      if (found) {
        // ── ACTUALIZAR (las celdas vacías no cambian nada)
        if (unitCode && unitBy.get(unitCode.toLowerCase())?.id !== found.baseUnitId) err("La unidad base no se puede cambiar en un producto existente.");
        const patch: Record<string, unknown> = {
          ...(name ? { name } : {}), ...(desc ? { description: desc } : {}),
          ...(kindRaw ? { kind: kindRaw } : {}), ...(categoryId ? { categoryId } : {}), ...(brandId ? { brandId } : {}),
          ...(taxProfileId ? { taxProfileId } : {}), ...(lots !== undefined && lots !== null ? { trackLots: lots } : {}),
          ...(expiry !== undefined && expiry !== null ? { trackExpiry: expiry } : {}), ...(status ? { status } : {}),
          ...(barcodeList ? { barcodes: barcodeList.map((barcode) => ({ barcode })) } : {}),
        };
        const parsed = ProductPatch.safeParse(patch);
        if (!parsed.success) parsed.error.issues.forEach((i) => err(issueText(i.path, i.message)));
        else if (errors.length === before) {
          // Estado final coherente (lote/vencimiento/servicio) antes de aplicar
          const k = parsed.data.kind ?? found.kind;
          const l = parsed.data.trackLots ?? found.trackLots;
          const x = parsed.data.trackExpiry ?? found.trackExpiry;
          if (x && !l) err("El vencimiento requiere control por lote.");
          else if (k === "SERVICE" && (l || x)) err("Un servicio no lleva lote ni vencimiento.");
          else rows.push({ row, action: "UPDATE", key: found ? code : "", summary: summarize(patch), data: { productId: found.id, patch: parsed.data } });
        }
      } else {
        // ── CREAR
        if (!name) err("El nombre es obligatorio.");
        const unit = unitCode ? unitBy.get(unitCode.toLowerCase()) : undefined;
        if (!unitCode) err("La unidad base es obligatoria.");
        else if (!unit) err(`Unidad no encontrada: ${unitCode}`);
        else if (unit.status !== "ACTIVE") err(`La unidad ${unitCode} está inactiva.`);
        const input = {
          ...(code ? { code } : {}), name, ...(desc ? { description: desc } : {}), kind: kindRaw ?? "GOODS",
          categoryId: categoryId ?? null, brandId: brandId ?? null, taxProfileId: taxProfileId ?? null, baseUnitId: unit?.id ?? "",
          trackLots: lots ?? false, trackExpiry: expiry ?? false,
          barcodes: (barcodeList ?? []).map((barcode) => ({ barcode })), conversions: [] as never[],
        };
        const parsed = ProductInput.safeParse(input);
        if (!parsed.success) parsed.error.issues.forEach((i) => { if (i.path[0] !== "baseUnitId" || unit) err(issueText(i.path, i.message)); });
        else if (errors.length === before) rows.push({ row, action: "CREATE", key: parsed.data.code ?? "(automático)", summary: parsed.data.name, data: parsed.data });
        if (status === "INACTIVE" && errors.length === before) {
          // Un producto nuevo nace activo; se desactiva con una fila posterior de actualización.
          err("Un producto nuevo se crea activo. Para desactivarlo, impórtalo y luego actualiza su estado.");
          rows.pop();
        }
      }
    }
    return { rows, errors };
  }

  // ───────────── Validación de precios ─────────────

  private async validatePrices(tx: Tx, sheet: { headers: string[]; rows: SheetRow[] }) {
    for (const h of ["codigo de producto", "cantidad minima", "precio unitario"]) {
      if (!sheet.headers.includes(h)) throw new BadRequestException({ code: "INVALID_FILE", message: `Falta la columna «${PRICE_COLUMNS.find((c) => c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") === h) ?? h}».` });
    }
    const products = await tx.product.findMany({ select: { id: true, code: true } });
    const byCode = new Map(products.map((p) => [p.code.toLowerCase(), p.id]));
    const errors: RowError[] = [];
    const groups = new Map<string, { firstRow: number; productId?: string; tiers: { row: number; minQuantity: number; maxQuantity: number | null; unitPrice: number }[] }>();

    for (const { row, cells } of sheet.rows) {
      const code = cells["codigo de producto"] ?? "";
      if (!code) { errors.push({ row, message: "Falta el código de producto." }); continue; }
      const min = parseNumber(cells["cantidad minima"] ?? "");
      const maxRaw = cells["cantidad maxima"] ?? "";
      const max = maxRaw ? parseNumber(maxRaw) : null;
      const price = parseNumber(cells["precio unitario"] ?? "");
      let bad = false;
      if (min === null) { errors.push({ row, message: "Cantidad mínima no válida." }); bad = true; }
      if (maxRaw && max === null) { errors.push({ row, message: "Cantidad máxima no válida." }); bad = true; }
      if (price === null) { errors.push({ row, message: "Precio unitario no válido." }); bad = true; }
      if (bad) continue;
      const productId = byCode.get(code.toLowerCase());
      if (!productId) { errors.push({ row, message: `Producto no encontrado: ${code}` }); continue; }
      const g = groups.get(code.toLowerCase()) ?? { firstRow: row, productId, tiers: [] };
      g.tiers.push({ row, minQuantity: min!, maxQuantity: max, unitPrice: price! });
      groups.set(code.toLowerCase(), g);
    }

    const rows: StoredRow[] = [];
    for (const [code, g] of groups) {
      const tierErrors = validateTiers(g.tiers);
      if (tierErrors.length) { for (const m of tierErrors) errors.push({ row: g.firstRow, message: `${code.toUpperCase()}: ${m}` }); continue; }
      rows.push({
        row: g.firstRow, action: "SET_PRICES", key: code.toUpperCase(), summary: `${g.tiers.length} tramo(s)`,
        data: { productId: g.productId, tiers: g.tiers.map(({ minQuantity, maxQuantity, unitPrice }) => ({ minQuantity, maxQuantity, unitPrice })) },
      });
    }
    return { rows, errors };
  }

  // ───────────── Utilidades ─────────────

  private decode(b64: string): Buffer {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new BadRequestException({ code: "INVALID_FILE", message: "El contenido del archivo no es válido." });
    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_FILE_BYTES) throw new BadRequestException({ code: "INVALID_FILE", message: "El archivo supera el máximo de 5 MB." });
    return buf;
  }

  private async assertPermission(ctx: RequestContext, kind: ImportKind): Promise<void> {
    if (!(await ctx.permissions()).has(PERMISSION[kind])) throw forbid("FORBIDDEN", "Permiso insuficiente para importar este tipo de datos.");
  }

  private toPreview(jobId: string, kind: ImportKind, status: "PREVIEWED" | "APPLIED" | "FAILED", fileName: string, totals: Totals, errors: RowError[], rows: StoredRow[]): ImportPreview {
    return {
      jobId, kind, status, fileName, totals,
      errors: [...errors].sort((a, b) => a.row - b.row).slice(0, 200),
      sample: rows.slice(0, 25).map((r) => ({ row: r.row, action: r.action, key: r.key, summary: r.summary })),
    };
  }
}

function normalizeKind(s: string): "GOODS" | "SERVICE" | null | undefined {
  const t = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!t) return undefined;
  if (["bien", "bienes", "goods", "producto"].includes(t)) return "GOODS";
  if (["servicio", "servicios", "service"].includes(t)) return "SERVICE";
  return null;
}

const summarize = (patch: Record<string, unknown>) => Object.keys(patch).map((k) => k).join(", ") || "sin cambios";
