import { Inject, Injectable } from "@nestjs/common";
import type {
  GoodsReceiptInput, GoodsReceiptSummary, PurchaseOrderDetail, PurchaseOrderInput, PurchaseOrderPatch, PurchaseOrderSummary, PurchaseStatus,
  SupplierInput, SupplierPatch, SupplierSummary, BankAccountInput, BankAccountPatch, BankAccountView, SupplierHistoryEntry,
} from "@erp/contracts";
import { Prisma, nextSequenceNumber, uuidv7, writeAudit, type BranchAccessLevel, type Tx } from "@erp/db";
import { badRequest, conflict, forbid, notFound } from "../admin/actor";
import type { RequestContext } from "../common/request-context";
import { InventoryService } from "../inventory/inventory.service";
import { StockEngine } from "../inventory/stock-engine";

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Correlativo sin huecos; la secuencia se crea la primera vez. Llamar al FINAL de la transacción (ADR-006). */
async function nextCode(tx: Tx, tenantId: string, documentType: string, prefix: string): Promise<string> {
  if (!(await tx.sequence.findFirst({ where: { documentType, branchId: null }, select: { id: true } }))) {
    await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType, prefix, padding: 6 } });
  }
  return (await nextSequenceNumber(tx, documentType)).formatted;
}

const orderInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  lines: { include: { product: { select: { code: true, name: true, trackLots: true, trackExpiry: true, baseUnit: { select: { code: true } } } } }, orderBy: { id: "asc" as const } },
  receipts: { select: { id: true, code: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.PurchaseOrderInclude;
type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

const receiptInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  order: { select: { id: true, code: true } },
  lines: { include: { product: { select: { code: true, name: true } }, lot: { select: { code: true } } }, orderBy: { id: "asc" as const } },
} satisfies Prisma.GoodsReceiptInclude;
type ReceiptRow = Prisma.GoodsReceiptGetPayload<{ include: typeof receiptInclude }>;

@Injectable()
export class PurchasingService {
  constructor(
    @Inject(StockEngine) private readonly engine: StockEngine,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  private async branches(ctx: RequestContext, tx: Tx, minLevel: BranchAccessLevel): Promise<string[]> {
    return (await ctx.branchScope(tx, { allowAll: true, defaultToAll: true, minLevel })).branchIds;
  }

  private async warehouseFor(ctx: RequestContext, tx: Tx, id: string, minLevel: BranchAccessLevel) {
    const w = await tx.warehouse.findUnique({ where: { id }, select: { id: true, branchId: true, status: true, kind: true } });
    if (!w) throw notFound("Almacén");
    if (!(await this.branches(ctx, tx, minLevel)).includes(w.branchId)) throw forbid("BRANCH_FORBIDDEN", "No tienes acceso a la sucursal de ese almacén.");
    if (w.status !== "ACTIVE" || w.kind !== "STORAGE") throw conflict("WAREHOUSE_INACTIVE", "El almacén no está disponible.");
    return w;
  }

  // ───────────── Proveedores ─────────────

  listSuppliers(ctx: RequestContext): Promise<SupplierSummary[]> {
    return ctx.run(async (tx) => {
      const rows = await tx.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { orders: true } } } });
      return rows.map(toSupplier);
    });
  }

  createSupplier(ctx: RequestContext, input: SupplierInput): Promise<SupplierSummary> {
    return ctx.run(async (tx) => {
      const id = uuidv7();
      try {
        await tx.supplier.create({
          data: {
            id, tenantId: ctx.auth.tenantId, code: input.code, name: input.name, taxId: blank(input.taxId), contactName: blank(input.contactName), contactRole: blank(input.contactRole),
            email: blank(input.email), phone: blank(input.phone), address: blank(input.address), paymentTermsDays: input.paymentTermsDays,
          },
        });
      } catch (e) {
        if (isUnique(e)) throw conflict("CODE_TAKEN", "Ya existe un proveedor con ese código.");
        throw e;
      }
      await writeAudit(tx, ctx.auth.tenantId, { action: "supplier.created", entityType: "supplier", entityId: id, actorUserId: ctx.auth.userId, after: { code: input.code, name: input.name } });
      return toSupplier(await tx.supplier.findUniqueOrThrow({ where: { id }, include: { _count: { select: { orders: true } } } }));
    });
  }

  updateSupplier(ctx: RequestContext, id: string, patch: SupplierPatch): Promise<SupplierSummary> {
    return ctx.run(async (tx) => {
      const prev = await tx.supplier.findUnique({ where: { id } });
      if (!prev) throw notFound("Proveedor");
      await tx.supplier.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.taxId !== undefined ? { taxId: blank(patch.taxId) } : {}),
          ...(patch.contactName !== undefined ? { contactName: blank(patch.contactName) } : {}),
          ...(patch.contactRole !== undefined ? { contactRole: blank(patch.contactRole) } : {}),
          ...(patch.email !== undefined ? { email: blank(patch.email) } : {}),
          ...(patch.phone !== undefined ? { phone: blank(patch.phone) } : {}),
          ...(patch.address !== undefined ? { address: blank(patch.address) } : {}),
          ...(patch.paymentTermsDays !== undefined ? { paymentTermsDays: patch.paymentTermsDays } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "supplier.updated", entityType: "supplier", entityId: id, actorUserId: ctx.auth.userId, after: patch });
      // El contacto (persona, cargo, teléfono, correo) es parte del historial del proveedor.
      const fields = { contactName: "Contacto", contactRole: "Cargo", phone: "Teléfono", email: "Correo" } as const;
      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
        if (patch[k] === undefined) continue;
        const nv = blank(patch[k]);
        if (nv !== prev[k]) { before[k] = prev[k]; after[k] = nv; }
      }
      const changed = Object.keys(after) as (keyof typeof fields)[];
      if (changed.length) await this.log(tx, ctx, id, "CONTACT_CHANGED", `Contacto actualizado: ${changed.map((k) => `${fields[k]}: ${before[k] ?? "—"} → ${after[k] ?? "—"}`).join("; ")}`, before, after);
      return toSupplier(await tx.supplier.findUniqueOrThrow({ where: { id }, include: { _count: { select: { orders: true } } } }));
    });
  }

  // ───────────── Cuentas bancarias e historial del proveedor ─────────────

  private async log(tx: Tx, ctx: RequestContext, supplierId: string, kind: string, summary: string, before: unknown, after: unknown) {
    await tx.supplierHistory.create({
      data: {
        id: uuidv7(), tenantId: ctx.auth.tenantId, supplierId, kind, summary, actorUserId: ctx.auth.userId,
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined, after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  listBankAccounts(ctx: RequestContext, supplierId: string): Promise<BankAccountView[]> {
    return ctx.run(async (tx) => {
      if (!(await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) throw notFound("Proveedor");
      const rows = await tx.supplierBankAccount.findMany({ where: { supplierId }, orderBy: [{ status: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }] });
      return rows.map(toBankAccount);
    });
  }

  createBankAccount(ctx: RequestContext, supplierId: string, input: BankAccountInput): Promise<BankAccountView> {
    return ctx.run(async (tx) => {
      if (!(await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) throw notFound("Proveedor");
      const active = await tx.supplierBankAccount.count({ where: { supplierId, status: "ACTIVE" } });
      const dup = await tx.supplierBankAccount.findFirst({ where: { supplierId, status: "ACTIVE", bankName: input.bankName, accountNumber: input.accountNumber } });
      if (dup) throw conflict("ACCOUNT_DUPLICATE", "Ese proveedor ya tiene esa cuenta registrada en ese banco.");
      const isDefault = input.isDefault || active === 0;
      if (isDefault) await tx.supplierBankAccount.updateMany({ where: { supplierId, isDefault: true }, data: { isDefault: false } });
      const id = uuidv7();
      const row = await tx.supplierBankAccount.create({
        data: {
          id, tenantId: ctx.auth.tenantId, supplierId, bankName: input.bankName, accountNumber: input.accountNumber, accountType: input.accountType, currency: input.currency,
          holderName: input.holderName, holderTaxId: blank(input.holderTaxId), notes: blank(input.notes), isDefault,
        },
      });
      const view = toBankAccount(row);
      await this.log(tx, ctx, supplierId, "BANK_ACCOUNT_ADDED", `Cuenta agregada: ${row.bankName} ${row.accountNumber} (${row.holderName})`, null, view);
      await writeAudit(tx, ctx.auth.tenantId, { action: "supplier.bank_account_added", entityType: "supplier", entityId: supplierId, actorUserId: ctx.auth.userId, after: { bankName: row.bankName } });
      return view;
    });
  }

  updateBankAccount(ctx: RequestContext, supplierId: string, accountId: string, patch: BankAccountPatch): Promise<BankAccountView> {
    return ctx.run(async (tx) => {
      const prev = await tx.supplierBankAccount.findFirst({ where: { id: accountId, supplierId } });
      if (!prev) throw notFound("Cuenta bancaria");
      const data: Prisma.SupplierBankAccountUpdateInput = {};
      if (patch.bankName !== undefined) data.bankName = patch.bankName;
      if (patch.accountNumber !== undefined) data.accountNumber = patch.accountNumber;
      if (patch.accountType !== undefined) data.accountType = patch.accountType;
      if (patch.currency !== undefined) data.currency = patch.currency;
      if (patch.holderName !== undefined) data.holderName = patch.holderName;
      if (patch.holderTaxId !== undefined) data.holderTaxId = blank(patch.holderTaxId);
      if (patch.notes !== undefined) data.notes = blank(patch.notes);
      if (patch.status !== undefined) data.status = patch.status;
      const becomesActive = (patch.status ?? prev.status) === "ACTIVE";
      const wantsDefault = patch.isDefault ?? prev.isDefault;
      if (wantsDefault && becomesActive) {
        await tx.supplierBankAccount.updateMany({ where: { supplierId, isDefault: true, NOT: { id: accountId } }, data: { isDefault: false } });
        data.isDefault = true;
      } else if (!becomesActive || patch.isDefault === false) data.isDefault = false;
      const row = await tx.supplierBankAccount.update({ where: { id: accountId }, data });
      const before = toBankAccount(prev);
      const after = toBankAccount(row);
      const labels: Record<string, string> = { bankName: "Banco", accountNumber: "Nº de cuenta", accountType: "Tipo", currency: "Moneda", holderName: "Titular", holderTaxId: "NIT/CI del titular", notes: "Notas", isDefault: "Principal", status: "Estado" };
      const diffs = (Object.keys(labels) as (keyof BankAccountView)[]).filter((k) => before[k] !== after[k]);
      if (diffs.length) {
        const kind = before.status === "ACTIVE" && after.status === "INACTIVE" ? "BANK_ACCOUNT_DEACTIVATED" : before.status === "INACTIVE" && after.status === "ACTIVE" ? "BANK_ACCOUNT_REACTIVATED" : "BANK_ACCOUNT_CHANGED";
        await this.log(tx, ctx, supplierId, kind, `Cuenta ${before.bankName} ${before.accountNumber}: ${diffs.map((k) => `${labels[k]}: ${String(before[k] ?? "—")} → ${String(after[k] ?? "—")}`).join("; ")}`, before, after);
        await writeAudit(tx, ctx.auth.tenantId, { action: "supplier.bank_account_changed", entityType: "supplier", entityId: supplierId, actorUserId: ctx.auth.userId, after: { accountId, fields: diffs } });
      }
      return after;
    });
  }

  supplierHistory(ctx: RequestContext, supplierId: string): Promise<SupplierHistoryEntry[]> {
    return ctx.run(async (tx) => {
      if (!(await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }))) throw notFound("Proveedor");
      const rows = await tx.supplierHistory.findMany({ where: { supplierId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 });
      const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
      const names = new Map<string, string>();
      if (ids.length) for (const m of await tx.membership.findMany({ where: { userId: { in: ids } }, select: { userId: true, user: { select: { name: true } } } })) names.set(m.userId, m.user.name);
      return rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, before: r.before, after: r.after, actor: r.actorUserId ? names.get(r.actorUserId) ?? null : null, createdAt: r.createdAt.toISOString() }));
    });
  }

  /** Datos de la cuenta y del proveedor para la boleta de depósito. */
  depositData(ctx: RequestContext, accountId: string) {
    return ctx.run(async (tx) => {
      const a = await tx.supplierBankAccount.findUnique({ where: { id: accountId }, include: { supplier: true } });
      if (!a) throw notFound("Cuenta bancaria");
      return a;
    });
  }

  // ───────────── Órdenes de compra ─────────────

  listOrders(ctx: RequestContext, q: { status?: PurchaseStatus; supplierId?: string }): Promise<PurchaseOrderSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.purchaseOrder.findMany({
        where: { branchId: { in: ids }, ...(q.status ? { status: q.status } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) },
        orderBy: { createdAt: "desc" }, take: 100, include: orderInclude,
      });
      return rows.map(toOrderSummary);
    });
  }

  getOrder(ctx: RequestContext, id: string): Promise<PurchaseOrderDetail> {
    return ctx.run(async (tx) => {
      const o = await tx.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
      if (!o || !(await this.branches(ctx, tx, "VIEW")).includes(o.branchId)) throw notFound("Orden de compra");
      return toOrderDetail(o);
    });
  }

  createOrder(ctx: RequestContext, input: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
    return ctx.run(async (tx) => {
      const wh = await this.warehouseFor(ctx, tx, input.warehouseId, "OPERATE");
      await this.assertSupplier(tx, input.supplierId);
      await this.assertLines(tx, input.lines);
      const id = uuidv7();
      const code = await nextCode(tx, ctx.auth.tenantId, "PURCHASE_ORDER", "OC-");
      await tx.purchaseOrder.create({
        data: {
          id, tenantId: ctx.auth.tenantId, branchId: wh.branchId, warehouseId: wh.id, supplierId: input.supplierId, code, currency: input.currency,
          expectedOn: input.expectedOn ? dateOnly(input.expectedOn) : null, note: blank(input.note), createdById: ctx.auth.userId,
        },
      });
      await this.writeLines(tx, ctx.auth.tenantId, id, input.lines);
      await writeAudit(tx, ctx.auth.tenantId, { action: "purchase_order.created", entityType: "purchase_order", entityId: id, branchId: wh.branchId, actorUserId: ctx.auth.userId, after: { code, lines: input.lines.length } });
      return toOrderDetail(await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude }));
    });
  }

  updateOrder(ctx: RequestContext, id: string, patch: PurchaseOrderPatch): Promise<PurchaseOrderDetail> {
    return ctx.run(async (tx) => {
      const o = await this.lockOrder(ctx, tx, id, "OPERATE");
      if (o.status !== "DRAFT") throw conflict("ORDER_NOT_EDITABLE", "Solo se puede editar una orden en borrador.");
      let branchId = o.branchId;
      if (patch.warehouseId && patch.warehouseId !== o.warehouseId) branchId = (await this.warehouseFor(ctx, tx, patch.warehouseId, "OPERATE")).branchId;
      if (patch.supplierId) await this.assertSupplier(tx, patch.supplierId);
      if (patch.lines) {
        await this.assertLines(tx, patch.lines);
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
        await this.writeLines(tx, ctx.auth.tenantId, id, patch.lines);
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          branchId,
          ...(patch.warehouseId ? { warehouseId: patch.warehouseId } : {}), ...(patch.supplierId ? { supplierId: patch.supplierId } : {}),
          ...(patch.expectedOn !== undefined ? { expectedOn: patch.expectedOn ? dateOnly(patch.expectedOn) : null } : {}),
          ...(patch.note !== undefined ? { note: blank(patch.note) } : {}),
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "purchase_order.updated", entityType: "purchase_order", entityId: id, branchId, actorUserId: ctx.auth.userId, after: { lines: patch.lines?.length } });
      return toOrderDetail(await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude }));
    });
  }

  /** DRAFT → ISSUED. */
  issueOrder(ctx: RequestContext, id: string): Promise<PurchaseOrderDetail> {
    return this.transition(ctx, id, "purchase_order.issued", async (tx, o) => {
      if (o.status !== "DRAFT") throw conflict("INVALID_STATE", "Solo se emite una orden en borrador.");
      await this.assertSupplierActive(tx, o.supplierId);
      return { status: "ISSUED", issuedAt: new Date() };
    });
  }

  /** Cancela una orden sin recepciones vigentes. */
  cancelOrder(ctx: RequestContext, id: string): Promise<PurchaseOrderDetail> {
    return this.transition(ctx, id, "purchase_order.cancelled", async (tx, o) => {
      if (o.status !== "DRAFT" && o.status !== "ISSUED") throw conflict("INVALID_STATE", "Solo se cancela una orden en borrador o emitida sin recepciones. Si ya se recibió algo, ciérrala.");
      if (await tx.goodsReceipt.findFirst({ where: { orderId: o.id, status: "POSTED" }, select: { id: true } })) throw conflict("HAS_RECEIPTS", "La orden tiene recepciones vigentes.");
      return { status: "CANCELLED" };
    });
  }

  /** Da por terminada una orden parcialmente recibida (lo pendiente ya no llegará). */
  closeOrder(ctx: RequestContext, id: string): Promise<PurchaseOrderDetail> {
    return this.transition(ctx, id, "purchase_order.closed", async (_tx, o) => {
      if (o.status !== "PARTIALLY_RECEIVED") throw conflict("INVALID_STATE", "Solo se cierra una orden parcialmente recibida.");
      return { status: "RECEIVED" };
    });
  }

  private transition(
    ctx: RequestContext, id: string, action: string,
    fn: (tx: Tx, o: { id: string; status: PurchaseStatus; supplierId: string }) => Promise<Prisma.PurchaseOrderUpdateInput>,
  ): Promise<PurchaseOrderDetail> {
    return ctx.run(async (tx) => {
      const o = await this.lockOrder(ctx, tx, id, "OPERATE");
      const data = await fn(tx, o);
      await tx.purchaseOrder.update({ where: { id }, data });
      await writeAudit(tx, ctx.auth.tenantId, { action, entityType: "purchase_order", entityId: id, branchId: o.branchId, actorUserId: ctx.auth.userId, before: { status: o.status }, after: { status: data.status } });
      return toOrderDetail(await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude }));
    });
  }

  // ───────────── Recepciones ─────────────

  listReceipts(ctx: RequestContext): Promise<GoodsReceiptSummary[]> {
    return ctx.run(async (tx) => {
      const ids = await this.branches(ctx, tx, "VIEW");
      const rows = await tx.goodsReceipt.findMany({ where: { branchId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 100, include: receiptInclude });
      return rows.map(toReceipt);
    });
  }

  /**
   * Registra una recepción (contra una orden o directa): cada línea crea su lote al costo pactado y deja un
   * movimiento de entrada. Todo ocurre en una sola transacción: si una línea falla, no se recibe nada.
   */
  async createReceipt(ctx: RequestContext, input: GoodsReceiptInput): Promise<GoodsReceiptSummary> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const actor = await this.inventory.actor(ctx);
      const id = uuidv7();
      let warehouseId = input.warehouseId!;
      let supplierId = input.supplierId!;
      let order: { id: string; status: PurchaseStatus; branchId: string } | null = null;
      const lineData = new Map<string, { id: string; productId: string; quantity: Prisma.Decimal; receivedQty: Prisma.Decimal; unitCost: Prisma.Decimal }>();

      if (input.orderId) {
        const o = await this.lockOrder(ctx, tx, input.orderId, "OPERATE");
        if (o.status !== "ISSUED" && o.status !== "PARTIALLY_RECEIVED") throw conflict("INVALID_STATE", "Solo se recibe contra una orden emitida o parcialmente recibida.");
        order = o;
        warehouseId = o.warehouseId;
        supplierId = o.supplierId;
        await tx.$queryRaw`SELECT id FROM purchase_order_line WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND order_id = ${o.id}::uuid ORDER BY id FOR UPDATE`;
        for (const l of await tx.purchaseOrderLine.findMany({ where: { orderId: o.id } })) lineData.set(l.id, { id: l.id, productId: l.productId, quantity: l.quantity, receivedQty: l.receivedQty, unitCost: l.unitCost });
      }
      const wh = await this.warehouseFor(ctx, tx, warehouseId, "OPERATE");
      if (!input.orderId) await this.assertSupplierActive(tx, supplierId);

      // Una misma línea de la orden no se repite dentro de la recepción.
      const seen = new Set<string>();
      const created: { orderLineId: string | null; productId: string; lotId: string; movementId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[] = [];
      for (const line of input.lines) {
        let productId = line.productId!;
        let unitCost = D(line.unitCost ?? 0);
        const qty = D(line.quantity);
        if (order) {
          const ol = lineData.get(line.orderLineId!);
          if (!ol) throw badRequest("ORDER_LINE_NOT_FOUND", "Una línea no pertenece a la orden.");
          if (seen.has(ol.id)) throw badRequest("DUPLICATE_LINE", "No repitas la misma línea de la orden en una recepción.");
          seen.add(ol.id);
          if (line.productId && line.productId !== ol.productId) throw badRequest("ORDER_LINE_MISMATCH", "El producto no corresponde a la línea de la orden.");
          const pending = ol.quantity.sub(ol.receivedQty);
          if (qty.gt(pending)) throw conflict("OVER_RECEIPT", `Se recibe más de lo pendiente (pendiente ${pending.toString()}, recibido ahora ${qty.toString()}).`);
          productId = ol.productId;
          unitCost = ol.unitCost;
        }
        const r = await this.engine.receive(tx, actor, {
          warehouseId: wh.id, productId, quantity: qty, unitCost, type: "RECEIPT", lot: line.lot,
          source: { type: "GOODS_RECEIPT", id, reasonCode: "PURCHASE", note: blank(input.supplierRef) ?? undefined },
        });
        created.push({ orderLineId: order ? line.orderLineId! : null, productId, lotId: r.lotId, movementId: r.movementId, quantity: qty, unitCost });
        if (order) await tx.purchaseOrderLine.update({ where: { id: line.orderLineId! }, data: { receivedQty: { increment: qty } } });
      }

      const code = await nextCode(tx, ctx.auth.tenantId, "GOODS_RECEIPT", "RC-");
      await tx.goodsReceipt.create({
        data: { id, tenantId: ctx.auth.tenantId, branchId: wh.branchId, warehouseId: wh.id, supplierId, orderId: order?.id ?? null, code, supplierRef: blank(input.supplierRef), note: blank(input.note), createdById: ctx.auth.userId },
      });
      for (const c of created) await tx.goodsReceiptLine.create({ data: { id: uuidv7(), tenantId: ctx.auth.tenantId, receiptId: id, orderLineId: c.orderLineId, productId: c.productId, lotId: c.lotId, movementId: c.movementId, quantity: c.quantity, unitCost: c.unitCost } });
      if (order) await this.refreshOrderStatus(tx, order.id);
      // La recepción genera la deuda con el proveedor, con vencimiento según su plazo de pago.
      const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { paymentTermsDays: true } });
      const payableTotal = created.reduce((s, c) => s.add(c.quantity.mul(c.unitCost)), D(0)).toDecimalPlaces(6);
      const currency = order ? (await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, select: { currency: true } })).currency : "BOB";
      await tx.payable.create({
        data: {
          id: uuidv7(), tenantId: ctx.auth.tenantId, supplierId, receiptId: id, currency, total: payableTotal, paidTotal: payableTotal.isZero() ? D(0) : D(0), // una deuda de importe cero nace pagada
          dueDate: new Date(new Date(`${actor.today}T00:00:00Z`).getTime() + supplier.paymentTermsDays * 86_400_000), status: payableTotal.isZero() ? "PAID" : "OPEN",
        },
      });
      await writeAudit(tx, ctx.auth.tenantId, { action: "goods_receipt.posted", entityType: "goods_receipt", entityId: id, branchId: wh.branchId, actorUserId: ctx.auth.userId, after: { code, order: order?.id ?? null, lines: created.length } });
      return toReceipt(await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: receiptInclude }));
    });
  }

  /**
   * Anula una recepción: revierte cada entrada (al costo original) y devuelve lo pendiente a la orden. Si parte de lo
   * recibido ya se vendió o transfirió, no se puede anular (se corrige con una devolución).
   */
  async voidReceipt(ctx: RequestContext, id: string, reason: string): Promise<GoodsReceiptSummary> {
    await ctx.tenantInfo(); // fuera de la transacción: evita pedir una 2.ª conexión del pool mientras se retiene la 1.ª
    return ctx.run(async (tx) => {
      const actor = await this.inventory.actor(ctx);
      const r = await tx.goodsReceipt.findUnique({ where: { id }, include: { lines: true } });
      if (!r) throw notFound("Recepción");
      await this.warehouseFor(ctx, tx, r.warehouseId, "OPERATE");
      // Bloqueo y verificación de estado bajo el mismo candado: dos anulaciones simultáneas no pasan ambas.
      await tx.$queryRaw`SELECT id FROM goods_receipt WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      if ((await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, select: { status: true } })).status === "VOIDED") throw conflict("ALREADY_VOIDED", "La recepción ya está anulada.");
      if (r.orderId) await this.lockOrder(ctx, tx, r.orderId, "OPERATE");
      // Una recepción con pagos aplicados no se anula: primero habría que recuperar ese dinero.
      const payable = await tx.payable.findFirst({ where: { receiptId: id } });
      if (payable && payable.paidTotal.gt(0)) throw conflict("HAS_PAYMENTS", "La recepción tiene pagos aplicados al proveedor: no se puede anular.");

      for (const l of r.lines) {
        await this.engine.reverse(tx, actor, l.movementId, `Anulación de recepción ${r.code}: ${reason}`);
        if (l.orderLineId) await tx.purchaseOrderLine.update({ where: { id: l.orderLineId }, data: { receivedQty: { decrement: l.quantity } } });
      }
      await tx.goodsReceipt.update({ where: { id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason } });
      if (payable) await tx.payable.update({ where: { id: payable.id }, data: { status: "VOID" } });
      if (r.orderId) await this.refreshOrderStatus(tx, r.orderId);
      await writeAudit(tx, ctx.auth.tenantId, { action: "goods_receipt.voided", entityType: "goods_receipt", entityId: id, branchId: r.branchId, actorUserId: ctx.auth.userId, after: { reason } });
      return toReceipt(await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: receiptInclude }));
    });
  }

  // ───────────── Internos ─────────────

  private async lockOrder(ctx: RequestContext, tx: Tx, id: string, minLevel: BranchAccessLevel) {
    await tx.$queryRaw`SELECT id FROM purchase_order WHERE tenant_id = ${ctx.auth.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const o = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, status: true, branchId: true, warehouseId: true, supplierId: true } });
    if (!o) throw notFound("Orden de compra");
    if (!(await this.branches(ctx, tx, minLevel)).includes(o.branchId)) throw notFound("Orden de compra");
    return o;
  }

  /** Estado según lo recibido: nada → emitida; algo → parcial; todo → recibida. Una orden cerrada o cancelada no cambia. */
  private async refreshOrderStatus(tx: Tx, orderId: string): Promise<void> {
    const o = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, lines: { select: { quantity: true, receivedQty: true } } } });
    if (o.status === "DRAFT" || o.status === "CANCELLED") return;
    const received = o.lines.reduce((s, l) => s.add(l.receivedQty), D(0));
    const complete = o.lines.every((l) => l.receivedQty.gte(l.quantity));
    const status: PurchaseStatus = complete ? "RECEIVED" : received.gt(0) ? "PARTIALLY_RECEIVED" : "ISSUED";
    if (status !== o.status) await tx.purchaseOrder.update({ where: { id: orderId }, data: { status } });
  }

  private async assertSupplier(tx: Tx, id: string) {
    if (!(await tx.supplier.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Proveedor");
  }
  private async assertSupplierActive(tx: Tx, id: string) {
    const s = await tx.supplier.findUnique({ where: { id }, select: { status: true } });
    if (!s) throw notFound("Proveedor");
    if (s.status !== "ACTIVE") throw conflict("SUPPLIER_INACTIVE", "El proveedor está inactivo.");
  }

  private async assertLines(tx: Tx, lines: { productId: string; quantity: number }[]) {
    const ids = [...new Set(lines.map((l) => l.productId))];
    if (ids.length !== lines.length) throw badRequest("DUPLICATE_PRODUCT", "Un producto no puede repetirse en la orden: suma las cantidades en una sola línea.");
    const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, kind: true, status: true, baseUnit: { select: { decimals: true } } } });
    if (products.length !== ids.length) throw notFound("Producto");
    for (const p of products) {
      if (p.kind !== "GOODS") throw badRequest("NOT_STOCKABLE", `${p.code} es un servicio: no se compra para inventario.`);
      if (p.status !== "ACTIVE") throw conflict("PRODUCT_INACTIVE", `${p.code} está inactivo.`);
      const q = lines.find((l) => l.productId === p.id)!.quantity;
      if (!D(q).toDecimalPlaces(p.baseUnit.decimals).eq(D(q))) throw badRequest("INVALID_QUANTITY", `${p.code} admite hasta ${p.baseUnit.decimals} decimales en su unidad base.`);
    }
  }

  private async writeLines(tx: Tx, tenantId: string, orderId: string, lines: { productId: string; quantity: number; unitCost: number }[]) {
    for (const l of lines) await tx.purchaseOrderLine.create({ data: { id: uuidv7(), tenantId, orderId, productId: l.productId, quantity: l.quantity, unitCost: l.unitCost } });
  }
}

const toBankAccount = (a: Prisma.SupplierBankAccountGetPayload<object>): BankAccountView => ({
  id: a.id, supplierId: a.supplierId, bankName: a.bankName, accountNumber: a.accountNumber, accountType: a.accountType as BankAccountView["accountType"], currency: a.currency,
  holderName: a.holderName, holderTaxId: a.holderTaxId, notes: a.notes, isDefault: a.isDefault, status: a.status, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(),
});

type SupplierRow = Prisma.SupplierGetPayload<{ include: { _count: { select: { orders: true } } } }>;
const toSupplier = (s: SupplierRow): SupplierSummary => ({
  id: s.id, code: s.code, name: s.name, taxId: s.taxId, contactName: s.contactName, contactRole: s.contactRole, email: s.email, phone: s.phone, address: s.address,
  paymentTermsDays: s.paymentTermsDays, status: s.status, orders: s._count.orders,
});

const toOrderSummary = (o: OrderRow): PurchaseOrderSummary => ({
  id: o.id, code: o.code, status: o.status, currency: o.currency, expectedOn: day(o.expectedOn), note: o.note, createdAt: o.createdAt.toISOString(),
  issuedAt: o.issuedAt?.toISOString() ?? null, supplier: o.supplier, warehouse: o.warehouse,
  total: o.lines.reduce((s, l) => s.add(l.quantity.mul(l.unitCost)), D(0)).toDecimalPlaces(6).toString(),
});
const toOrderDetail = (o: OrderRow): PurchaseOrderDetail => ({
  ...toOrderSummary(o),
  lines: o.lines.map((l) => ({
    id: l.id, productId: l.productId, productCode: l.product.code, productName: l.product.name, unit: l.product.baseUnit.code, trackLots: l.product.trackLots, trackExpiry: l.product.trackExpiry,
    quantity: l.quantity.toString(), unitCost: l.unitCost.toString(), receivedQty: l.receivedQty.toString(), pendingQty: l.quantity.sub(l.receivedQty).toString(),
  })),
  receipts: o.receipts.map((r) => ({ id: r.id, code: r.code, status: r.status, createdAt: r.createdAt.toISOString() })),
});
const toReceipt = (r: ReceiptRow): GoodsReceiptSummary => ({
  id: r.id, code: r.code, status: r.status, supplierRef: r.supplierRef, note: r.note, createdAt: r.createdAt.toISOString(), voidedAt: r.voidedAt?.toISOString() ?? null,
  voidReason: r.voidReason, supplier: r.supplier, warehouse: r.warehouse, order: r.order,
  total: r.lines.reduce((s, l) => s.add(l.quantity.mul(l.unitCost)), D(0)).toDecimalPlaces(6).toString(),
  lines: r.lines.map((l) => ({ productCode: l.product.code, productName: l.product.name, lotCode: l.lot.code, quantity: l.quantity.toString(), unitCost: l.unitCost.toString() })),
});
