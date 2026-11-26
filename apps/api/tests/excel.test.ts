import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import ExcelJS from "exceljs";
import { uuidv7, withTenant } from "@erp/db";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string;
let UND: string;
let catId: string;

type M = "GET" | "POST" | "PUT" | "PATCH";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });

const PRODUCT_HEADERS = ["Código", "Nombre", "Descripción", "Tipo", "Categoría (código)", "Marca", "Unidad base (código)", "Perfil fiscal (código)", "Lote", "Vencimiento", "Código de barras", "Estado"];
const PRICE_HEADERS = ["Código de producto", "Cantidad mínima", "Cantidad máxima", "Precio unitario"];

/** Libro .xlsx en base64 a partir de cabeceras y filas. */
async function book(headers: string[], rows: (string | number | null)[][], opts: { formula?: { row: number; col: number; formula: string; result: string } } = {}): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Hoja");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  if (opts.formula) ws.getRow(opts.formula.row).getCell(opts.formula.col).value = { formula: opts.formula.formula, result: opts.formula.result };
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString("base64");
}
const readB64 = async (b64: string) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b64, "base64") as unknown as ExcelJS.Buffer);
  return wb;
};
const preview = (token: string, kind: string, contentBase64: string, extra: object = {}) =>
  api(token, "POST", "/imports/preview", { kind, fileName: "archivo.xlsx", contentBase64, ...extra });
const prodCount = () => withTenant(owner, world.tenantA, (tx) => tx.product.count());

before(async () => {
  await setup();
  admin = await tokenFor("admin.a@test.local");
  adminB = await tokenFor("admin.b@test.local");
  manager = await tokenFor("multi@test.local", "empresa-a");
  cashier = await tokenFor("cajero@test.local");
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  catId = (await api(admin, "POST", "/catalog/categories", { code: "GAS", name: "Gaseosas" })).json.id;
  await api(admin, "POST", "/catalog/brands", { name: "Cola Sur" });
});
after(teardown);

describe("plantillas", () => {
  it("la plantilla de productos es un .xlsx válido con las columnas, un ejemplo e instrucciones", async () => {
    const r = await api(admin, "GET", "/imports/template/PRODUCTS");
    assert.equal(r.status, 200);
    assert.match(r.json.fileName, /plantilla-productos\.xlsx/);
    const wb = await readB64(r.json.contentBase64);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ["Productos", "Instrucciones"]);
    const headers = (wb.getWorksheet("Productos")!.getRow(1).values as string[]).slice(1);
    assert.deepEqual(headers, PRODUCT_HEADERS);
  });

  it("la plantilla de precios y los tipos desconocidos", async () => {
    const wb = await readB64((await api(admin, "GET", "/imports/template/PRICES")).json.contentBase64);
    assert.deepEqual((wb.getWorksheet("Precios")!.getRow(1).values as string[]).slice(1), PRICE_HEADERS);
    assert.equal((await api(admin, "GET", "/imports/template/OTRO")).status, 404);
  });
});

describe("importar productos: la vista previa NO aplica nada", () => {
  let jobId: string;
  let existing: { id: string; code: string };

  before(async () => {
    existing = (await api(admin, "POST", "/catalog/products", { code: "EXI-1", name: "Existente", baseUnitId: UND, barcodes: [{ barcode: "BARRAS-EXI-1" }] })).json;
  });

  it("clasifica filas a crear, a actualizar y con errores, con el número de fila de Excel", async () => {
    const before = await prodCount();
    const file = await book(PRODUCT_HEADERS, [
      ["", "Gaseosa Cola 500 ml", "PET", "Bien", "GAS", "Cola Sur", "UND", "", "Sí", "No", "IMP-0001", ""], //  2 crear (código automático)
      ["NUEVO-2", "Con código propio", "", "Servicio", "", "", "UND", "", "", "", "", ""], //                    3 crear
      ["EXI-1", "Existente renombrado", "", "", "", "", "", "", "", "", "", ""], //                              4 actualizar
      ["", "", "", "", "", "", "UND", "", "", "", "", ""], //                                                    5 error: sin nombre
      ["", "Cat. inexistente", "", "", "NOEXISTE", "", "UND", "", "", "", "", ""], //                            6 error
      ["", "Unidad inexistente", "", "", "", "", "XYZ", "", "", "", "", ""], //                                  7 error
      ["", "Sin unidad", "", "", "", "", "", "", "", "", "", ""], //                                             8 error
      ["", "Booleano raro", "", "", "", "", "UND", "", "quizás", "", "", ""], //                                 9 error
      ["NUEVO-2", "Código repetido", "", "", "", "", "UND", "", "", "", "", ""], //                              10 error
      ["", "Barras de otro", "", "", "", "", "UND", "", "", "", "BARRAS-EXI-1", ""], //                          11 error
      ["", "Barras repetido A", "", "", "", "", "UND", "", "", "", "DUP-BARRAS", ""], //                         12 crear
      ["", "Barras repetido B", "", "", "", "", "UND", "", "", "", "DUP-BARRAS", ""], //                         13 error
      ["", "Vence sin lote", "", "", "", "", "UND", "", "No", "Sí", "", ""], //                                  14 error
      ["", "Servicio con lote", "", "Servicio", "", "", "UND", "", "Sí", "", "", ""], //                         15 error
      ["EXI-1", "Cambia unidad", "", "", "", "", "KG", "", "", "", "", ""], //                                   16 error (código repetido en archivo)
    ]);
    const r = await preview(admin, "PRODUCTS", file);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    jobId = r.json.jobId;
    assert.deepEqual(r.json.totals, { rows: 15, valid: 4, errors: 11, create: 3, update: 1 });
    const errRows = new Set(r.json.errors.map((e: { row: number }) => e.row));
    for (const row of [5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16]) assert.ok(errRows.has(row), `fila ${row} debería tener error`);
    for (const row of [2, 3, 4, 12]) assert.ok(!errRows.has(row), `fila ${row} es válida`);
    const msgs = r.json.errors.map((e: { message: string }) => e.message).join(" | ");
    assert.match(msgs, /Categoría no encontrada: NOEXISTE/);
    assert.match(msgs, /Unidad no encontrada: XYZ/);
    assert.match(msgs, /ya pertenece a otro producto/);
    assert.match(msgs, /repetido/);
    assert.match(msgs, /vencimiento requiere control por lote/i);
    assert.deepEqual(r.json.sample.map((s: { row: number; action: string }) => [s.row, s.action]), [[2, "CREATE"], [3, "CREATE"], [4, "UPDATE"], [12, "CREATE"]]);
    assert.equal(await prodCount(), before, "la vista previa no crea ni modifica productos");
  });

  it("con errores no se puede confirmar (todo o nada) y el estado se conserva", async () => {
    const r = await api(admin, "POST", `/imports/${jobId}/confirm`, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "HAS_ERRORS");
    assert.equal((await api(admin, "GET", `/imports/${jobId}`)).json.status, "PREVIEWED");
    assert.equal(await prodCount(), 1);
  });

  it("confirmando solo las filas válidas: crea con códigos automáticos y actualiza sin tocar lo que quedó vacío", async () => {
    const r = await api(admin, "POST", `/imports/${jobId}/confirm`, { skipInvalid: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.created, r.json.updated, r.json.skipped], [3, 1, 11]);
    const all = (await api(admin, "GET", "/catalog/products?limit=100")).json.items;
    assert.equal(all.length, 4);
    const cola = all.find((p: { name: string }) => p.name === "Gaseosa Cola 500 ml");
    assert.match(cola.code, /^P-\d{6}$/);
    assert.equal(cola.category.name, "Gaseosas");
    assert.equal(cola.brand.name, "Cola Sur");
    assert.equal(cola.trackLots, true);
    assert.equal(all.find((p: { code: string }) => p.code === "NUEVO-2").kind, "SERVICE");
    const upd = (await api(admin, "GET", `/catalog/products/${existing.id}`)).json;
    assert.equal(upd.name, "Existente renombrado");
    assert.deepEqual(upd.barcodes.map((b: { barcode: string }) => b.barcode), ["BARRAS-EXI-1"], "las celdas vacías no borran datos");
    assert.equal(upd.baseUnit.code, "UND");
  });

  it("es idempotente: una importación aplicada no se vuelve a aplicar", async () => {
    const r = await api(admin, "POST", `/imports/${jobId}/confirm`, { skipInvalid: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "ALREADY_APPLIED");
    assert.equal(await prodCount(), 4);
  });

  it("dos confirmaciones simultáneas aplican una sola vez", async () => {
    const file = await book(PRODUCT_HEADERS, [["", "Carrera A", "", "", "", "", "UND", "", "", "", "", ""], ["", "Carrera B", "", "", "", "", "UND", "", "", "", "", ""]]);
    const id = (await preview(admin, "PRODUCTS", file)).json.jobId;
    const [a, b] = await Promise.all([api(admin, "POST", `/imports/${id}/confirm`, {}), api(admin, "POST", `/imports/${id}/confirm`, {})]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(await prodCount(), 6, "solo 2 productos nuevos, no 4");
  });

  it("si algo cambia entre la vista previa y la confirmación, no se aplica NADA", async () => {
    const file = await book(PRODUCT_HEADERS, [
      ["", "Primera fila ok", "", "", "", "", "UND", "", "", "", "", ""],
      ["CHOCA-1", "Segunda fila", "", "", "", "", "UND", "", "", "", "", ""],
    ]);
    const id = (await preview(admin, "PRODUCTS", file)).json.jobId;
    await api(admin, "POST", "/catalog/products", { code: "CHOCA-1", name: "Se coló antes", baseUnitId: UND }); // otro usuario crea ese código
    const before = await prodCount();
    const r = await api(admin, "POST", `/imports/${id}/confirm`, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "IMPORT_ROW_FAILED");
    assert.match(r.json.detail, /Fila 3/);
    assert.equal(await prodCount(), before, "la primera fila tampoco se aplicó");
    assert.equal((await api(admin, "GET", `/imports/${id}`)).json.status, "PREVIEWED", "se puede reintentar tras corregir");
  });

  it("actualizar con una unidad base distinta se rechaza", async () => {
    const file = await book(PRODUCT_HEADERS, [["EXI-1", "", "", "", "", "", "KG", "", "", "", "", ""]]);
    const r = await preview(admin, "PRODUCTS", file);
    assert.equal(r.json.totals.errors, 1);
    assert.match(r.json.errors[0].message, /unidad base no se puede cambiar/);
  });
});

describe("importar precios", () => {
  let list: string;
  before(async () => {
    list = (await api(admin, "POST", "/pricing/lists", { code: "IMP-L", name: "Importada", priceMode: "WITHOUT_TAX" })).json.id;
    for (const c of ["PR-1", "PR-2", "PR-3"]) await api(admin, "POST", "/catalog/products", { code: c, name: `Precio ${c}`, baseUnitId: UND });
  });

  it("agrupa tramos por producto, acepta coma decimal y valida contigüidad", async () => {
    const file = await book(PRICE_HEADERS, [
      ["PR-1", 1, 10, "10,50"], ["PR-1", 10, 50, 9], ["PR-1", 50, null, "8.25"], // 2-4 ok (coma y punto)
      ["PR-2", 1, 10, 5], ["PR-2", 12, null, 4], //                                5-6 hueco entre 10 y 12
      ["NOEXISTE", 1, null, 3], //                                                 7 producto inexistente
      ["PR-3", "abc", null, 3], //                                                 8 cantidad inválida
      ["PR-3", 1, null, -2], //                                                    9 precio negativo → tramos inválidos
    ]);
    const r = await preview(admin, "PRICES", file, { priceListId: list });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.totals.valid, 1);
    const msgs = r.json.errors.map((e: { message: string }) => e.message).join(" | ");
    assert.match(msgs, /huecos ni solapes/);
    assert.match(msgs, /Producto no encontrado: NOEXISTE/);
    assert.match(msgs, /Cantidad mínima no válida/);
    assert.deepEqual(r.json.sample.map((s: { key: string; summary: string }) => [s.key, s.summary]), [["PR-1", "3 tramo(s)"]]);
  });

  it("confirma, reemplaza los tramos del producto y deja historial", async () => {
    const file = await book(PRICE_HEADERS, [["PR-1", 1, 10, "10,50"], ["PR-1", 10, null, 9]]);
    const id = (await preview(admin, "PRICES", file, { priceListId: list })).json.jobId;
    const r = await api(admin, "POST", `/imports/${id}/confirm`, {});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const rows = (await api(admin, "GET", `/pricing/lists/${list}/prices`)).json.items;
    assert.deepEqual(rows[0].tiers.map((t: { unitPrice: string }) => Number(t.unitPrice)), [10.5, 9]);
    const pid = rows[0].productId;
    assert.ok((await api(admin, "GET", `/pricing/lists/${list}/prices/${pid}/history`)).json.length >= 1);
    // un nuevo envío del mismo archivo vuelve a aplicarse como una importación distinta (otro job)
    assert.notEqual((await preview(admin, "PRICES", file, { priceListId: list })).json.jobId, id);
  });

  it("exige la lista de destino y que exista", async () => {
    const file = await book(PRICE_HEADERS, [["PR-1", 1, null, 1]]);
    assert.equal((await preview(admin, "PRICES", file)).status, 400);
    assert.equal((await preview(admin, "PRICES", file, { priceListId: uuidv7() })).status, 404);
  });

  it("exige las columnas obligatorias", async () => {
    const r = await preview(admin, "PRICES", await book(["Código de producto", "Precio unitario"], [["PR-1", 5]]), { priceListId: list });
    assert.equal(r.status, 400);
    assert.match(r.json.detail, /Falta la columna/);
  });
});

describe("seguridad del archivo", () => {
  it("rechaza lo que no es un .xlsx real, vacío o mal codificado", async () => {
    const fake = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n"), Buffer.alloc(200, 1)]).toString("base64");
    assert.equal((await preview(admin, "PRODUCTS", fake)).json.code, "INVALID_FILE");
    // firma ZIP pero contenido corrupto
    const zipish = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(200, 7)]).toString("base64");
    assert.equal((await preview(admin, "PRODUCTS", zipish)).json.code, "INVALID_FILE");
    assert.equal((await preview(admin, "PRODUCTS", "esto no es base64!!!")).json.code, "INVALID_FILE");
    assert.equal((await preview(admin, "PRODUCTS", "")).status, 400);
  });

  it("rechaza archivos de más de 5 MB", async () => {
    const big = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(5.2 * 1024 * 1024, 1)]).toString("base64");
    const r = await preview(admin, "PRODUCTS", big);
    assert.equal(r.status, 400);
    assert.match(r.json.detail, /5 MB/);
  });

  it("rechaza demasiadas filas o columnas", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ["", `P ${i}`, "", "", "", "", "UND", "", "", "", "", ""]);
    assert.match((await preview(admin, "PRODUCTS", await book(PRODUCT_HEADERS, rows))).json.detail, /Demasiadas filas/);
    const wide = Array.from({ length: 31 }, (_, i) => `C${i}`);
    assert.match((await preview(admin, "PRODUCTS", await book(wide, [wide.map(() => "x")]))).json.detail, /Demasiadas columnas/);
  });

  it("exige la columna Nombre y una primera fila con cabeceras", async () => {
    assert.match((await preview(admin, "PRODUCTS", await book(["Código", "Unidad base (código)"], [["", "UND"]]))).json.detail, /Falta la columna «Nombre»/);
  });

  it("las fórmulas no se ejecutan: se usa el valor calculado y el texto '=...' se guarda como texto", async () => {
    const file = await book(PRODUCT_HEADERS, [["", "x", "", "", "", "", "UND", "", "", "", "", ""]], { formula: { row: 2, col: 2, formula: "1+1", result: "Resultado calculado" } });
    const r = await preview(admin, "PRODUCTS", file);
    assert.equal(r.json.sample[0].summary, "Resultado calculado");
    const evil = await book(PRODUCT_HEADERS, [["EVIL-1", "=HYPERLINK(\"http://malo\",\"clic\")", "", "", "", "", "UND", "", "", "", "", ""]]);
    const id = (await preview(admin, "PRODUCTS", evil)).json.jobId;
    assert.equal((await api(admin, "POST", `/imports/${id}/confirm`, {})).status, 200);
    const stored = (await api(admin, "GET", "/catalog/products?q=EVIL-1")).json.items[0];
    assert.equal(stored.name, "=HYPERLINK(\"http://malo\",\"clic\")", "se guarda tal cual, como texto");
  });
});

describe("permisos", () => {
  it("importar exige permiso de gestión: el cajero lee el catálogo pero no importa", async () => {
    const file = await book(PRODUCT_HEADERS, [["", "Intento", "", "", "", "", "UND", "", "", "", "", ""]]);
    assert.equal((await preview(cashier, "PRODUCTS", file)).status, 403);
    assert.equal((await api(cashier, "GET", "/imports/template/PRODUCTS")).status, 200, "la plantilla sí puede bajarla");
    assert.equal((await preview(manager, "PRODUCTS", file)).status, 200);
  });

  it("solo quien tiene reports.export exporta", async () => {
    assert.equal((await api(cashier, "GET", "/exports/products")).status, 403);
    assert.equal((await api(manager, "GET", "/exports/products")).status, 200);
    assert.equal((await api(admin, "GET", "/exports/products")).status, 200);
    assert.equal((await call("GET", "/api/v1/exports/products")).status, 401);
  });

  it("la empresa B no ve ni confirma importaciones de A", async () => {
    const id = (await api(admin, "GET", "/imports")).json[0].id;
    assert.equal((await api(adminB, "GET", `/imports/${id}`)).status, 404);
    assert.equal((await api(adminB, "POST", `/imports/${id}/confirm`, {})).status, 404);
    assert.deepEqual((await api(adminB, "GET", "/imports")).json, []);
  });
});

describe("exportar", () => {
  it("exporta los productos con las mismas columnas y se puede volver a importar sin cambios", async () => {
    const r = await api(admin, "GET", "/exports/products");
    assert.match(r.json.fileName, /^productos-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const ws = (await readB64(r.json.contentBase64)).getWorksheet("Productos")!;
    assert.deepEqual((ws.getRow(1).values as string[]).slice(1), PRODUCT_HEADERS);
    assert.ok(ws.rowCount > 5);
    // ida y vuelta: lo exportado se importa como actualizaciones y sin errores
    const re = await preview(admin, "PRODUCTS", r.json.contentBase64);
    assert.equal(re.status, 200, JSON.stringify(re.json));
    assert.equal(re.json.totals.errors, 0, JSON.stringify(re.json.errors.slice(0, 3)));
    assert.equal(re.json.totals.create, 0);
    assert.equal(re.json.totals.update, re.json.totals.rows);
  });

  it("neutraliza las fórmulas al exportar (inyección de fórmulas)", async () => {
    await api(admin, "POST", "/catalog/products", { code: "FORM-1", name: "=SUM(A1:A9)", description: "+cmd|' /C calc'!A0", baseUnitId: UND });
    const ws = (await readB64((await api(admin, "GET", "/exports/products")).json.contentBase64)).getWorksheet("Productos")!;
    let row: ExcelJS.Row | undefined;
    ws.eachRow((r) => { if (r.getCell(1).value === "FORM-1") row = r; });
    assert.ok(row);
    assert.equal(row!.getCell(2).value, "'=SUM(A1:A9)", "el apóstrofo evita que Excel lo trate como fórmula");
    assert.equal(String(row!.getCell(3).value).startsWith("'+cmd"), true);
  });

  it("exporta los precios de una lista (ida y vuelta) y rechaza listas inexistentes", async () => {
    const lists = (await api(admin, "GET", "/pricing/lists")).json;
    const list = lists.find((l: { code: string }) => l.code === "IMP-L");
    const r = await api(admin, "GET", `/exports/prices/${list.id}`);
    assert.equal(r.status, 200);
    const ws = (await readB64(r.json.contentBase64)).getWorksheet("Precios")!;
    assert.equal(ws.getRow(2).getCell(1).value, "PR-1");
    assert.equal(ws.getRow(2).getCell(5).value, 10.5);
    const re = await preview(admin, "PRICES", r.json.contentBase64, { priceListId: list.id });
    assert.equal(re.json.totals.errors, 0, JSON.stringify(re.json.errors));
    assert.equal((await api(admin, "GET", `/exports/prices/${uuidv7()}`)).status, 404);
  });
});

describe("volumen y trazabilidad", () => {
  it("importa 800 productos en una sola operación", async () => {
    const rows = Array.from({ length: 800 }, (_, i) => [`BULK-${String(i).padStart(4, "0")}`, `Producto masivo ${i}`, "", "", "", "", "UND", "", "", "", `BULK-BAR-${i}`, ""]);
    const t0 = Date.now();
    const prev = await preview(admin, "PRODUCTS", await book(PRODUCT_HEADERS, rows));
    assert.equal(prev.json.totals.valid, 800, JSON.stringify(prev.json.errors.slice(0, 2)));
    const done = await api(admin, "POST", `/imports/${prev.json.jobId}/confirm`, {});
    assert.equal(done.json.created, 800, JSON.stringify(done.json));
    // Tope catastrófico (no un benchmark): en equipos cargados esta operación tarda de 25 s a más de 1 min.
    assert.ok(Date.now() - t0 < 240_000, `tardó ${Date.now() - t0} ms`);
  });

  it("deja registro de cada importación y las acciones quedan auditadas", async () => {
    const jobs = (await api(admin, "GET", "/imports")).json;
    assert.ok(jobs.some((j: { status: string }) => j.status === "APPLIED"));
    assert.ok(jobs.every((j: { totals: { rows: number } }) => typeof j.totals.rows === "number"));
    const acts = new Set((await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ select: { action: true } }))).map((a) => a.action));
    assert.ok(acts.has("import.previewed") && acts.has("import.applied"));
  });

  it("las importaciones no se pueden borrar (trazabilidad)", async () => {
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.importJob.deleteMany({})).then(
      () => { throw new Error("se borró"); }, (e: Error) => { if (e.message === "se borró") throw e; },
    ));
  });
});
