import type { DocumentConfig } from "@erp/contracts";
import type { DocData } from "./render-document";

export type Codepage = "CP858" | "CP850" | "CP437" | "WPC1252" | "UTF8";
export type CutMode = "NONE" | "PARTIAL" | "FULL";

/** Byte de cada letra del español en cada página de códigos de impresora térmica (ESC t n). */
const COMMON: Record<string, number> = { "á": 0xa0, "é": 0x82, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "ü": 0x81, "Ü": 0x9a, "¿": 0xa8, "¡": 0xad, "ª": 0xa6, "º": 0xa7, "ç": 0x87, "Ç": 0x80, "°": 0xf8 };
const TABLES: Record<Exclude<Codepage, "WPC1252" | "UTF8">, Record<string, number>> = {
  CP437: { ...COMMON, "É": 0x90 },
  CP850: { ...COMMON, "É": 0x90, "Á": 0xb5, "Í": 0xd6, "Ó": 0xe0, "Ú": 0xe9 },
  CP858: { ...COMMON, "É": 0x90, "Á": 0xb5, "Í": 0xd6, "Ó": 0xe0, "Ú": 0xe9, "€": 0xd5 },
};
/** Número de la página de códigos para el comando ESC t. */
const PAGE: Record<Exclude<Codepage, "UTF8">, number> = { CP437: 0, CP850: 2, CP858: 19, WPC1252: 16 };

const strip = (c: string) => c.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Codifica texto a los bytes de la página elegida; lo que no existe en ella pierde el acento o sale como «?». */
export function encodeText(text: string, cp: Codepage): Buffer {
  if (cp === "UTF8") return Buffer.from(text, "utf8");
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x0a) { out.push(0x0a); continue; }
    if (code >= 0x20 && code < 0x7f) { out.push(code); continue; }
    if (cp === "WPC1252") {
      if (ch === "€") { out.push(0x80); continue; }
      if (code >= 0xa0 && code <= 0xff) { out.push(code); continue; }
    } else {
      const b = TABLES[cp][ch];
      if (b !== undefined) { out.push(b); continue; }
    }
    const base = strip(ch);
    out.push(base.length === 1 && base.charCodeAt(0) >= 0x20 && base.charCodeAt(0) < 0x7f ? base.charCodeAt(0) : 0x3f);
  }
  return Buffer.from(out);
}

// ───────────── Maquetación en texto ─────────────

const center = (s: string, w: number) => (s.length >= w ? s : " ".repeat(Math.floor((w - s.length) / 2)) + s);
const pair = (l: string, r: string, w: number) => (l.length + r.length + 1 > w ? `${l.slice(0, Math.max(1, w - r.length - 1))} ${r}` : l + " ".repeat(w - l.length - r.length) + r);

/** Parte un texto en líneas de hasta `w` caracteres sin cortar palabras (corta las muy largas). */
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (let word of raw.split(/\s+/).filter(Boolean)) {
      while (word.length > w) { if (line) { out.push(line); line = ""; } out.push(word.slice(0, w)); word = word.slice(w); }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= w) line += " " + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

interface Row { text: string; align?: "left" | "center" | "right"; bold?: boolean; rule?: boolean }

/** Documento como filas de texto de ancho fijo (lo que sale en el ticket), sin comandos de impresora. */
export function layoutText(d: DocData, c: DocumentConfig, w: number): Row[] {
  const rows: Row[] = [];
  const add = (text: string, o: Omit<Row, "text"> = {}) => rows.push({ text, ...o });
  const rule = () => add("-".repeat(w), { rule: true });
  for (const l of wrap(d.company.name, w)) add(center(l, w), { bold: true });
  if (d.company.taxId) add(center(`NIT ${d.company.taxId}`, w));
  if (d.branch) for (const part of [d.branch.name, d.branch.address, [d.branch.phone && `Tel. ${d.branch.phone}`, d.branch.email].filter(Boolean).join(" - "), d.branch.register && `Caja: ${d.branch.register}`]) if (part) for (const l of wrap(part, w)) add(center(l, w));
  for (const h of c.headerLines.filter(Boolean)) for (const l of wrap(h, w)) add(center(l, w));
  rule();
  add(`${d.title} ${d.code}`.slice(0, w), { bold: true });
  if (c.show.customer && d.party) for (const l of wrap(`${d.party.label}: ${d.party.name}`, w)) add(l);
  for (const m of d.meta) for (const l of wrap(`${m.label}: ${m.value}`, w)) add(l);
  rule();
  for (const h of d.highlights ?? []) { add(pair(h.label, h.value, w), { bold: true }); }
  if (d.highlights?.length) rule();
  for (const l of d.lines) {
    for (const t of wrap(l.name, w)) add(t);
    const detail = `${l.qty} ${l.unit}${c.show.unitPrice ? ` x ${l.price}` : ""}${c.show.discount && Number(l.discountPct) > 0 ? ` -${l.discountPct}%` : ""}`;
    add(pair(detail, l.total, w));
  }
  if (d.lines.length) rule();
  if (c.show.taxes) for (const t of d.taxes) add(pair(t.label, t.value, w));
  for (const t of d.totals) add(pair(t.label, `${t.value}${t.strong ? " " + d.currency : ""}`, w), { bold: t.strong });
  for (const l of d.signLines ?? []) { add(""); add(""); add("_".repeat(Math.min(w, 28))); add(l); }
  if (c.show.payments && d.payments.length) { rule(); for (const p of d.payments) add(pair(p.label, p.value, w)); }
  if (c.show.notes && d.note) { rule(); for (const l of wrap(d.note, w)) add(l); }
  rule();
  for (const t of [c.footerText, c.legalText, d.disclaimer ?? ""].filter(Boolean)) for (const l of wrap(t, w)) add(center(l, w));
  return rows;
}

export const plainText = (rows: Row[]) => rows.map((r) => r.text).join("\n");

export interface EscposOptions { width: number; codepage: Codepage; cut: CutMode; openDrawer: boolean; feedLines: number; copies: number }

/** Comandos ESC/POS estándar (los entienden las térmicas chinas Epson-compatibles: Xprinter, Rongta, Munbyn, GOOJPRT…). */
export function buildEscpos(rows: Row[], o: EscposOptions): Buffer {
  const parts: Buffer[] = [];
  const cmd = (...b: number[]) => parts.push(Buffer.from(b));
  for (let copy = 0; copy < o.copies; copy++) {
    cmd(0x1b, 0x40); // ESC @ : reinicia la impresora
    if (o.codepage !== "UTF8") cmd(0x1b, 0x74, PAGE[o.codepage]); // ESC t n : página de códigos
    if (o.openDrawer && copy === 0) cmd(0x1b, 0x70, 0x00, 0x19, 0xfa); // ESC p 0 25 250 : pulso al cajón
    for (const r of rows) {
      if (r.bold) cmd(0x1b, 0x45, 1);
      parts.push(encodeText(r.text, o.codepage), Buffer.from([0x0a]));
      if (r.bold) cmd(0x1b, 0x45, 0);
    }
    if (o.feedLines > 0) cmd(0x1b, 0x64, o.feedLines); // ESC d n : avanza n líneas
    if (o.cut === "FULL") cmd(0x1d, 0x56, 0x00); // GS V 0 : corte total
    else if (o.cut === "PARTIAL") cmd(0x1d, 0x56, 0x01); // GS V 1 : corte parcial
  }
  return Buffer.concat(parts);
}

/** Ticket de prueba para comprobar conexión, ancho de línea, acentos, corte y cajón. */
export function testTicket(name: string, w: number): Row[] {
  const rows: Row[] = [{ text: center("PRUEBA DE IMPRESION", w), bold: true }, { text: center(name, w) }, { text: "-".repeat(w), rule: true }];
  rows.push({ text: "Acentos: áéíóú ñ Ñ ¿? ¡! ü" }, { text: "Ancho: " + w + " caracteres" });
  rows.push({ text: "1234567890".repeat(Math.ceil(w / 10)).slice(0, w) });
  rows.push({ text: pair("Izquierda", "Derecha", w) }, { text: "-".repeat(w), rule: true }, { text: center("Si lees esto, funciona.", w) });
  return rows;
}
