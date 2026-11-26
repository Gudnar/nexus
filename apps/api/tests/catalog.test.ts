import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { uuidv7, withTenant } from "@erp/db";
import { call, owner, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, manager: string, cashier: string;
let units: Record<string, string>; // code → id

before(async () => {
  await setup();
  admin = await tokenFor("admin.a@test.local");
  adminB = await tokenFor("admin.b@test.local");
  manager = await tokenFor("multi@test.local", "empresa-a");
  cashier = await tokenFor("cajero@test.local");
  units = Object.fromEntries((await api(admin, "GET", "/catalog/units")).json.map((u: { code: string; id: string }) => [u.code, u.id]));
});
after(teardown);

type M = "GET" | "POST" | "PATCH";
const api = (token: string, method: M, url: string, body?: unknown) => call(method, `/api/v1${url}`, { token, body });
const product = (over: object = {}) => ({ name: "Producto de prueba", baseUnitId: units["UND"], ...over });

describe("permisos y valores iniciales", () => {
  it("toda empresa nueva recibe sus unidades de medida", () => {
    for (const c of ["UND", "CJ", "PQT", "KG", "LT", "M"]) assert.ok(units[c], c);
  });

  it("el cajero lee el catálogo pero no lo modifica; sin sesión es 401", async () => {
    assert.equal((await api(cashier, "GET", "/catalog/products")).status, 200);
    assert.equal((await api(cashier, "POST", "/catalog/products", product())).status, 403);
    assert.equal((await api(cashier, "POST", "/catalog/brands", { name: "X" })).status, 403);
    assert.equal((await call("GET", "/api/v1/catalog/products")).status, 401);
  });

  it("el gerente (catalog.manage) sí puede crear", async () => {
    assert.equal((await api(manager, "POST", "/catalog/brands", { name: "Marca del gerente" })).status, 201);
  });
});

describe("unidades de medida", () => {
  it("crea, rechaza duplicados y valida el formato", async () => {
    const r = await api(admin, "POST", "/catalog/units", { code: "doc", name: "Docena", decimals: 0 });
    assert.equal(r.status, 201);
    assert.equal(r.json.code, "DOC");
    units["DOC"] = r.json.id;
    assert.equal((await api(admin, "POST", "/catalog/units", { code: "DOC", name: "Otra", decimals: 0 })).json.code, "CODE_TAKEN");
    assert.equal((await api(admin, "POST", "/catalog/units", { code: "con espacio", name: "X", decimals: 0 })).status, 400);
    assert.equal((await api(admin, "POST", "/catalog/units", { code: "X1", name: "X", decimals: 7 })).status, 400);
    assert.equal((await api(admin, "POST", "/catalog/units", { code: "X1", name: "X", decimals: 1.5 })).status, 400);
  });

  it("los decimales no cambian si la unidad está en uso", async () => {
    await api(admin, "POST", "/catalog/products", product({ name: "Usa KG", baseUnitId: units["KG"] }));
    const r = await api(admin, "PATCH", `/catalog/units/${units["KG"]}`, { decimals: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "UNIT_IN_USE");
    assert.equal((await api(admin, "PATCH", `/catalog/units/${units["KG"]}`, { name: "Kilo" })).json.name, "Kilo");
    assert.equal((await api(admin, "PATCH", `/catalog/units/${units["DOC"]}`, { decimals: 2 })).json.decimals, 2, "sin uso sí se puede");
  });
});

describe("categorías (árbol)", () => {
  const ids: Record<string, string> = {};
  const cat = async (code: string, name: string, parentId?: string) => {
    const r = await api(admin, "POST", "/catalog/categories", { code, name, parentId });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    ids[code] = r.json.id;
    return r;
  };

  it("crea niveles, normaliza el código y rechaza duplicados", async () => {
    await cat("beb", "Bebidas");
    assert.ok(ids["BEB"] === undefined && ids["beb"]);
    ids["BEB"] = ids["beb"]!;
    await cat("GAS", "Gaseosas", ids["BEB"]);
    assert.equal((await api(admin, "POST", "/catalog/categories", { code: "BEB", name: "Otra" })).json.code, "CODE_TAKEN");
    assert.equal((await api(admin, "POST", "/catalog/categories", { code: "X", name: "Hija huérfana", parentId: uuidv7() })).status, 404);
  });

  it("no permite ciclos ni ser hija de sí misma", async () => {
    const self = await api(admin, "PATCH", `/catalog/categories/${ids["BEB"]}`, { parentId: ids["BEB"] });
    assert.equal(self.json.code, "CATEGORY_CYCLE");
    const cycle = await api(admin, "PATCH", `/catalog/categories/${ids["BEB"]}`, { parentId: ids["GAS"] });
    assert.equal(cycle.json.code, "CATEGORY_CYCLE");
    assert.equal((await api(admin, "PATCH", `/catalog/categories/${ids["GAS"]}`, { parentId: null })).json.parentId, null);
    assert.equal((await api(admin, "PATCH", `/catalog/categories/${ids["GAS"]}`, { parentId: ids["BEB"] })).json.parentId, ids["BEB"]);
  });

  it("limita la profundidad a 5 niveles", async () => {
    let parent = ids["GAS"]!; // BEB > GAS ya son 2 niveles
    for (const [i, code] of ["N3", "N4", "N5"].entries()) {
      const r = await cat(code, `Nivel ${i + 3}`, parent);
      parent = r.json.id;
    }
    const tooDeep = await api(admin, "POST", "/catalog/categories", { code: "N6", name: "Nivel 6", parentId: parent });
    assert.equal(tooDeep.json.code, "DEPTH_EXCEEDED");
    // mover una rama profunda debajo de otra tampoco puede exceder
    const move = await api(admin, "PATCH", `/catalog/categories/${ids["BEB"]}`, { parentId: ids["N5"] });
    assert.equal(move.status, 400);
  });

  it("no hay categorías de otra empresa", async () => {
    assert.deepEqual((await api(adminB, "GET", "/catalog/categories")).json, []);
    assert.equal((await api(adminB, "POST", "/catalog/categories", { code: "Z", name: "Hija ajena", parentId: ids["BEB"] })).status, 404);
  });

  it("los cambios quedan en la auditoría", async () => {
    const a = await withTenant(owner, world.tenantA, (tx) => tx.auditLog.count({ where: { action: "category.created" } }));
    assert.ok(a >= 5);
  });
});

describe("marcas", () => {
  it("nombre único, edición y desactivación", async () => {
    const r = await api(admin, "POST", "/catalog/brands", { name: "Acme" });
    assert.equal(r.status, 201);
    assert.equal((await api(admin, "POST", "/catalog/brands", { name: "Acme" })).json.code, "NAME_TAKEN");
    assert.equal((await api(admin, "PATCH", `/catalog/brands/${r.json.id}`, { status: "INACTIVE" })).json.status, "INACTIVE");
    const other = await api(admin, "POST", "/catalog/brands", { name: "Otra" });
    assert.equal((await api(admin, "PATCH", `/catalog/brands/${other.json.id}`, { name: "Acme" })).json.code, "NAME_TAKEN");
  });
});

describe("productos", () => {
  it("crea con código manual (normalizado) o automático y correlativo", async () => {
    const manual = await api(admin, "POST", "/catalog/products", product({ code: "gas-500", name: "Gaseosa 500 ml" }));
    assert.equal(manual.status, 201, JSON.stringify(manual.json));
    assert.equal(manual.json.code, "GAS-500");
    const a = await api(admin, "POST", "/catalog/products", product({ name: "Auto 1" }));
    const b = await api(admin, "POST", "/catalog/products", product({ name: "Auto 2", code: "" }));
    assert.match(a.json.code, /^P-\d{6}$/);
    assert.equal(Number(b.json.code.slice(2)), Number(a.json.code.slice(2)) + 1);
  });

  it("el correlativo automático salta códigos manuales ya usados", async () => {
    const last = (await api(admin, "POST", "/catalog/products", product({ name: "Ref" }))).json.code as string;
    const nextTaken = `P-${String(Number(last.slice(2)) + 1).padStart(6, "0")}`;
    await api(admin, "POST", "/catalog/products", product({ code: nextTaken, name: "Ocupa el siguiente" }));
    const auto = await api(admin, "POST", "/catalog/products", product({ name: "Salta" }));
    assert.equal(Number(auto.json.code.slice(2)), Number(nextTaken.slice(2)) + 1);
  });

  it("rechaza códigos repetidos y datos inválidos", async () => {
    assert.equal((await api(admin, "POST", "/catalog/products", product({ code: "GAS-500" }))).json.code, "CODE_TAKEN");
    assert.equal((await api(admin, "POST", "/catalog/products", product({ code: "con espacio" }))).status, 400);
    assert.equal((await api(admin, "POST", "/catalog/products", product({ name: "x" }))).status, 400);
    assert.equal((await api(admin, "POST", "/catalog/products", product({ baseUnitId: uuidv7() }))).status, 404);
    assert.equal((await api(admin, "POST", "/catalog/products", product({ categoryId: uuidv7() }))).status, 404);
  });

  it("vencimiento exige lote, y un servicio no lleva lote ni vencimiento", async () => {
    assert.equal((await api(admin, "POST", "/catalog/products", product({ trackExpiry: true }))).status, 400);
    assert.equal((await api(admin, "POST", "/catalog/products", product({ kind: "SERVICE", trackLots: true }))).status, 400);
    const ok = await api(admin, "POST", "/catalog/products", product({ name: "Leche", trackLots: true, trackExpiry: true }));
    assert.equal(ok.status, 201);
    assert.deepEqual([ok.json.trackLots, ok.json.trackExpiry], [true, true]);
    assert.equal((await api(admin, "POST", "/catalog/products", product({ name: "Consultoría", kind: "SERVICE" }))).status, 201);
  });

  it("conversiones de unidad: 1 caja = 12 unidades", async () => {
    const r = await api(admin, "POST", "/catalog/products", product({
      name: "Agua", conversions: [{ unitId: units["CJ"], factor: 12 }, { unitId: units["PQT"], factor: 6.5 }],
    }));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.conversions.map((c: { unitCode: string; factor: string }) => [c.unitCode, Number(c.factor)]), [["CJ", 12], ["PQT", 6.5]]);
    const bad = (conversions: unknown[]) => api(admin, "POST", "/catalog/products", product({ name: "Mala", conversions }));
    assert.equal((await bad([{ unitId: units["UND"], factor: 2 }])).json.code, "CONVERSION_BASE");
    assert.equal((await bad([{ unitId: units["CJ"], factor: 2 }, { unitId: units["CJ"], factor: 3 }])).json.code, "CONVERSION_DUPLICATE");
    assert.equal((await bad([{ unitId: units["CJ"], factor: 0 }])).status, 400);
    assert.equal((await bad([{ unitId: units["CJ"], factor: -1 }])).status, 400);
    assert.equal((await bad([{ unitId: units["CJ"], factor: 1.1234567 }])).status, 400);
    assert.equal((await bad([{ unitId: uuidv7(), factor: 2 }])).status, 404);
  });

  it("códigos de barras: únicos en la empresa, por unidad válida", async () => {
    const a = await api(admin, "POST", "/catalog/products", product({
      name: "Con barras", conversions: [{ unitId: units["CJ"], factor: 24 }],
      barcodes: [{ barcode: "7790001000012" }, { barcode: "17790001000019", unitId: units["CJ"] }],
    }));
    assert.equal(a.status, 201, JSON.stringify(a.json));
    assert.equal(a.json.barcodes.length, 2);

    const dup = await api(admin, "POST", "/catalog/products", product({ name: "Otro", barcodes: [{ barcode: "7790001000012" }] }));
    assert.equal(dup.status, 409);
    assert.equal(dup.json.code, "BARCODE_TAKEN");
    assert.equal((await api(admin, "POST", "/catalog/products", product({ name: "Dup interno", barcodes: [{ barcode: "ABC123" }, { barcode: "abc123" }] }))).json.code, "BARCODE_DUPLICATE");
    assert.equal((await api(admin, "POST", "/catalog/products", product({ name: "Unidad ajena", barcodes: [{ barcode: "ABC1234", unitId: units["KG"] }] }))).json.code, "BARCODE_UNIT");
    assert.equal((await api(admin, "POST", "/catalog/products", product({ name: "Corto", barcodes: [{ barcode: "12" }] }))).status, 400);
    // el producto fallido no deja residuos (todo en una transacción)
    assert.equal((await api(admin, "GET", "/catalog/products?q=Otro")).json.items.length, 0);
  });

  it("edita datos, reemplaza códigos de barras y conversiones; el código y la unidad base no cambian", async () => {
    const p = (await api(admin, "POST", "/catalog/products", product({ name: "Editable", code: "EDIT-1", barcodes: [{ barcode: "EDIT0001" }] }))).json;
    const r = await api(admin, "PATCH", `/catalog/products/${p.id}`, {
      name: "Editable v2", code: "OTRO", baseUnitId: units["KG"], barcodes: [{ barcode: "EDIT0002" }],
      conversions: [{ unitId: units["CJ"], factor: 10 }], description: "Detalle",
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.name, "Editable v2");
    assert.equal(r.json.code, "EDIT-1");
    assert.equal(r.json.baseUnit.code, "UND");
    assert.deepEqual(r.json.barcodes.map((b: { barcode: string }) => b.barcode), ["EDIT0002"]);
    assert.equal(r.json.description, "Detalle");
    // el código liberado puede usarlo otro producto
    const reuse = await api(admin, "POST", "/catalog/products", product({ name: "Reusa", barcodes: [{ barcode: "EDIT0001" }] }));
    assert.equal(reuse.status, 201);
  });

  it("validaciones al editar: servicio con lote, vencimiento sin lote, código de barras de otro producto", async () => {
    const p = (await api(admin, "POST", "/catalog/products", product({ name: "Estricto" }))).json;
    assert.equal((await api(admin, "PATCH", `/catalog/products/${p.id}`, { kind: "SERVICE", trackLots: true })).status, 400);
    assert.equal((await api(admin, "PATCH", `/catalog/products/${p.id}`, { trackExpiry: true })).json.code, "EXPIRY_NEEDS_LOTS");
    assert.equal((await api(admin, "PATCH", `/catalog/products/${p.id}`, { barcodes: [{ barcode: "7790001000012" }] })).json.code, "BARCODE_TAKEN");
    assert.equal((await api(admin, "PATCH", `/catalog/products/${p.id}`, { conversions: [{ unitId: units["UND"], factor: 3 }] })).json.code, "CONVERSION_BASE");
  });

  it("desactivar un producto lo conserva y queda auditado", async () => {
    const p = (await api(admin, "POST", "/catalog/products", product({ name: "Descontinuado" }))).json;
    assert.equal((await api(admin, "PATCH", `/catalog/products/${p.id}`, { status: "INACTIVE" })).json.status, "INACTIVE");
    assert.equal((await api(admin, "GET", `/catalog/products/${p.id}`)).json.status, "INACTIVE");
    const acts = await withTenant(owner, world.tenantA, (tx) => tx.auditLog.findMany({ where: { entityId: p.id }, select: { action: true } }));
    assert.deepEqual(acts.map((a) => a.action).sort(), ["product.created", "product.deactivated"]);
  });
});

describe("listado, búsqueda y paginación", () => {
  before(async () => {
    const bev = (await api(admin, "GET", "/catalog/categories")).json;
    const beb = bev.find((c: { code: string }) => c.code === "BEB").id;
    const gas = bev.find((c: { code: string }) => c.code === "GAS").id;
    const brand = (await api(admin, "POST", "/catalog/brands", { name: "Marca listado" })).json.id;
    for (let i = 1; i <= 7; i++) {
      await api(admin, "POST", "/catalog/products", product({ code: `LST-${i}`, name: `Listado ${i}`, categoryId: i <= 4 ? gas : beb, brandId: brand }));
    }
  });

  it("busca por nombre, código o código de barras sin distinguir mayúsculas", async () => {
    const byName = (await api(admin, "GET", "/catalog/products?q=gaseosa")).json.items;
    assert.ok(byName.some((p: { code: string }) => p.code === "GAS-500"));
    assert.ok((await api(admin, "GET", "/catalog/products?q=lst-3")).json.items.some((p: { code: string }) => p.code === "LST-3"));
    const byBarcode = (await api(admin, "GET", "/catalog/products?q=7790001000012")).json.items;
    assert.equal(byBarcode.length, 1);
    assert.equal(byBarcode[0].name, "Con barras");
  });

  it("filtra por categoría incluyendo sus descendientes, por estado y por tipo", async () => {
    const cats = (await api(admin, "GET", "/catalog/categories")).json;
    const beb = cats.find((c: { code: string }) => c.code === "BEB").id;
    const gas = cats.find((c: { code: string }) => c.code === "GAS").id;
    const parent = (await api(admin, "GET", `/catalog/products?categoryId=${beb}&limit=100`)).json.items.filter((p: { code: string }) => p.code.startsWith("LST-"));
    const child = (await api(admin, "GET", `/catalog/products?categoryId=${gas}&limit=100`)).json.items.filter((p: { code: string }) => p.code.startsWith("LST-"));
    assert.equal(parent.length, 7, "la categoría padre incluye los de sus hijas");
    assert.equal(child.length, 4);
    assert.ok((await api(admin, "GET", "/catalog/products?status=INACTIVE&limit=100")).json.items.every((p: { status: string }) => p.status === "INACTIVE"));
    assert.ok((await api(admin, "GET", "/catalog/products?kind=SERVICE&limit=100")).json.items.every((p: { kind: string }) => p.kind === "SERVICE"));
  });

  it("pagina con cursor sin repetir ni omitir", async () => {
    const all = (await api(admin, "GET", "/catalog/products?limit=100")).json.items.map((p: { code: string }) => p.code);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const r: { items: { code: string }[]; nextCursor: string | null } = (await api(admin, "GET", `/catalog/products?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json;
      seen.push(...r.items.map((p) => p.code));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen, all);
    assert.deepEqual([...seen].sort(), seen, "orden por código");
    assert.equal(new Set(seen).size, seen.length);
  });

  it("valida el límite", async () => {
    assert.equal((await api(admin, "GET", "/catalog/products?limit=0")).status, 400);
    assert.equal((await api(admin, "GET", "/catalog/products?limit=101")).status, 400);
    assert.equal((await api(admin, "GET", "/catalog/products?categoryId=no-uuid")).status, 400);
  });
});

describe("aislamiento entre empresas e integridad en la base", () => {
  it("la empresa B no ve, lee ni edita productos de A", async () => {
    const p = (await api(admin, "GET", "/catalog/products?limit=1")).json.items[0];
    assert.deepEqual((await api(adminB, "GET", "/catalog/products")).json.items, []);
    assert.equal((await api(adminB, "GET", `/catalog/products/${p.id}`)).status, 404);
    assert.equal((await api(adminB, "PATCH", `/catalog/products/${p.id}`, { name: "Hack" })).status, 404);
  });

  it("B puede usar los mismos códigos y códigos de barras que A, pero no unidades de A", async () => {
    const unitsB = (await api(adminB, "GET", "/catalog/units")).json;
    const und = unitsB.find((u: { code: string }) => u.code === "UND").id;
    const r = await api(adminB, "POST", "/catalog/products", { code: "GAS-500", name: "Gaseosa de B", baseUnitId: und, barcodes: [{ barcode: "7790001000012" }] });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal((await api(adminB, "POST", "/catalog/products", { name: "Usa unidad ajena", baseUnitId: units["UND"] })).status, 404);
  });

  it("las claves foráneas compuestas impiden mezclar empresas aunque se evada la API", async () => {
    const catB = (await withTenant(owner, world.tenantB, async (tx) => {
      const id = uuidv7();
      await tx.category.create({ data: { id, tenantId: world.tenantB, code: "B1CAT", name: "De B" } });
      return id;
    }));
    const p = (await api(admin, "GET", "/catalog/products?limit=1")).json.items[0];
    await assert.rejects(withTenant(owner, world.tenantA, (tx) => tx.product.update({ where: { id: p.id }, data: { categoryId: catB } })));
  });

  it("las restricciones de la base rechazan datos imposibles", async () => {
    const p = (await api(admin, "GET", "/catalog/products?limit=1")).json.items[0];
    await assert.rejects(withTenant(owner, world.tenantA, (tx) =>
      tx.$executeRawUnsafe(`INSERT INTO product_unit_conversion (tenant_id, product_id, unit_id, factor) VALUES ('${world.tenantA}', '${p.id}', '${units["PQT"]}', 0)`)));
    await assert.rejects(withTenant(owner, world.tenantA, (tx) =>
      tx.$executeRawUnsafe(`UPDATE product SET track_expiry = true, track_lots = false WHERE id = '${p.id}'`)));
    await assert.rejects(withTenant(owner, world.tenantA, (tx) =>
      tx.$executeRawUnsafe(`UPDATE unit_of_measure SET decimals = 9 WHERE id = '${units["UND"]}'`)));
  });
});
