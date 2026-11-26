import type { DocPaper, DocumentConfig } from "@erp/contracts";

/** Datos ya normalizados de cualquier documento comercial: el renderizador no sabe de ventas ni de compras. */
export interface DocData {
  title: string;            // "Recibo de venta"
  code: string;
  date: string;             // ya formateada
  company: { name: string; taxId: string | null };
  branch: { name: string; address: string | null; phone: string | null } | null;
  /** Etiqueta y nombre de la contraparte (Cliente / Proveedor). */
  party: { label: string; name: string } | null;
  meta: { label: string; value: string }[];
  lines: { code: string; name: string; qty: string; unit: string; price: string; discountPct: string; total: string }[];
  totals: { label: string; value: string; strong?: boolean }[];
  taxes: { label: string; value: string }[];
  payments: { label: string; value: string }[];
  note: string | null;
  /** Leyenda obligatoria del tipo de documento (p. ej. "no es factura"). No se puede quitar desde la plantilla. */
  disclaimer: string | null;
  currency: string;
  /** Líneas para completar a mano (p. ej. «Depositante», «Firma»). */
  signLines?: string[];
  /** Datos destacados (en grande) debajo del título, p. ej. el monto a depositar. */
  highlights?: { label: string; value: string }[];
}

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Ancho útil por papel. Los térmicos tienen alto libre; carta y oficio, hoja fija. */
export const PAPER: Record<DocPaper, { css: string; widthMm: number | null; thermal: boolean; label: string }> = {
  THERMAL_58: { css: "58mm auto", widthMm: 58, thermal: true, label: "Térmica 58 mm" },
  THERMAL_80: { css: "80mm auto", widthMm: 80, thermal: true, label: "Térmica 80 mm" },
  LETTER: { css: "216mm 279mm", widthMm: null, thermal: false, label: "Carta" },
  LEGAL: { css: "216mm 356mm", widthMm: null, thermal: false, label: "Oficio" },
};

/** HTML autocontenido y listo para imprimir (sin scripts ni recursos externos). */
export function renderDocument(d: DocData, c: DocumentConfig): string {
  const p = PAPER[c.paper];
  const th = p.thermal;
  const narrow = c.paper === "THERMAL_58";
  const show = c.show;
  const money = (v: string) => v;
  const header = [
    `<h1>${esc(d.company.name)}</h1>`,
    d.company.taxId ? `<div class="muted">NIT ${esc(d.company.taxId)}</div>` : "",
    d.branch ? `<div class="muted">${esc(d.branch.name)}${d.branch.address ? " · " + esc(d.branch.address) : ""}${d.branch.phone ? " · Tel. " + esc(d.branch.phone) : ""}</div>` : "",
    ...c.headerLines.filter(Boolean).map((l) => `<div class="muted">${esc(l)}</div>`),
  ].join("");

  const meta = [
    ...(show.customer && d.party ? [{ label: d.party.label, value: d.party.name }] : []),
    ...d.meta,
  ].map((m) => `<div><span class="muted">${esc(m.label)}:</span> ${esc(m.value)}</div>`).join("");

  // En térmico las líneas van apiladas (nombre, luego cantidad × precio = total); en hoja, tabla completa.
  const lines = th
    ? d.lines.map((l) => `<div class="ln"><div>${esc(l.name)}</div><div class="r">${esc(l.qty)} ${esc(l.unit)}${show.unitPrice ? ` × ${money(esc(l.price))}` : ""}${show.discount && Number(l.discountPct) > 0 ? ` (−${esc(l.discountPct)}%)` : ""} <b>${money(esc(l.total))}</b></div></div>`).join("")
    : `<table><thead><tr><th>Código</th><th>Descripción</th><th class="r">Cant.</th>${show.unitPrice ? '<th class="r">Precio</th>' : ""}${show.discount ? '<th class="r">Desc.</th>' : ""}<th class="r">Importe</th></tr></thead><tbody>${d.lines.map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td class="r">${esc(l.qty)} ${esc(l.unit)}</td>${show.unitPrice ? `<td class="r">${esc(l.price)}</td>` : ""}${show.discount ? `<td class="r">${Number(l.discountPct) > 0 ? esc(l.discountPct) + "%" : ""}</td>` : ""}<td class="r">${esc(l.total)}</td></tr>`).join("")}</tbody></table>`;

  const totals = [
    ...(show.taxes ? d.taxes.map((t) => `<div class="row"><span>${esc(t.label)}</span><span>${esc(t.value)}</span></div>`) : []),
    ...d.totals.map((t) => `<div class="row${t.strong ? " strong" : ""}"><span>${esc(t.label)}</span><span>${esc(t.value)} ${t.strong ? esc(d.currency) : ""}</span></div>`),
  ].join("");
  const payments = show.payments && d.payments.length ? `<div class="sec">${d.payments.map((t) => `<div class="row"><span>${esc(t.label)}</span><span>${esc(t.value)}</span></div>`).join("")}</div>` : "";

  const highlights = (d.highlights ?? []).map((h) => `<div class="hl"><span class="muted">${esc(h.label)}</span><b>${esc(h.value)}</b></div>`).join("");
  const sign = (d.signLines ?? []).map((l) => `<div class="sign"><div class="line"></div>${esc(l)}</div>`).join("");
  const body = `<section class="doc">
<header>${header}</header>
<div class="sec"><div class="title">${esc(d.title)} ${esc(d.code)}</div>${meta}</div>
${highlights ? `<div class="sec">${highlights}</div>` : ""}
${d.lines.length ? `<div class="sec">${lines}</div>` : ""}
${totals ? `<div class="sec totals">${totals}</div>` : ""}
${payments}
${sign ? `<div class="sec">${sign}</div>` : ""}
${show.notes && d.note ? `<div class="sec muted">${esc(d.note)}</div>` : ""}
<footer>${c.footerText ? `<div>${esc(c.footerText)}</div>` : ""}${c.legalText ? `<div class="muted">${esc(c.legalText)}</div>` : ""}${d.disclaimer ? `<div class="muted disc">${esc(d.disclaimer)}</div>` : ""}</footer>
</section>`;

  const w = p.widthMm ? `width:${p.widthMm - 2 * c.marginMm}mm;` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(d.title)} ${esc(d.code)}</title>
<style>
@page{size:${p.css};margin:${p.thermal ? 0 : c.marginMm}mm}
*{box-sizing:border-box}
body{margin:0;font-family:${th ? "'Courier New',monospace" : "system-ui,Arial,sans-serif"};font-size:${narrow ? Math.min(c.fontSizePt, 8) : c.fontSizePt}pt;color:#000;background:#fff}
.doc{${w}${th ? `padding:${c.marginMm}mm;` : ""}margin:0 auto;page-break-after:always}
.doc:last-child{page-break-after:auto}
h1{font-size:1.25em;margin:0 0 2px;text-align:${th ? "center" : "left"}}
header{margin-bottom:6px;${th ? "text-align:center;" : ""}}
.muted{color:#444;font-size:.9em}.disc{margin-top:4px;font-style:italic}
.title{font-weight:700;margin:4px 0}
.sec{border-top:1px ${th ? "dashed" : "solid"} #999;padding:5px 0}
table{width:100%;border-collapse:collapse}th,td{padding:3px 4px;text-align:left}th{border-bottom:1px solid #000}
.r{text-align:right}
.hl{display:flex;justify-content:space-between;gap:8px;font-size:1.2em;margin:2px 0}
.sign{margin-top:22px;text-align:center}.sign .line{border-top:1px solid #000;margin-bottom:2px}
.ln{margin-bottom:3px}
.row{display:flex;justify-content:space-between;gap:8px}.strong{font-weight:700;font-size:1.1em}
.totals{margin-left:${th ? "0" : "auto"};${th ? "" : "max-width:320px;"}}
footer{border-top:1px ${th ? "dashed" : "solid"} #999;padding-top:5px;text-align:${th ? "center" : "left"}}
</style></head><body>${Array.from({ length: c.copies }, () => body).join("")}</body></html>`;
}
