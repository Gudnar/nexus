import { Inject, Injectable } from "@nestjs/common";
import { Prisma, nextSequenceNumber, uuidv7, type Tx } from "@erp/db";
import { Clock } from "../access/clock";
import { badRequest, conflict, notFound } from "../admin/actor";
import { exceedsDecimals, layersValue, planIssue, round, type Layer, type ValuationMethod } from "./costing";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
type Dec = Prisma.Decimal;
const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);

export interface StockActor {
  tenantId: string;
  userId?: string | null;
  correlationId?: string | null;
  /** Fecha local de hoy (AAAA-MM-DD) en la zona de la empresa: define vencimientos y vigencia de políticas. */
  today: string;
}

export interface StockSource {
  type?: string;
  id?: string;
  reasonCode?: string;
  note?: string;
  reversalOfId?: string;
}

export interface LotInput {
  code?: string;
  manufacturedOn?: string | null;
  expiresOn?: string | null;
  externalRef?: string | null;
  currency?: string;
}

export interface ReceiveParams {
  warehouseId: string;
  productId: string;
  quantity: Prisma.Decimal.Value;
  unitCost: Prisma.Decimal.Value;
  type?: "RECEIPT" | "ADJUSTMENT_IN" | "TRANSFER_IN";
  lot?: LotInput;
  /** Suma a un lote existente (transferencias y reversas) en lugar de crear uno nuevo. */
  existingLotId?: string;
  allowTransit?: boolean;
  source?: StockSource;
}

export interface IssueParams {
  warehouseId: string;
  productId: string;
  quantity: Prisma.Decimal.Value;
  type?: "ISSUE" | "ADJUSTMENT_OUT" | "TRANSFER_OUT";
  /** Lote concreto (selección manual). Sin él, se eligen lotes según la política de valoración. */
  lotId?: string;
  allowExpired?: boolean;
  allowBlocked?: boolean;
  allowTransit?: boolean;
  /** Costo unitario fijo (reversas: se conserva el costo original). */
  costOverride?: Prisma.Decimal.Value;
  source?: StockSource;
  /** Interno: ya se intentó liberar reservas vencidas. */
  retried?: boolean;
}

export interface IssuedPart { lotId: string; quantity: Dec; unitCost: Dec; totalCost: Dec; movementId: string }

interface ProductInfo { id: string; code: string; kind: string; status: string; trackLots: boolean; trackExpiry: boolean; decimals: number }
interface WarehouseInfo { id: string; branchId: string; status: string; kind: string }

/**
 * Motor de stock (plan §10, ADR-004). Único camino para mover inventario: el libro de movimientos
 * es la fuente de verdad; saldos y valoración son proyecciones que se actualizan en la MISMA transacción.
 *
 * Concurrencia: toda salida toma primero el bloqueo de la fila de valoración (almacén + producto) y luego
 * el de los saldos por lote en orden estable; así dos salidas sobre el mismo producto se serializan y
 * nunca hay interbloqueos ni stock negativo (además, la base lo impide con un CHECK).
 */
@Injectable()
export class StockEngine {
  constructor(@Inject(Clock) private readonly clock: Clock) {}

  // ───────────── Entradas ─────────────

  async receive(tx: Tx, actor: StockActor, p: ReceiveParams): Promise<{ lotId: string; movementId: string }> {
    const type = p.type ?? "RECEIPT";
    const [wh, product] = await Promise.all([this.warehouse(tx, p.warehouseId, p.allowTransit), this.product(tx, p.productId, true)]);
    const qty = this.quantity(p.quantity, product);
    const unitCost = D(p.unitCost);
    if (unitCost.lt(0)) throw badRequest("INVALID_COST", "El costo unitario no puede ser negativo.");

    let lotId = p.existingLotId;
    if (lotId) {
      const lot = await tx.lot.findUnique({ where: { id: lotId }, select: { productId: true } });
      if (!lot || lot.productId !== product.id) throw badRequest("LOT_MISMATCH", "El lote no corresponde a ese producto.");
    } else {
      lotId = await this.createLot(tx, actor, product, wh, qty, unitCost, p.lot ?? {}, p.source);
    }

    const totalCost = round(qty.mul(unitCost));
    await this.bumpBalance(tx, actor.tenantId, wh.id, product.id, lotId, qty);
    await this.bumpValuation(tx, actor.tenantId, wh.id, product.id, qty, totalCost);
    const movementId = await this.writeMovement(tx, actor, wh, product.id, lotId, type, qty, unitCost, totalCost, p.source);
    return { lotId, movementId };
  }

  // ───────────── Salidas ─────────────

  async issue(tx: Tx, actor: StockActor, p: IssueParams): Promise<IssuedPart[]> {
    const type = p.type ?? "ISSUE";
    const [wh, product] = await Promise.all([this.warehouse(tx, p.warehouseId, p.allowTransit), this.product(tx, p.productId, false)]);
    const qty = this.quantity(p.quantity, product);

    // 1) Bloqueos en orden estable: valoración y luego saldos por lote.
    const val = await tx.$queryRaw<{ quantity: Dec; total_value: Dec }[]>`
      SELECT quantity, total_value FROM inventory_valuation
       WHERE tenant_id = ${actor.tenantId}::uuid AND warehouse_id = ${wh.id}::uuid AND product_id = ${product.id}::uuid
       FOR UPDATE`;
    const rows = val.length
      ? await tx.$queryRaw<{ lot_id: string; physical_qty: Dec; reserved_qty: Dec; unit_cost: Dec; received_at: Date; status: string; expires_on: Date | null }[]>`
          SELECT b.lot_id, b.physical_qty, b.reserved_qty, l.unit_cost, l.received_at, l.status::text AS status, l.expires_on
            FROM stock_balance b JOIN lot l ON l.tenant_id = b.tenant_id AND l.id = b.lot_id
           WHERE b.tenant_id = ${actor.tenantId}::uuid AND b.warehouse_id = ${wh.id}::uuid AND b.product_id = ${product.id}::uuid
           ORDER BY b.lot_id
           FOR UPDATE OF b`
      : [];

    // 2) Capas elegibles.
    const today = dateOnly(actor.today);
    const eligible = rows.filter((r) => {
      if (p.lotId && r.lot_id !== p.lotId) return false;
      if (r.status === "BLOCKED" && !p.allowBlocked) return false;
      if (r.expires_on && r.expires_on < today && !p.allowExpired && !p.lotId) return false;
      return true;
    });
    const layers: Layer[] = eligible.map((r) => ({ lotId: r.lot_id, available: D(r.physical_qty).sub(D(r.reserved_qty)), unitCost: D(r.unit_cost), receivedAt: new Date(r.received_at) }));

    if (p.lotId) {
      const only = rows.find((r) => r.lot_id === p.lotId);
      if (only?.status === "BLOCKED" && !p.allowBlocked) throw conflict("LOT_BLOCKED", "El lote está bloqueado.");
      if (only?.expires_on && only.expires_on < today && !p.allowExpired && type === "ISSUE") throw conflict("LOT_EXPIRED", "El lote está vencido.");
    }

    // 3) Costeo.
    const method = await this.methodFor(tx, product.id, actor.today);
    const average = val[0] ? { quantity: D(val[0].quantity), value: D(val[0].total_value) } : undefined;
    const plan = planIssue(method, layers, qty, average);
    if (plan.shortfall.gt(0)) {
      // Puede que falte stock solo porque hay reservas vencidas sin liberar: se liberan y se reintenta una vez.
      if (!p.retried && (await this.expireDue(tx, actor.tenantId)) > 0) return this.issue(tx, actor, { ...p, retried: true });
      const have = layers.reduce((s, l) => s.add(l.available), D(0));
      throw conflict("INSUFFICIENT_STOCK", `Stock insuficiente de ${product.code}: disponible ${have.toString()}, solicitado ${qty.toString()}.`);
    }
    if (p.costOverride !== undefined) {
      for (const part of plan.parts) { part.unitCost = D(p.costOverride); part.totalCost = round(part.quantity.mul(part.unitCost)); }
    }

    // 4) Aplicación.
    const out: IssuedPart[] = [];
    let totalCost = D(0);
    for (const part of plan.parts) {
      await tx.$executeRaw`
        UPDATE stock_balance SET physical_qty = physical_qty - ${part.quantity.toString()}::numeric, version = version + 1, updated_at = (now() AT TIME ZONE 'UTC')
         WHERE tenant_id = ${actor.tenantId}::uuid AND warehouse_id = ${wh.id}::uuid AND product_id = ${product.id}::uuid AND lot_id = ${part.lotId}::uuid`;
      const movementId = await this.writeMovement(tx, actor, wh, product.id, part.lotId, type, part.quantity.neg(), part.unitCost, part.totalCost.neg(), p.source);
      out.push({ ...part, movementId });
      totalCost = totalCost.add(part.totalCost);
    }
    // El valor nunca baja de cero por redondeos.
    const value = average ? Prisma.Decimal.min(totalCost, average.value) : totalCost;
    await tx.$executeRaw`
      UPDATE inventory_valuation SET quantity = quantity - ${qty.toString()}::numeric, total_value = total_value - ${value.toString()}::numeric, updated_at = (now() AT TIME ZONE 'UTC')
       WHERE tenant_id = ${actor.tenantId}::uuid AND warehouse_id = ${wh.id}::uuid AND product_id = ${product.id}::uuid`;
    return out;
  }

  // ───────────── Reversas ─────────────

  /** Anula un movimiento con otro inverso, al costo original. No se borra nada (plan §10.3). */
  async reverse(tx: Tx, actor: StockActor, movementId: string, reason: string): Promise<{ movementId: string }> {
    const m = await tx.stockMovement.findUnique({ where: { id: movementId } });
    if (!m) throw notFound("Movimiento");
    if (m.type === "REVALUATION") throw badRequest("NOT_REVERSIBLE", "Una revaluación no se revierte.");
    if (m.type === "TRANSFER_IN" || m.type === "TRANSFER_OUT") throw badRequest("NOT_REVERSIBLE", "Los movimientos de una transferencia se corrigen desde la transferencia.");
    if (m.reversalOfId) throw badRequest("NOT_REVERSIBLE", "Un movimiento de reversa no se vuelve a revertir.");
    if (await tx.stockMovement.findFirst({ where: { reversalOfId: m.id }, select: { id: true } })) throw conflict("ALREADY_REVERSED", "Ese movimiento ya fue revertido.");

    const source: StockSource = { type: "REVERSAL", id: m.id, reasonCode: "REVERSAL", note: reason, reversalOfId: m.id };
    if (D(m.quantity).gt(0)) {
      const [part] = await this.issue(tx, actor, {
        warehouseId: m.warehouseId, productId: m.productId, quantity: D(m.quantity), lotId: m.lotId!, type: "ADJUSTMENT_OUT",
        allowExpired: true, allowBlocked: true, costOverride: m.unitCost, source,
      });
      return { movementId: part!.movementId };
    }
    const r = await this.receive(tx, actor, {
      warehouseId: m.warehouseId, productId: m.productId, quantity: D(m.quantity).neg(), unitCost: m.unitCost, type: "ADJUSTMENT_IN", existingLotId: m.lotId!, source,
    });
    return { movementId: r.movementId };
  }

  // ───────────── Reservas ─────────────

  /**
   * Aparta existencias por lote SIN sacarlas: sube `reserved_qty` del saldo (lo disponible baja, lo físico no). Elige lotes con el
   * mismo orden que una salida. Si no alcanza lo disponible, falla sin apartar nada. Devuelve el reparto por lote.
   */
  async reserve(tx: Tx, actor: StockActor, p: { warehouseId: string; productId: string; quantity: Prisma.Decimal.Value }): Promise<{ lotId: string; quantity: Dec }[]> {
    const [wh, product] = await Promise.all([this.warehouse(tx, p.warehouseId), this.product(tx, p.productId, true)]);
    const qty = this.quantity(p.quantity, product);
    await this.expireDue(tx, actor.tenantId);
    const val = await tx.$queryRaw<{ quantity: Dec }[]>`
      SELECT quantity FROM inventory_valuation
       WHERE tenant_id = ${actor.tenantId}::uuid AND warehouse_id = ${wh.id}::uuid AND product_id = ${product.id}::uuid FOR UPDATE`;
    const rows = val.length
      ? await tx.$queryRaw<{ lot_id: string; physical_qty: Dec; reserved_qty: Dec; unit_cost: Dec; received_at: Date; status: string; expires_on: Date | null }[]>`
          SELECT b.lot_id, b.physical_qty, b.reserved_qty, l.unit_cost, l.received_at, l.status::text AS status, l.expires_on
            FROM stock_balance b JOIN lot l ON l.tenant_id = b.tenant_id AND l.id = b.lot_id
           WHERE b.tenant_id = ${actor.tenantId}::uuid AND b.warehouse_id = ${wh.id}::uuid AND b.product_id = ${product.id}::uuid
           ORDER BY b.lot_id FOR UPDATE OF b`
      : [];
    const today = dateOnly(actor.today);
    const layers: Layer[] = rows
      .filter((r) => r.status !== "BLOCKED" && !(r.expires_on && r.expires_on < today))
      .map((r) => ({ lotId: r.lot_id, available: D(r.physical_qty).sub(D(r.reserved_qty)), unitCost: D(r.unit_cost), receivedAt: new Date(r.received_at) }));
    const plan = planIssue(await this.methodFor(tx, product.id, actor.today), layers, qty);
    if (plan.shortfall.gt(0)) {
      const have = layers.reduce((s, l) => s.add(l.available.gt(0) ? l.available : D(0)), D(0));
      throw conflict("INSUFFICIENT_STOCK", `Stock disponible insuficiente de ${product.code} para reservar: disponible ${have.toString()}, solicitado ${qty.toString()}.`);
    }
    for (const part of plan.parts) {
      await tx.$executeRaw`
        UPDATE stock_balance SET reserved_qty = reserved_qty + ${part.quantity.toString()}::numeric, version = version + 1, updated_at = (now() AT TIME ZONE 'UTC')
         WHERE tenant_id = ${actor.tenantId}::uuid AND warehouse_id = ${wh.id}::uuid AND product_id = ${product.id}::uuid AND lot_id = ${part.lotId}::uuid`;
    }
    return plan.parts.map((x) => ({ lotId: x.lotId, quantity: x.quantity }));
  }

  /** Devuelve a lo disponible lo apartado por unas líneas de reserva (liberación, consumo o vencimiento). */
  async unreserve(tx: Tx, tenantId: string, lines: { warehouseId: string; productId: string; lotId: string; quantity: Prisma.Decimal.Value }[]): Promise<void> {
    const sorted = [...lines].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || a.productId.localeCompare(b.productId) || a.lotId.localeCompare(b.lotId));
    for (const l of sorted) {
      await tx.$executeRaw`
        UPDATE stock_balance SET reserved_qty = GREATEST(reserved_qty - ${D(l.quantity).toString()}::numeric, 0), version = version + 1, updated_at = (now() AT TIME ZONE 'UTC')
         WHERE tenant_id = ${tenantId}::uuid AND warehouse_id = ${l.warehouseId}::uuid AND product_id = ${l.productId}::uuid AND lot_id = ${l.lotId}::uuid`;
    }
  }

  /** Cierra las reservas activas cuya vigencia ya pasó y libera lo que apartaban. Devuelve cuántas cerró. */
  async expireDue(tx: Tx, tenantId: string): Promise<number> {
    const now = this.clock.now();
    const due = await tx.$queryRaw<{ id: string; warehouse_id: string }[]>`
      SELECT id, warehouse_id FROM stock_reservation
       WHERE tenant_id = ${tenantId}::uuid AND status = 'ACTIVE' AND expires_at < ${now.toISOString()}::timestamp -- las fechas se guardan en UTC sin zona
       ORDER BY id FOR UPDATE SKIP LOCKED`;
    if (due.length === 0) return 0;
    const lines = await tx.stockReservationLine.findMany({ where: { reservationId: { in: due.map((d) => d.id) } } });
    const wh = new Map(due.map((d) => [d.id, d.warehouse_id]));
    await this.unreserve(tx, tenantId, lines.map((l) => ({ warehouseId: wh.get(l.reservationId)!, productId: l.productId, lotId: l.lotId, quantity: l.quantity })));
    await tx.stockReservation.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { status: "EXPIRED", closedAt: now } });
    return due.length;
  }

  // ───────────── Bloqueos y tránsito ─────────────

  /**
   * Bloquea de una vez las filas de valoración de varios almacenes y productos, en orden estable. Las operaciones que
   * tocan dos almacenes (transferencias) lo llaman primero: así dos transferencias cruzadas nunca se interbloquean.
   */
  async lockValuations(tx: Tx, tenantId: string, warehouseIds: string[], productIds: string[]): Promise<void> {
    const w = [...new Set(warehouseIds)].sort();
    const p = [...new Set(productIds)].sort();
    await tx.$queryRaw`
      SELECT id FROM inventory_valuation
       WHERE tenant_id = ${tenantId}::uuid AND warehouse_id = ANY(${w}::uuid[]) AND product_id = ANY(${p}::uuid[])
       ORDER BY warehouse_id, product_id
       FOR UPDATE`;
  }

  /** Almacén lógico de tránsito de la empresa (uno solo, ADR-004 punto 10). Se crea la primera vez, en la sucursal principal. */
  async ensureTransit(tx: Tx, tenantId: string): Promise<string> {
    const found = await tx.warehouse.findFirst({ where: { kind: "TRANSIT" }, select: { id: true } });
    if (found) return found.id;
    const branch = (await tx.branch.findFirst({ where: { isMain: true }, select: { id: true } })) ?? (await tx.branch.findFirst({ select: { id: true } }));
    if (!branch) throw conflict("NO_BRANCH", "La empresa no tiene sucursales.");
    const id = uuidv7();
    try {
      await tx.$executeRaw`SAVEPOINT transit_create`;
      await tx.warehouse.create({ data: { id, tenantId, branchId: branch.id, code: "_TRANSITO", name: "En tránsito", kind: "TRANSIT" } });
      await tx.$executeRaw`RELEASE SAVEPOINT transit_create`;
      return id;
    } catch (e) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT transit_create`;
      if ((e as { code?: string })?.code === "P2002") return (await tx.warehouse.findFirstOrThrow({ where: { kind: "TRANSIT" }, select: { id: true } })).id;
      throw e;
    }
  }

  // ───────────── Valoración ─────────────

  async methodFor(tx: Tx, productId: string | null, today: string): Promise<ValuationMethod> {
    const asOf = dateOnly(today);
    const own = productId ? await tx.valuationPolicy.findFirst({ where: { productId, effectiveFrom: { lte: asOf } }, orderBy: { effectiveFrom: "desc" }, select: { method: true } }) : null;
    if (own) return own.method;
    const def = await tx.valuationPolicy.findFirst({ where: { productId: null, effectiveFrom: { lte: asOf } }, orderBy: { effectiveFrom: "desc" }, select: { method: true } });
    return def?.method ?? "FIFO";
  }

  /**
   * Cambia el método (por producto o por defecto de la empresa) desde hoy. No reescribe historia: si el nuevo
   * método usa capas (FIFO/LIFO), el valor del inventario se alinea con el costo de los lotes mediante un
   * movimiento de REVALUACIÓN por almacén y producto. Devuelve cuántas revaluaciones generó.
   */
  async setPolicy(tx: Tx, actor: StockActor, input: { productId?: string | null; method: ValuationMethod }): Promise<{ revaluations: number }> {
    const productId = input.productId ?? null;
    if (productId && !(await tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw notFound("Producto");
    try {
      await tx.valuationPolicy.create({ data: { id: uuidv7(), tenantId: actor.tenantId, productId, method: input.method, effectiveFrom: dateOnly(actor.today), createdById: actor.userId ?? null } });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") throw conflict("POLICY_TODAY", "Ya se cambió el método hoy. Inténtalo mañana: la política rige desde una fecha y no se reescribe.");
      throw e;
    }
    if (input.method === "AVERAGE") return { revaluations: 0 };

    // Productos cuyo método efectivo pasa a ser este: el indicado, o los que no tienen política propia.
    const valuations = await tx.inventoryValuation.findMany({ where: productId ? { productId } : {}, select: { warehouseId: true, productId: true } });
    const own = productId ? new Set<string>() : new Set((await tx.valuationPolicy.findMany({ where: { productId: { not: null }, effectiveFrom: { lte: dateOnly(actor.today) } }, select: { productId: true } })).map((x) => x.productId!));
    let revaluations = 0;
    for (const v of valuations) {
      if (own.has(v.productId)) continue;
      if (await this.revalueToLayers(tx, actor, v.warehouseId, v.productId, `Cambio de método a ${input.method}`)) revaluations++;
    }
    return { revaluations };
  }

  private async revalueToLayers(tx: Tx, actor: StockActor, warehouseId: string, productId: string, note: string): Promise<boolean> {
    const val = await tx.$queryRaw<{ total_value: Dec }[]>`
      SELECT total_value FROM inventory_valuation WHERE tenant_id = ${actor.tenantId}::uuid AND warehouse_id = ${warehouseId}::uuid AND product_id = ${productId}::uuid FOR UPDATE`;
    if (!val[0]) return false;
    const rows = await tx.$queryRaw<{ physical_qty: Dec; unit_cost: Dec }[]>`
      SELECT b.physical_qty, l.unit_cost FROM stock_balance b JOIN lot l ON l.tenant_id = b.tenant_id AND l.id = b.lot_id
       WHERE b.tenant_id = ${actor.tenantId}::uuid AND b.warehouse_id = ${warehouseId}::uuid AND b.product_id = ${productId}::uuid AND b.physical_qty > 0`;
    const target = layersValue(rows.map((r) => ({ lotId: "", available: D(r.physical_qty), unitCost: D(r.unit_cost), receivedAt: new Date(0) })));
    const diff = round(target.sub(D(val[0].total_value)));
    if (diff.isZero()) return false;
    const wh = await this.warehouse(tx, warehouseId, true);
    await tx.$executeRaw`
      UPDATE inventory_valuation SET total_value = ${target.toString()}::numeric, updated_at = (now() AT TIME ZONE 'UTC')
       WHERE tenant_id = ${actor.tenantId}::uuid AND warehouse_id = ${warehouseId}::uuid AND product_id = ${productId}::uuid`;
    await this.writeMovement(tx, actor, wh, productId, null, "REVALUATION", D(0), D(0), diff, { reasonCode: "REVALUATION", note });
    return true;
  }

  // ───────────── Conciliación (ADR-004, punto 13) ─────────────

  async reconcile(tx: Tx): Promise<{ balances: { warehouseId: string; productId: string; lotId: string; balance: string; ledger: string }[]; valuations: { warehouseId: string; productId: string; quantity: string; ledgerQuantity: string; value: string; ledgerValue: string }[] }> {
    const balances = await tx.$queryRaw<{ warehouse_id: string; product_id: string; lot_id: string; bal: Dec; led: Dec }[]>`
      SELECT COALESCE(b.warehouse_id, m.warehouse_id) AS warehouse_id, COALESCE(b.product_id, m.product_id) AS product_id, COALESCE(b.lot_id, m.lot_id) AS lot_id,
             COALESCE(b.physical_qty, 0) AS bal, COALESCE(m.q, 0) AS led
        FROM stock_balance b
        FULL JOIN (SELECT warehouse_id, product_id, lot_id, SUM(quantity) AS q FROM stock_movement WHERE lot_id IS NOT NULL GROUP BY 1, 2, 3) m
          ON m.warehouse_id = b.warehouse_id AND m.product_id = b.product_id AND m.lot_id = b.lot_id
       WHERE COALESCE(b.physical_qty, 0) <> COALESCE(m.q, 0)`;
    const valuations = await tx.$queryRaw<{ warehouse_id: string; product_id: string; qty: Dec; lq: Dec; val: Dec; lv: Dec }[]>`
      SELECT COALESCE(v.warehouse_id, m.warehouse_id) AS warehouse_id, COALESCE(v.product_id, m.product_id) AS product_id,
             COALESCE(v.quantity, 0) AS qty, COALESCE(m.q, 0) AS lq, COALESCE(v.total_value, 0) AS val, COALESCE(m.c, 0) AS lv
        FROM inventory_valuation v
        FULL JOIN (SELECT warehouse_id, product_id, SUM(quantity) AS q, SUM(total_cost) AS c FROM stock_movement GROUP BY 1, 2) m
          ON m.warehouse_id = v.warehouse_id AND m.product_id = v.product_id
       WHERE COALESCE(v.quantity, 0) <> COALESCE(m.q, 0) OR ABS(COALESCE(v.total_value, 0) - COALESCE(m.c, 0)) > 0.000001`;
    return {
      balances: balances.map((r) => ({ warehouseId: r.warehouse_id, productId: r.product_id, lotId: r.lot_id, balance: D(r.bal).toString(), ledger: D(r.led).toString() })),
      valuations: valuations.map((r) => ({ warehouseId: r.warehouse_id, productId: r.product_id, quantity: D(r.qty).toString(), ledgerQuantity: D(r.lq).toString(), value: D(r.val).toString(), ledgerValue: D(r.lv).toString() })),
    };
  }

  // ───────────── Internos ─────────────

  private async warehouse(tx: Tx, id: string, allowTransit = false): Promise<WarehouseInfo> {
    const w = await tx.warehouse.findUnique({ where: { id }, select: { id: true, branchId: true, status: true, kind: true } });
    if (!w) throw notFound("Almacén");
    if (w.status !== "ACTIVE") throw conflict("WAREHOUSE_INACTIVE", "El almacén está inactivo.");
    if (w.kind === "TRANSIT" && !allowTransit) throw badRequest("WAREHOUSE_TRANSIT", "El almacén de tránsito solo se mueve con transferencias.");
    return w;
  }

  private async product(tx: Tx, id: string, mustBeActive: boolean): Promise<ProductInfo> {
    const p = await tx.product.findUnique({ where: { id }, select: { id: true, code: true, kind: true, status: true, trackLots: true, trackExpiry: true, baseUnit: { select: { decimals: true } } } });
    if (!p) throw notFound("Producto");
    if (p.kind !== "GOODS") throw badRequest("NOT_STOCKABLE", `${p.code} es un servicio: no maneja inventario.`);
    if (mustBeActive && p.status !== "ACTIVE") throw conflict("PRODUCT_INACTIVE", `${p.code} está inactivo.`);
    return { id: p.id, code: p.code, kind: p.kind, status: p.status, trackLots: p.trackLots, trackExpiry: p.trackExpiry, decimals: p.baseUnit.decimals };
  }

  private quantity(v: Prisma.Decimal.Value, product: ProductInfo): Dec {
    const q = D(v);
    if (!q.gt(0)) throw badRequest("INVALID_QUANTITY", "La cantidad debe ser mayor que cero.");
    if (exceedsDecimals(q, product.decimals)) throw badRequest("INVALID_QUANTITY", `${product.code} admite hasta ${product.decimals} decimales en su unidad base.`);
    return q;
  }

  private async createLot(tx: Tx, actor: StockActor, product: ProductInfo, wh: WarehouseInfo, qty: Dec, unitCost: Dec, lot: LotInput, source?: StockSource): Promise<string> {
    if (lot.code && !product.trackLots) throw badRequest("LOT_NOT_TRACKED", `${product.code} no controla lotes.`);
    if (lot.expiresOn && !product.trackExpiry) throw badRequest("EXPIRY_NOT_TRACKED", `${product.code} no controla vencimiento.`);
    if (product.trackExpiry && !lot.expiresOn) throw badRequest("EXPIRY_REQUIRED", `${product.code} exige fecha de vencimiento.`);
    if (lot.manufacturedOn && lot.expiresOn && lot.expiresOn < lot.manufacturedOn) throw badRequest("INVALID_DATES", "El vencimiento no puede ser anterior a la fabricación.");

    const id = uuidv7();
    const code = lot.code?.trim() || (await this.nextLotCode(tx, actor.tenantId, product.id));
    try {
      await tx.lot.create({
        data: {
          id, tenantId: actor.tenantId, productId: product.id, code, receivedWarehouseId: wh.id, initialQty: qty, unitCost,
          currency: lot.currency ?? "BOB", manufacturedOn: lot.manufacturedOn ? dateOnly(lot.manufacturedOn) : null,
          expiresOn: lot.expiresOn ? dateOnly(lot.expiresOn) : null, externalRef: lot.externalRef ?? null,
          sourceType: source?.type ?? null, sourceId: source?.id ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") throw conflict("LOT_CODE_TAKEN", `Ya existe el lote ${code} de ese producto.`);
      throw e;
    }
    return id;
  }

  private async nextLotCode(tx: Tx, tenantId: string, productId: string): Promise<string> {
    if (!(await tx.sequence.findFirst({ where: { documentType: "LOT", branchId: null }, select: { id: true } }))) {
      await tx.sequence.create({ data: { id: uuidv7(), tenantId, branchId: null, documentType: "LOT", prefix: "L-", padding: 6 } });
    }
    for (let i = 0; i < 20; i++) {
      const { formatted } = await nextSequenceNumber(tx, "LOT");
      if (!(await tx.lot.findUnique({ where: { tenantId_productId_code: { tenantId, productId, code: formatted } }, select: { id: true } }))) return formatted;
    }
    throw conflict("LOT_CODE_GENERATION", "No se pudo generar un código de lote libre.");
  }

  private async bumpBalance(tx: Tx, tenantId: string, warehouseId: string, productId: string, lotId: string, qty: Dec): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO stock_balance (id, tenant_id, warehouse_id, product_id, lot_id, physical_qty, reserved_qty, version, updated_at)
      VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${warehouseId}::uuid, ${productId}::uuid, ${lotId}::uuid, ${qty.toString()}::numeric, 0, 0, (now() AT TIME ZONE 'UTC'))
      ON CONFLICT (tenant_id, warehouse_id, product_id, lot_id)
      DO UPDATE SET physical_qty = stock_balance.physical_qty + EXCLUDED.physical_qty, version = stock_balance.version + 1, updated_at = (now() AT TIME ZONE 'UTC')`;
  }

  private async bumpValuation(tx: Tx, tenantId: string, warehouseId: string, productId: string, qty: Dec, value: Dec): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO inventory_valuation (id, tenant_id, warehouse_id, product_id, quantity, total_value, updated_at)
      VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${warehouseId}::uuid, ${productId}::uuid, ${qty.toString()}::numeric, ${value.toString()}::numeric, (now() AT TIME ZONE 'UTC'))
      ON CONFLICT (tenant_id, warehouse_id, product_id)
      DO UPDATE SET quantity = inventory_valuation.quantity + EXCLUDED.quantity, total_value = inventory_valuation.total_value + EXCLUDED.total_value, updated_at = (now() AT TIME ZONE 'UTC')`;
  }

  private async writeMovement(
    tx: Tx, actor: StockActor, wh: WarehouseInfo, productId: string, lotId: string | null,
    type: "RECEIPT" | "ISSUE" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "TRANSFER_OUT" | "TRANSFER_IN" | "REVALUATION",
    quantity: Dec, unitCost: Dec, totalCost: Dec, source?: StockSource,
  ): Promise<string> {
    const id = uuidv7();
    await tx.stockMovement.create({
      data: {
        id, tenantId: actor.tenantId, branchId: wh.branchId, warehouseId: wh.id, productId, lotId, type, quantity, unitCost, totalCost,
        reasonCode: source?.reasonCode ?? null, note: source?.note ?? null, sourceType: source?.type ?? null, sourceId: source?.id ?? null,
        reversalOfId: source?.reversalOfId ?? null, actorId: actor.userId ?? null, correlationId: actor.correlationId ?? null,
      },
    });
    return id;
  }
}
