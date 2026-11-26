import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { call, setup, teardown, tokenFor, world } from "./support";

let admin: string, adminB: string, cashier: string, P: string, UND: string;
const dir = mkdtempSync(join(tmpdir(), "nexus-uploads-"));
type M = "GET" | "POST" | "PUT" | "DELETE";
const api = (token: string, method: M, url: string, body?: unknown) => call(method as any, `/api/v1${url}`, { token, body: body ?? (method === "POST" ? {} : undefined) });

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(30)]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(30)]);
const up = (buf: Buffer, fileName = "foto.png", token = admin, id = P) => api(token, "POST", `/catalog/products/${id}/images/upload`, { fileName, contentBase64: buf.toString("base64") });
const files = () => (existsSync(join(dir, world.tenantA)) ? readdirSync(join(dir, world.tenantA)) : []);

before(async () => {
  process.env.UPLOADS_DIR = dir;
  await setup();
  [admin, adminB, cashier] = await Promise.all([tokenFor("admin.a@test.local"), tokenFor("admin.b@test.local"), tokenFor("cajero@test.local")]);
  UND = (await api(admin, "GET", "/catalog/units")).json.find((u: { code: string }) => u.code === "UND").id;
  P = (await api(admin, "POST", "/catalog/products", { code: "LOC-1", name: "Producto con foto local", baseUnitId: UND })).json.id;
});
after(async () => { delete process.env.UPLOADS_DIR; await teardown(); rmSync(dir, { recursive: true, force: true }); });

describe("fotos subidas al servidor (sin Cloudinary)", () => {
  let first: any;
  it("sin Cloudinary el almacenamiento es el servidor", async () => {
    const r = await api(cashier, "GET", "/catalog/image-storage");
    assert.deepEqual([r.status, r.json.mode, r.json.maxImages, r.json.maxBytes], [200, "SERVER", 6, 5_000_000]);
  });
  it("sube una foto: se guarda en disco, es la principal y aparece en el listado", async () => {
    const r = await up(png);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    first = r.json;
    assert.deepEqual([r.json.isPrimary, r.json.bytes], [true, png.length]);
    assert.match(r.json.url, new RegExp(`^/media/${world.tenantA}/[0-9a-f-]{36}\\.png$`));
    assert.equal(r.json.thumbUrl, r.json.url);
    assert.equal(r.json.publicId.startsWith("local/"), true);
    assert.equal(files().length, 1);
    const p = (await api(cashier, "GET", "/catalog/products?q=LOC-1")).json.items[0];
    assert.equal(p.imageUrl, r.json.url);
  });
  it("detecta el tipo por los bytes: JPG, GIF y WebP valen; el nombre no importa", async () => {
    for (const [buf, ext] of [[jpg, "jpg"], [gif, "gif"], [webp, "webp"]] as const) {
      const r = await up(buf, "cualquier-cosa.txt");
      assert.equal(r.status, 200, `${ext}: ${JSON.stringify(r.json)}`);
      assert.ok(r.json.url.endsWith(`.${ext}`), r.json.url);
      assert.equal(r.json.isPrimary, false);
    }
  });
  it("rechaza lo que no es una imagen: texto, HTML, SVG y archivos vacíos o enormes", async () => {
    for (const [name, buf] of [["nota.png", Buffer.from("esto no es una imagen, solo texto largo para pasar el mínimo")], ["x.png", Buffer.from("<html><script>alert(1)</script></html>")], ["x.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>")]] as const) {
      const r = await up(buf, name);
      assert.deepEqual([r.status, r.json.code], [400, "IMAGE_INVALID"], name);
    }
    assert.equal((await up(Buffer.alloc(0))).status, 400);
    assert.equal((await up(Buffer.concat([png, Buffer.alloc(5_000_001)]))).json.code, "IMAGE_TOO_BIG");
    assert.equal(files().length, 4); // lo rechazado no deja archivos
  });
  it("máximo 6 fotos por producto", async () => {
    assert.equal((await up(png)).status, 200);
    assert.equal((await up(png)).status, 200);
    const r = await up(png);
    assert.deepEqual([r.status, r.json.code], [409, "IMAGE_LIMIT"]);
    assert.equal(files().length, 6);
  });
  it("cualquiera puede ver la imagen por su dirección aleatoria, con el tipo correcto y sin permitir interpretarla como página", async () => {
    const file = first.url.split("/").pop();
    const r = await call("GET", `/api/v1/public/media/${world.tenantA}/${file}`, {});
    assert.equal(r.status, 200);
    assert.equal(r.type, "image/png");
  });
  it("direcciones raras no devuelven nada (ni recorren carpetas)", async () => {
    for (const path of [`${world.tenantA}/..%2F..%2Fetc%2Fpasswd`, `${world.tenantA}/${"a".repeat(36)}.png`, `${world.tenantA}/00000000-0000-4000-8000-000000000000.png`, `no-es-uuid/${first.url.split("/").pop()}`, `${world.tenantA}/${first.url.split("/").pop()?.replace(".png", ".svg")}`, `${world.tenantB}/${first.url.split("/").pop()}`]) {
      assert.equal((await call("GET", `/api/v1/public/media/${path}`, {})).status, 404, path);
    }
  });
  it("solo quien administra el catálogo sube; otra empresa no ve el producto", async () => {
    assert.equal((await up(png, "x.png", cashier)).status, 403);
    assert.equal((await up(png, "x.png", adminB)).status, 404);
    assert.equal((await api(adminB, "GET", `/catalog/products/${P}/images`)).status, 404);
  });
  it("al quitar una foto se borra el archivo y otra pasa a ser la principal", async () => {
    const list = (await api(admin, "GET", `/catalog/products/${P}/images`)).json;
    const prim = list.find((i: any) => i.isPrimary);
    const before = files().length;
    assert.equal((await api(admin, "DELETE", `/catalog/products/${P}/images/${prim.id}`)).status, 204);
    assert.equal(files().length, before - 1);
    assert.ok(!files().includes(prim.url.split("/").pop()));
    const left = (await api(admin, "GET", `/catalog/products/${P}/images`)).json;
    assert.deepEqual([left.length, left.filter((i: any) => i.isPrimary).length], [5, 1]);
  });
});

describe("con Cloudinary activo no se sube al servidor", () => {
  it("el modo cambia a Cloudinary y la subida al servidor se rechaza", async () => {
    await api(admin, "PUT", "/integrations/cloudinary", { cloudName: "demo", apiKey: "123456789012345", apiSecret: "s3cr3t-de-prueba-123456", folder: "nexus/productos", enabled: true });
    assert.equal((await api(admin, "GET", "/catalog/image-storage")).json.mode, "CLOUDINARY");
    const r = await up(png);
    assert.deepEqual([r.status, r.json.code], [409, "CLOUDINARY_ACTIVE"]);
  });
  it("al desactivarla vuelve el servidor, y las fotos locales siguen disponibles", async () => {
    await api(admin, "PUT", "/integrations/cloudinary", { cloudName: "demo", apiKey: "123456789012345", folder: "nexus/productos", enabled: false });
    assert.equal((await api(admin, "GET", "/catalog/image-storage")).json.mode, "SERVER");
    assert.equal((await api(admin, "GET", `/catalog/products/${P}/images`)).json.length, 5);
  });
});
