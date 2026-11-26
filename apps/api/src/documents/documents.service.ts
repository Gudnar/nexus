import { connect } from "node:net";
import { BadGatewayException, Inject, Injectable } from "@nestjs/common";
import {
  DOCUMENT_TYPES, DocumentConfig, type DepositVoucherParams, type DocPaper, type DocumentTemplateView, type DocumentType, type PrinterInput, type PrinterView, type RenderedDocument, type TextPrintResult,
} from "@erp/contracts";
import { Prisma, uuidv7, writeAudit } from "@erp/db";
import { Clock } from "../access/clock";
import { localParts } from "../access/schedule";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { PurchasingService } from "../purchasing/purchasing.service";
import { QuotesService } from "../sales/quotes.service";
import { SalesService } from "../sales/sales.service";
import { buildEscpos, layoutText, plainText, testTicket, type Codepage, type CutMode } from "./escpos";
import { renderDocument, type DocData } from "./render-document";

const LABEL: Record<DocumentType, string> = { SALE_RECEIPT: "Recibo de venta", QUOTE: "Cotización", PURCHASE_ORDER: "Orden de compra", SUPPLIER_DEPOSIT: "Boleta de depósito a proveedor" };
/** Permiso necesario para imprimir cada tipo (el de ver el documento de origen). */
const READ: Record<DocumentType, string> = { SALE_RECEIPT: "sales.read", QUOTE: "sales.read", PURCHASE_ORDER: "purchases.read", SUPPLIER_DEPOSIT: "purchases.read" };
const DISCLAIMER: Partial<Record<DocumentType, string>> = {
  SALE_RECEIPT: "Documento comercial interno. No es una factura ni tiene validez fiscal.",
  QUOTE: "Cotización sujeta a disponibilidad y a la vigencia indicada. No es una factura.",
};

const defaults = (t: DocumentType): DocumentConfig => DocumentConfig.parse({ paper: t === "SALE_RECEIPT" || t === "SUPPLIER_DEPOSIT" ? "THERMAL_80" : "LETTER", footerText: t === "SALE_RECEIPT" ? "¡Gracias por su compra!" : "" });
const isType = (s: string): s is DocumentType => (DOCUMENT_TYPES as readonly string[]).includes(s);

const n = (v: string, d = 2) => Number(v).toLocaleString("es-BO", { minimumFractionDigits: d, maximumFractionDigits: d });
const q = (v: string) => Number(v).toLocaleString("es-BO", { maximumFractionDigits: 4 });
const METHOD: Record<string, string> = { CASH: "Efectivo", TRANSFER: "Transferencia", QR: "QR", CARD: "Tarjeta", CHEQUE: "Cheque" };

/**
 * Documentos comerciales imprimibles (plan §6.3–6.4). La plantilla (papel, márgenes, textos, campos visibles, copias) se versiona;
 * el HTML se genera en el servidor con los datos del documento y se imprime desde el navegador. Una plantilla comercial no es un
 * documento fiscal: el recibo lleva siempre su leyenda y no se puede quitar.
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(Clock) private readonly clock: Clock,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(QuotesService) private readonly quotes: QuotesService,
    @Inject(PurchasingService) private readonly purchasing: PurchasingService,
  ) {}

  // ───────────── Plantillas ─────────────

  async templates(ctx: RequestContext): Promise<DocumentTemplateView[]> {
    const rows = await ctx.run((tx) => tx.documentTemplate.findMany());
    return DOCUMENT_TYPES.map((t) => {
      const r = rows.find((x) => x.docType === t);
      return { docType: t, label: LABEL[t], version: r?.currentVersion ?? 0, customized: !!r, config: r ? DocumentConfig.parse(r.config) : defaults(t) };
    });
  }

  async saveTemplate(ctx: RequestContext, docType: string, config: DocumentConfig): Promise<DocumentTemplateView> {
    if (!isType(docType)) throw badRequest("TYPE_UNKNOWN", "Tipo de documento desconocido.");
    await ctx.run(async (tx) => {
      const cur = await tx.documentTemplate.findUnique({ where: { tenantId_docType: { tenantId: ctx.auth.tenantId, docType } } });
      const version = (cur?.currentVersion ?? 0) + 1;
      const t = cur
        ? await tx.documentTemplate.update({ where: { id: cur.id }, data: { config: config as unknown as Prisma.InputJsonValue, currentVersion: version, updatedById: ctx.auth.userId } })
        : await tx.documentTemplate.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, docType, name: LABEL[docType], config: config as unknown as Prisma.InputJsonValue, currentVersion: version, updatedById: ctx.auth.userId } });
      await tx.documentTemplateVersion.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, templateId: t.id, version, config: config as unknown as Prisma.InputJsonValue, createdById: ctx.auth.userId } });
      await writeAudit(tx, ctx.auth.tenantId, { action: "document.template_saved", entityType: "document_template", entityId: t.id, actorUserId: ctx.auth.userId, after: { docType, version, paper: config.paper } });
    });
    return (await this.templates(ctx)).find((t) => t.docType === docType)!;
  }

  // ───────────── Impresión ─────────────

  async render(ctx: RequestContext, docType: string, id: string, paper?: DocPaper, params: DepositVoucherParams = {}): Promise<RenderedDocument> {
    if (!isType(docType)) throw badRequest("TYPE_UNKNOWN", "Tipo de documento desconocido.");
    if (!(await ctx.permissions()).has(READ[docType])) throw forbid("FORBIDDEN", "No tienes permiso para ver este documento.");
    const config = { ...(await this.templates(ctx)).find((t) => t.docType === docType)!.config, ...(paper ? { paper } : {}) };
    const data = await this.load(ctx, docType, id, params);
    await this.audit(ctx, docType, id, data.code);
    return { title: `${data.title} ${data.code}`, paper: config.paper, copies: config.copies, html: renderDocument(data, config) };
  }

  /** Vista previa de una plantilla con datos de ejemplo (para ajustarla antes de guardarla). */
  async preview(ctx: RequestContext, docType: string, config: DocumentConfig): Promise<RenderedDocument> {
    if (!isType(docType)) throw badRequest("TYPE_UNKNOWN", "Tipo de documento desconocido.");
    const info = await ctx.tenantInfo();
    const data: DocData = {
      title: LABEL[docType], code: "EJEMPLO-000001", date: this.fmt(info.timezone),
      company: { name: info.legalName, taxId: null }, branch: { name: "Casa central", address: "Av. Principal 123", phone: "2-123456", email: "sucursal@empresa.com", register: "Caja 1" },
      party: { label: docType === "PURCHASE_ORDER" ? "Proveedor" : "Cliente", name: "Nombre de ejemplo" }, meta: [{ label: "Fecha", value: this.fmt(info.timezone) }],
      lines: [
        { code: "P-001", name: "Producto de ejemplo uno", qty: "2", unit: "UND", price: "10,00", discountPct: "0", total: "20,00" },
        { code: "P-002", name: "Producto de ejemplo dos con un nombre más largo", qty: "1", unit: "UND", price: "35,50", discountPct: "10", total: "31,95" },
      ],
      totals: [{ label: "Descuento", value: "3,55" }, { label: "Total", value: "51,95", strong: true }],
      taxes: [{ label: "Neto", value: "45,19" }, { label: "IVA 13%", value: "6,76" }],
      payments: docType === "SALE_RECEIPT" ? [{ label: "Efectivo", value: "51,95" }] : [],
      note: "Observaciones de ejemplo.", disclaimer: DISCLAIMER[docType] ?? null, currency: "BOB",
    };
    return { title: `Vista previa · ${LABEL[docType]}`, paper: config.paper, copies: config.copies, html: renderDocument(data, config) };
  }

  private fmt(tz: string, iso?: string): string {
    const d = iso ? new Date(iso) : this.clock.now();
    const p = localParts(d, tz);
    return `${p.date.split("-").reverse().join("/")}`;
  }

  private async audit(ctx: RequestContext, docType: string, id: string, code: string) {
    await ctx.run((tx) => writeAudit(tx, ctx.auth.tenantId, { action: "document.printed", entityType: docType.toLowerCase(), entityId: id, actorUserId: ctx.auth.userId, after: { code } }));
  }

  private async company(ctx: RequestContext) {
    const info = await ctx.tenantInfo();
    const t = await ctx.run(async (tx) => tx.tenant.findUnique({ where: { id: ctx.auth.tenantId }, select: { taxId: true } }));
    return { tz: info.timezone, company: { name: info.legalName, taxId: t?.taxId ?? null } };
  }

  /** Datos de la sucursal que emite el documento y, si se conoce, la caja donde se cobró. */
  private async branchOf(ctx: RequestContext, branchId: string | null, register?: string | null) {
    if (!branchId) return null;
    const b = await ctx.run((tx) => tx.branch.findUnique({ where: { id: branchId }, select: { name: true, address: true, phone: true, email: true } }));
    return b ? { ...b, register: register ?? null } : null;
  }

  /** Caja del turno en que se cobró la venta (null si no hubo cobro en caja). */
  private async registerOfSale(ctx: RequestContext, saleId: string): Promise<string | null> {
    return ctx.run(async (tx) => {
      const p = await tx.payment.findFirst({ where: { saleId, cashSessionId: { not: null } }, orderBy: { receivedAt: "asc" }, select: { cashSessionId: true } });
      if (!p?.cashSessionId) return null;
      const s = await tx.cashSession.findUnique({ where: { id: p.cashSessionId }, select: { register: { select: { name: true } } } });
      return s?.register.name ?? null;
    });
  }

  private async load(ctx: RequestContext, type: DocumentType, id: string, params: DepositVoucherParams = {}): Promise<DocData> {
    const { tz, company } = await this.company(ctx);
    if (type === "SUPPLIER_DEPOSIT") {
      const a = await this.purchasing.depositData(ctx, id);
      if (a.status !== "ACTIVE") throw conflict("ACCOUNT_INACTIVE", "Esa cuenta está inactiva: no se puede imprimir una boleta de depósito.");
      const now = this.clock.now();
      const p = localParts(now, tz);
      const hh = new Intl.DateTimeFormat("es-BO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
      const s = a.supplier;
      const typeLabel = a.accountType === "SAVINGS" ? "Caja de ahorro" : "Cuenta corriente";
      return {
        title: "Boleta de depósito", code: `DEP-${p.date.replace(/-/g, "")}-${hh.replace(":", "")}`, date: this.fmt(tz), company, branch: null,
        party: { label: "Proveedor", name: s.name },
        meta: [
          { label: "Fecha", value: `${this.fmt(tz)} ${hh}` }, { label: "Banco", value: a.bankName }, { label: "Cuenta", value: a.accountNumber }, { label: "Tipo", value: `${typeLabel} (${a.currency})` },
          { label: "Titular", value: a.holderName }, ...(a.holderTaxId ? [{ label: "NIT/CI titular", value: a.holderTaxId }] : []),
          ...(s.contactName ? [{ label: "Contacto", value: [s.contactName, s.contactRole].filter(Boolean).join(" - ") }] : []),
          ...(params.concept ? [{ label: "Concepto", value: params.concept }] : []),
        ],
        highlights: [{ label: "Monto a depositar", value: params.amount !== undefined ? `${n(String(params.amount))} ${a.currency}` : `________ ${a.currency}` }],
        lines: [], totals: [], taxes: [], payments: [], note: a.notes, signLines: ["Depositante", "Sello / N° de transacción del banco"],
        disclaimer: "Comprobante interno de solicitud de depósito. No reemplaza la boleta del banco.", currency: a.currency,
      };
    }
    if (type === "SALE_RECEIPT") {
      const s = await this.sales.get(ctx, id);
      if (s.status === "DRAFT") throw conflict("NOT_CONFIRMED", "Solo se imprime el recibo de una venta confirmada.");
      const sale = await ctx.run((tx) => tx.sale.findUnique({ where: { id }, select: { branchId: true } }));
      const taxes = new Map<string, number>();
      for (const l of s.lines) for (const t of l.taxes) if (!t.exempt) taxes.set(`${t.code} ${Number(t.rate)}%`, (taxes.get(`${t.code} ${Number(t.rate)}%`) ?? 0) + Number(t.amount));
      return {
        title: s.status === "CANCELLED" ? "Recibo ANULADO" : "Recibo de venta", code: s.code ?? "", date: this.fmt(tz, s.confirmedAt ?? s.createdAt), company,
        branch: await this.branchOf(ctx, sale?.branchId ?? null, await this.registerOfSale(ctx, id)), party: s.customer ? { label: "Cliente", name: s.customer.name } : null,
        meta: [{ label: "Fecha", value: this.fmt(tz, s.confirmedAt ?? s.createdAt) }, { label: "Almacén", value: s.warehouse.name }],
        lines: s.lines.map((l) => ({ code: l.productCode, name: l.productName, qty: q(l.quantity), unit: l.unit, price: n(String(Number(l.quantity) ? Number(l.totalAmount) / Number(l.quantity) : 0)), discountPct: l.discountPct, total: n(l.totalAmount) })),
        totals: [...(Number(s.discountTotal) > 0 ? [{ label: "Descuento", value: n(s.discountTotal) }] : []), { label: "Total", value: n(s.total), strong: true }, ...(Number(s.balance) > 0 ? [{ label: "Saldo por cobrar", value: n(s.balance) }] : [])],
        taxes: [{ label: "Neto", value: n(s.netTotal) }, ...[...taxes].map(([label, v]) => ({ label, value: n(String(v)) }))],
        payments: s.payments.map((p) => ({ label: METHOD[p.method] ?? p.method, value: n(p.amount) })),
        note: s.note, disclaimer: DISCLAIMER.SALE_RECEIPT!, currency: s.currency,
      };
    }
    if (type === "QUOTE") {
      const c = await this.quotes.get(ctx, id);
      const quote = await ctx.run((tx) => tx.quote.findUnique({ where: { id }, select: { branchId: true } }));
      return {
        title: "Cotización", code: c.code, date: this.fmt(tz, c.createdAt), company, branch: await this.branchOf(ctx, quote?.branchId ?? null),
        party: { label: "Cliente", name: c.customer?.name ?? c.prospectName ?? "—" },
        meta: [{ label: "Fecha", value: this.fmt(tz, c.createdAt) }, { label: "Válida hasta", value: c.validUntil.split("-").reverse().join("/") }],
        lines: c.lines.map((l) => ({ code: l.productCode, name: l.productName, qty: q(l.quantity), unit: l.unit, price: n(String(Number(l.quantity) ? Number(l.totalAmount) / Number(l.quantity) : 0)), discountPct: l.discountPct, total: n(l.totalAmount) })),
        totals: [{ label: "Total", value: n(c.total), strong: true }], taxes: [{ label: "Neto", value: n(c.netTotal) }, { label: "Impuestos", value: n(c.taxTotal) }],
        payments: [], note: c.note, disclaimer: DISCLAIMER.QUOTE!, currency: c.currency,
      };
    }
    const o = await this.purchasing.getOrder(ctx, id);
    if (o.status === "DRAFT") throw conflict("NOT_ISSUED", "Solo se imprime una orden emitida.");
    const poBranch = await ctx.run(async (tx) => (await tx.purchaseOrder.findUnique({ where: { id }, select: { warehouse: { select: { branchId: true } } } }))?.warehouse.branchId ?? null);
    return {
      title: "Orden de compra", code: o.code, date: this.fmt(tz, o.issuedAt ?? o.createdAt), company, branch: await this.branchOf(ctx, poBranch), party: { label: "Proveedor", name: o.supplier.name },
      meta: [{ label: "Fecha", value: this.fmt(tz, o.issuedAt ?? o.createdAt) }, { label: "Entregar en", value: o.warehouse.name }, ...(o.expectedOn ? [{ label: "Entrega prevista", value: o.expectedOn.split("-").reverse().join("/") }] : [])],
      lines: o.lines.map((l) => ({ code: l.productCode, name: l.productName, qty: q(l.quantity), unit: l.unit, price: n(l.unitCost), discountPct: "0", total: n(String(Number(l.quantity) * Number(l.unitCost))) })),
      totals: [{ label: "Total", value: n(o.total), strong: true }], taxes: [], payments: [], note: o.note, disclaimer: null, currency: o.currency,
    };
  }

  // ───────────── Impresoras ─────────────

  private toView(r: Prisma.PrinterDeviceGetPayload<{ include: { cashRegister: { select: { name: true } } } }>): PrinterView {
    return {
      id: r.id, name: r.name, kind: r.kind, paper: r.paper as DocPaper, connection: r.connection as PrinterView["connection"], mode: r.mode as PrinterView["mode"],
      host: r.host, port: r.port, charsPerLine: r.charsPerLine, codepage: r.codepage as PrinterView["codepage"], cutMode: r.cutMode as PrinterView["cutMode"],
      openDrawer: r.openDrawer, feedLines: r.feedLines, branchId: r.branchId, cashRegisterId: r.cashRegisterId, cashRegisterName: r.cashRegister?.name ?? null,
      isDefault: r.isDefault, active: r.active,
    };
  }

  async printers(ctx: RequestContext): Promise<PrinterView[]> {
    const rows = await ctx.run((tx) => tx.printerDevice.findMany({ include: { cashRegister: { select: { name: true } } }, orderBy: [{ active: "desc" }, { name: "asc" }] }));
    return rows.map((r) => this.toView(r));
  }

  /** Por red solo se permiten direcciones de la red local o de esta misma máquina: el servidor no debe poder llamar a Internet. */
  private assertLocalHost(input: PrinterInput) {
    if (input.connection !== "NETWORK") return;
    const h = (input.host ?? "").trim();
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    const ok = h === "localhost" || (!!m && m.slice(1).every((x) => Number(x) <= 255) && (
      Number(m[1]) === 10 || Number(m[1]) === 127 || (Number(m[1]) === 192 && Number(m[2]) === 168) || (Number(m[1]) === 172 && Number(m[2]) >= 16 && Number(m[2]) <= 31)
    ));
    if (!ok) throw badRequest("HOST_NOT_ALLOWED", "La impresora de red debe tener una dirección IP de tu red local (10.x.x.x, 172.16-31.x.x o 192.168.x.x).");
  }

  private async persist(ctx: RequestContext, id: string | null, input: PrinterInput): Promise<string> {
    this.assertLocalHost(input);
    return ctx.run(async (tx) => {
      if (input.branchId && !(await tx.branch.findUnique({ where: { id: input.branchId }, select: { id: true } }))) throw badRequest("BRANCH_UNKNOWN", "La sucursal no existe.");
      if (input.cashRegisterId && !(await tx.cashRegister.findUnique({ where: { id: input.cashRegisterId }, select: { id: true } }))) throw badRequest("REGISTER_UNKNOWN", "La caja no existe.");
      const dup = await tx.printerDevice.findFirst({ where: { name: input.name, ...(id ? { id: { not: id } } : {}) } });
      if (dup) throw conflict("PRINTER_EXISTS", "Ya hay una impresora con ese nombre.");
      if (input.isDefault) {
        // Una predeterminada por caja si la tiene; si no, una por sucursal.
        await tx.printerDevice.updateMany({ where: { isDefault: true, ...(id ? { id: { not: id } } : {}), ...(input.cashRegisterId ? { cashRegisterId: input.cashRegisterId } : { cashRegisterId: null, branchId: input.branchId ?? null }) }, data: { isDefault: false } });
      }
      const data = {
        name: input.name, kind: input.kind, paper: input.paper, connection: input.connection, mode: input.mode,
        host: input.connection === "NETWORK" ? input.host!.trim() : null, port: input.connection === "NETWORK" ? input.port! : null,
        charsPerLine: input.charsPerLine, codepage: input.codepage, cutMode: input.cutMode, openDrawer: input.openDrawer, feedLines: input.feedLines,
        branchId: input.branchId ?? null, cashRegisterId: input.cashRegisterId ?? null, isDefault: input.isDefault,
      };
      let pid = id;
      if (id) {
        if (!(await tx.printerDevice.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Impresora");
        await tx.printerDevice.update({ where: { id }, data });
      } else {
        pid = (await tx.printerDevice.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, ...data } })).id;
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: id ? "document.printer_updated" : "document.printer_added", entityType: "printer_device", entityId: pid!, actorUserId: ctx.auth.userId, after: { name: input.name, connection: input.connection, mode: input.mode, paper: input.paper } });
      return pid!;
    });
  }

  async addPrinter(ctx: RequestContext, input: PrinterInput): Promise<PrinterView> {
    const id = await this.persist(ctx, null, input);
    return (await this.printers(ctx)).find((p) => p.id === id)!;
  }

  async updatePrinter(ctx: RequestContext, id: string, input: PrinterInput): Promise<PrinterView> {
    await this.persist(ctx, id, input);
    return (await this.printers(ctx)).find((p) => p.id === id)!;
  }

  async deactivatePrinter(ctx: RequestContext, id: string): Promise<PrinterView> {
    await ctx.run(async (tx) => {
      const p = await tx.printerDevice.findUnique({ where: { id } });
      if (!p) throw notFound("Impresora");
      await tx.printerDevice.update({ where: { id }, data: { active: false, isDefault: false } });
    });
    return (await this.printers(ctx)).find((p) => p.id === id)!;
  }

  // ───────────── Impresión en modo texto (ESC/POS) ─────────────

  private async activePrinter(ctx: RequestContext, printerId: string) {
    const p = await ctx.run((tx) => tx.printerDevice.findUnique({ where: { id: printerId } }));
    if (!p) throw notFound("Impresora");
    if (!p.active) throw conflict("PRINTER_INACTIVE", "Esa impresora está desactivada.");
    return p;
  }

  /** Entrega los bytes: por red los envía el servidor; USB o puerto serie los envía el navegador (se devuelven en base64). */
  private async deliver(p: { id: string; connection: string; host: string | null; port: number | null }, bytes: Buffer, text: string): Promise<TextPrintResult> {
    let delivered = false;
    if (p.connection === "NETWORK") {
      await sendTcp(p.host!, p.port!, bytes);
      delivered = true;
    }
    return { printerId: p.id, connection: p.connection as TextPrintResult["connection"], delivered, bytes: bytes.length, dataBase64: bytes.toString("base64"), text };
  }

  private optionsOf(p: { charsPerLine: number; codepage: string; cutMode: string; openDrawer: boolean; feedLines: number }, copies: number) {
    return { width: p.charsPerLine, codepage: p.codepage as Codepage, cut: p.cutMode as CutMode, openDrawer: p.openDrawer, feedLines: p.feedLines, copies };
  }

  async printText(ctx: RequestContext, docType: string, id: string, printerId: string, params: DepositVoucherParams = {}): Promise<TextPrintResult> {
    if (!isType(docType)) throw badRequest("TYPE_UNKNOWN", "Tipo de documento desconocido.");
    if (!(await ctx.permissions()).has(READ[docType])) throw forbid("FORBIDDEN", "No tienes permiso para ver este documento.");
    const p = await this.activePrinter(ctx, printerId);
    if (p.mode !== "TEXT") throw conflict("PRINTER_NOT_TEXT", "Esta impresora imprime documentos con formato desde el navegador, no en modo texto.");
    const config = (await this.templates(ctx)).find((t) => t.docType === docType)!.config;
    const data = await this.load(ctx, docType, id, params);
    const rows = layoutText(data, config, p.charsPerLine);
    // El cajón solo se abre con recibos de venta (no con cotizaciones ni órdenes de compra).
    const opts = { ...this.optionsOf(p, config.copies), openDrawer: p.openDrawer && docType === "SALE_RECEIPT" };
    const result = await this.deliver(p, buildEscpos(rows, opts), plainText(rows));
    await this.audit(ctx, docType, id, data.code);
    return result;
  }

  async printTest(ctx: RequestContext, printerId: string): Promise<TextPrintResult> {
    const p = await this.activePrinter(ctx, printerId);
    if (p.mode !== "TEXT") throw conflict("PRINTER_NOT_TEXT", "La prueba en modo texto solo aplica a impresoras de tickets en modo texto.");
    const rows = testTicket(p.name, p.charsPerLine);
    return this.deliver(p, buildEscpos(rows, { ...this.optionsOf(p, 1), openDrawer: false }), plainText(rows));
  }

  /** Abre el cajón de dinero sin imprimir (p. ej. para dar cambio). */
  async openDrawer(ctx: RequestContext, printerId: string): Promise<TextPrintResult> {
    const p = await this.activePrinter(ctx, printerId);
    if (!p.openDrawer) throw conflict("NO_DRAWER", "Esta impresora no tiene un cajón configurado.");
    const bytes = Buffer.from([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
    await ctx.run((tx) => writeAudit(tx, ctx.auth.tenantId, { action: "document.drawer_opened", entityType: "printer_device", entityId: p.id, actorUserId: ctx.auth.userId }));
    return this.deliver(p, bytes, "");
  }
}

/** Envía los bytes a una impresora de red (puerto RAW, normalmente 9100) con un tiempo máximo de espera. */
function sendTcp(host: string, port: number, bytes: Buffer, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (msg: string) => reject(new BadGatewayException({ code: "PRINTER_UNREACHABLE", message: `No se pudo imprimir: ${msg} (${host}:${port}).` }));
    const sock = connect({ host, port });
    sock.setTimeout(timeoutMs, () => { sock.destroy(); fail("la impresora no respondió a tiempo"); });
    sock.once("error", (e: NodeJS.ErrnoException) => fail(e.code === "ECONNREFUSED" ? "conexión rechazada" : e.code === "EHOSTUNREACH" || e.code === "ENETUNREACH" ? "no hay ruta hasta la impresora" : e.message));
    sock.once("connect", () => sock.end(bytes, () => resolve()));
  });
}
