/**
 * Convierte los recortes opacos de docs/login_assets en PNG con transparencia para poder
 * colocarlos sobre cualquier fondo. Sin dependencias: decodifica/codifica PNG con zlib.
 *
 * Método: relleno por inundación desde los bordes siguiendo el degradado del fondo
 * (comparación vecino a vecino) y un anillo de 2 px con alfa proporcional a la distancia
 * al fondo local, para conservar el suavizado de bordes de texto e íconos.
 *
 *   node scripts/prepare-login-assets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "../../docs/login_assets");
const OUT = resolve(root, "public/login");
mkdirSync(OUT, { recursive: true });

// Los que llevan fondo plano/degradado simple. La ilustración principal (foto) no se procesa.
const FILES = [
  "01_brand_logo_nexus_erp.png",
  "03_feature_sales_icon.png",
  "04_feature_inventory_icon.png",
  "05_feature_reports_icon.png",
  "06_feature_ecommerce_icon.png",
  "07_login_security_lock_icon.png",
  "11_security_shield_icon.png",
  "12_footer_globe_icon.png",
];

const STEP = 7; // salto máximo de color entre vecinos para seguir el degradado del fondo
const ABS = 55; // distancia máxima al color de borde para considerarse fondo
const RING = 2;

function decode(buf) {
  let p = 8, w = 0, h = 0, bpp = 3;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9])) throw new Error("solo PNG 8 bits RGB/RGBA");
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = raw[row + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  // → RGBA
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = px[i * bpp]; rgba[i * 4 + 1] = px[i * bpp + 1]; rgba[i * 4 + 2] = px[i * bpp + 2];
    rgba[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255;
  }
  return { w, h, rgba };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encode({ w, h, rgba }) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dist = (a, i, b, j) =>
  Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));

function removeBackground({ w, h, rgba }) {
  // Color de referencia: mediana del borde.
  const edge = [];
  for (let x = 0; x < w; x++) edge.push((x) * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y++) edge.push(y * w * 4, (y * w + w - 1) * 4);
  const med = (o) => edge.map((i) => rgba[i + o]).sort((a, b) => a - b)[edge.length >> 1];
  const ref = Buffer.from([med(0), med(1), med(2)]);

  const bg = new Uint8Array(w * h);
  const queue = [];
  const seed = (x, y) => {
    const k = y * w + x;
    if (!bg[k] && dist(rgba, k * 4, ref, 0) < ABS) { bg[k] = 1; queue.push(k); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], x = k % w, y = (k / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (!bg[n] && dist(rgba, n * 4, rgba, k * 4) <= STEP && dist(rgba, n * 4, ref, 0) < ABS) { bg[n] = 1; queue.push(n); }
    }
  }

  const out = Buffer.from(rgba);
  const near = (k) => {
    // Anillo: píxeles no-fondo a ≤ RING del fondo; devuelve el color de fondo local o null.
    const x = k % w, y = (k / w) | 0;
    for (let r = 1; r <= RING; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx]) return (ny * w + nx) * 4;
        }
    return null;
  };
  for (let k = 0; k < w * h; k++) {
    const i = k * 4;
    if (bg[k]) { out[i + 3] = 0; continue; }
    const j = near(k);
    if (j === null) continue;
    const d = dist(rgba, i, rgba, j);
    const alpha = Math.min(1, d / 48);
    out[i + 3] = Math.round(alpha * 255);
    if (alpha > 0.05) // des-mezcla el color contra el fondo para evitar halos claros
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(rgba[j + c] + (rgba[i + c] - rgba[j + c]) / alpha)));
  }
  const removed = bg.reduce((s, v) => s + v, 0);
  return { img: { w, h, rgba: out }, removed: removed / (w * h) };
}

for (const f of FILES) {
  const { img, removed } = removeBackground(decode(readFileSync(resolve(SRC, f))));
  writeFileSync(resolve(OUT, f), encode(img));
  console.log(`${f}: ${(removed * 100).toFixed(0)}% de fondo transparente`);
}
