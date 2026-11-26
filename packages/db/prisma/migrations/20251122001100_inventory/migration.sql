-- CreateEnum
CREATE TYPE "WarehouseKind" AS ENUM ('STORAGE', 'TRANSIT');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVALUATION');

-- CreateEnum
CREATE TYPE "ValuationMethod" AS ENUM ('FIFO', 'LIFO', 'AVERAGE');

-- CreateTable
CREATE TABLE "warehouse" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WarehouseKind" NOT NULL DEFAULT 'STORAGE',
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "received_warehouse_id" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initial_qty" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "manufactured_on" DATE,
    "expires_on" DATE,
    "external_ref" TEXT,
    "source_type" TEXT,
    "source_id" UUID,
    "status" "LotStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID,
    "seq" BIGSERIAL NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "total_cost" DECIMAL(18,6) NOT NULL,
    "reason_code" TEXT,
    "note" TEXT,
    "source_type" TEXT,
    "source_id" UUID,
    "reversal_of_id" UUID,
    "actor_id" UUID,
    "correlation_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balance" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "physical_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "reserved_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_valuation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total_value" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_valuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID,
    "method" "ValuationMethod" NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "valuation_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "stock_adjustment_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_tenant_id_id_key" ON "warehouse"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_tenant_id_code_key" ON "warehouse"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "lot_tenant_id_product_id_received_at_idx" ON "lot"("tenant_id", "product_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "lot_tenant_id_id_key" ON "lot"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_tenant_id_product_id_code_key" ON "lot"("tenant_id", "product_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_seq_key" ON "stock_movement"("seq");

-- CreateIndex
CREATE INDEX "stock_movement_tenant_id_product_id_warehouse_id_seq_idx" ON "stock_movement"("tenant_id", "product_id", "warehouse_id", "seq");

-- CreateIndex
CREATE INDEX "stock_movement_tenant_id_occurred_at_idx" ON "stock_movement"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movement_tenant_id_lot_id_idx" ON "stock_movement"("tenant_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_tenant_id_id_key" ON "stock_movement"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "stock_balance_tenant_id_product_id_idx" ON "stock_balance"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balance_tenant_id_id_key" ON "stock_balance"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balance_tenant_id_warehouse_id_product_id_lot_id_key" ON "stock_balance"("tenant_id", "warehouse_id", "product_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_valuation_tenant_id_id_key" ON "inventory_valuation"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_valuation_tenant_id_warehouse_id_product_id_key" ON "inventory_valuation"("tenant_id", "warehouse_id", "product_id");

-- CreateIndex
CREATE INDEX "valuation_policy_tenant_id_product_id_effective_from_idx" ON "valuation_policy"("tenant_id", "product_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "valuation_policy_tenant_id_id_key" ON "valuation_policy"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_tenant_id_id_key" ON "stock_adjustment"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_tenant_id_code_key" ON "stock_adjustment"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_line_tenant_id_id_key" ON "stock_adjustment_line"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse" ADD CONSTRAINT "warehouse_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_tenant_id_received_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "received_warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_tenant_id_lot_id_fkey" FOREIGN KEY ("tenant_id", "lot_id") REFERENCES "lot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_tenant_id_lot_id_fkey" FOREIGN KEY ("tenant_id", "lot_id") REFERENCES "lot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation" ADD CONSTRAINT "inventory_valuation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation" ADD CONSTRAINT "inventory_valuation_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuation" ADD CONSTRAINT "inventory_valuation_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_policy" ADD CONSTRAINT "valuation_policy_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_policy" ADD CONSTRAINT "valuation_policy_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment" ADD CONSTRAINT "stock_adjustment_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_line" ADD CONSTRAINT "stock_adjustment_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_line" ADD CONSTRAINT "stock_adjustment_line_tenant_id_adjustment_id_fkey" FOREIGN KEY ("tenant_id", "adjustment_id") REFERENCES "stock_adjustment"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_line" ADD CONSTRAINT "stock_adjustment_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_line" ADD CONSTRAINT "stock_adjustment_line_tenant_id_lot_id_fkey" FOREIGN KEY ("tenant_id", "lot_id") REFERENCES "lot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad del inventario ────────────────────────────────────────
ALTER TABLE warehouse ADD CONSTRAINT warehouse_code_format CHECK (code ~ '^[A-Za-z0-9._-]{1,32}$');
ALTER TABLE lot ADD CONSTRAINT lot_initial_qty_positive CHECK (initial_qty > 0);
ALTER TABLE lot ADD CONSTRAINT lot_cost_nonnegative CHECK (unit_cost >= 0);
ALTER TABLE lot ADD CONSTRAINT lot_dates CHECK (expires_on IS NULL OR manufactured_on IS NULL OR expires_on >= manufactured_on);
ALTER TABLE lot ADD CONSTRAINT lot_currency CHECK (currency ~ '^[A-Z]{3}$');
-- Sin stock negativo (ADR-004, punto 8): la base lo garantiza aunque el código falle.
ALTER TABLE stock_balance ADD CONSTRAINT stock_balance_nonnegative CHECK (physical_qty >= 0 AND reserved_qty >= 0 AND reserved_qty <= physical_qty);
ALTER TABLE inventory_valuation ADD CONSTRAINT inventory_valuation_nonnegative CHECK (quantity >= 0 AND total_value >= 0);
-- Entradas con cantidad positiva, salidas negativas; solo la revaluación puede no tener lote ni cantidad.
ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_sign CHECK (
  (type IN ('RECEIPT', 'ADJUSTMENT_IN', 'TRANSFER_IN') AND quantity > 0)
  OR (type IN ('ISSUE', 'ADJUSTMENT_OUT', 'TRANSFER_OUT') AND quantity < 0)
  OR (type = 'REVALUATION' AND quantity = 0)
);
ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_lot_required CHECK ((type = 'REVALUATION') = (lot_id IS NULL));
ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_cost_sign CHECK (
  type = 'REVALUATION' OR (unit_cost >= 0 AND ((quantity > 0 AND total_cost >= 0) OR (quantity < 0 AND total_cost <= 0)))
);
-- Un solo valor por defecto de la empresa por fecha de vigencia, y uno por producto y fecha.
CREATE UNIQUE INDEX valuation_policy_default_unique ON valuation_policy (tenant_id, effective_from) WHERE product_id IS NULL;
CREATE UNIQUE INDEX valuation_policy_product_unique ON valuation_policy (tenant_id, product_id, effective_from) WHERE product_id IS NOT NULL;

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouse', 'lot', 'stock_movement', 'stock_balance', 'inventory_valuation',
    'valuation_policy', 'stock_adjustment', 'stock_adjustment_line'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $p$, t);
    EXECUTE format($p$
      CREATE TRIGGER %I BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION forbid_tenant_change()
    $p$, t || '_tenant_immutable', t);
  END LOOP;
END $$;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['erp_app', 'erp_platform'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON warehouse, lot, stock_balance, inventory_valuation, stock_adjustment, stock_adjustment_line TO %I', r);
      -- Solo se escribe hacia adelante: el libro, las políticas y los documentos de ajuste no se modifican ni se borran.
      EXECUTE format('GRANT SELECT, INSERT ON stock_movement, valuation_policy TO %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON stock_movement, valuation_policy FROM %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON stock_adjustment, stock_adjustment_line FROM %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON lot, warehouse FROM %I', r);
    END IF;
  END LOOP;
END $$;
