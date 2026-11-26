import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";

/** Límites de seguridad de la importación (plan §18, §28.6). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 30;
export const EXPORT_MAX_ROWS = 20_000;

const invalidFile = (message: string) => new BadRequestException({ code: "INVALID_FILE", message });

/** Cabecera sin tildes, en minúsculas y con espacios simples: «Código de barras» → «codigo de barras». */
export const normalizeHeader = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // Fórmulas: se toma el resultado ya calculado; NUNCA se evalúa nada.
    if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((t) => t.text).join("").trim();
    if ("text" in value) return String(value.text).trim();
    if ("error" in value) return "";
  }
  return String(value).trim();
}

export interface SheetRow {
  /** Número de fila en Excel (la cabecera es la 1). */
  row: number;
  cells: Record<string, string>;
}

/**
 * Lee la primera hoja de un .xlsx: cabeceras normalizadas → valores de texto. Rechaza archivos que no
 * sean .xlsx reales, demasiado grandes o con demasiadas filas/columnas. Las filas vacías se omiten.
 */
export async function readSheet(buffer: Buffer): Promise<{ headers: string[]; rows: SheetRow[] }> {
  if (buffer.length === 0) throw invalidFile("El archivo está vacío.");
  if (buffer.length > MAX_FILE_BYTES) throw invalidFile("El archivo supera el máximo de 5 MB.");
  // Un .xlsx es un ZIP: firma PK. Evita procesar archivos disfrazados.
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) throw invalidFile("El archivo no es un libro de Excel (.xlsx) válido.");

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw invalidFile("No se pudo leer el archivo. Guárdalo como «Libro de Excel (.xlsx)».");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw invalidFile("El libro no tiene hojas.");
  if (ws.columnCount > MAX_COLUMNS) throw invalidFile(`Demasiadas columnas (máximo ${MAX_COLUMNS}).`);
  if (ws.actualRowCount - 1 > MAX_ROWS) throw invalidFile(`Demasiadas filas (máximo ${MAX_ROWS}).`);

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  const index = new Map<number, string>();
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = normalizeHeader(cellText(cell.value));
    if (h) { headers.push(h); index.set(col, h); }
  });
  if (headers.length === 0) throw invalidFile("La primera fila debe contener los nombres de las columnas.");

  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    if (n === 1) return;
    const cells: Record<string, string> = {};
    let any = false;
    for (const [col, h] of index) {
      const t = cellText(r.getCell(col).value);
      if (t) any = true;
      cells[h] = t;
    }
    if (any) rows.push({ row: n, cells });
  });
  if (rows.length > MAX_ROWS) throw invalidFile(`Demasiadas filas (máximo ${MAX_ROWS}).`);
  return { headers, rows };
}

/**
 * Neutraliza la inyección de fórmulas (CSV/Excel injection): una celda de texto que empiece por
 * = + - @ tabulador o retorno se antepone con apóstrofo para que Excel la trate como texto.
 */
export const safeCell = (v: string | number | boolean | null | undefined): string | number | boolean | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
};

export interface SheetSpec {
  name: string;
  columns: { header: string; width?: number; numFmt?: string }[];
  rows: (string | number | boolean | null | undefined)[][];
}

/** Genera un .xlsx en base64 con cabecera destacada y panel fijo. Todo el texto pasa por `safeCell`. */
export async function buildWorkbook(sheets: SheetSpec[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NEXUS ERP";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = s.columns.map((c) => ({ header: c.header, width: c.width ?? 18, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
    for (const r of s.rows) ws.addRow(r.map((v) => safeCell(v)));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF635BDB" } };
    head.alignment = { vertical: "middle" };
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer).toString("base64");
}

/** Decimal con coma o punto: «1,5» y «1.5» → 1.5. null si no es un número. */
export function parseNumber(s: string): number | null {
  const t = s.replace(/\s/g, "");
  if (!t) return null;
  const norm = /^-?\d+(,\d+)?$/.test(t) ? t.replace(",", ".") : t;
  if (!/^-?\d+(\.\d+)?$/.test(norm)) return null;
  return Number(norm);
}

const YES = new Set(["si", "s", "1", "true", "x", "yes", "y", "verdadero"]);
const NO = new Set(["no", "n", "0", "false", "falso"]);
/** true/false según «sí/no»; undefined si está vacío; null si no se entiende. */
export function parseBool(s: string): boolean | undefined | null {
  const t = normalizeHeader(s);
  if (!t) return undefined;
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  return null;
}
