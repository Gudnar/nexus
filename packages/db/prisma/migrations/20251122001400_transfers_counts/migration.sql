-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPLIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "stock_transfer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "created_by_id" UUID,
    "dispatched_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "stock_transfer_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "received_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "stock_transfer_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "created_by_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "applied_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "expected_qty" DECIMAL(18,6) NOT NULL,
    "counted_qty" DECIMAL(18,6),
    "unit_cost" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "inventory_count_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfer_tenant_id_status_created_at_idx" ON "stock_transfer"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_tenant_id_id_key" ON "stock_transfer"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_tenant_id_code_key" ON "stock_transfer"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_line_tenant_id_id_key" ON "stock_transfer_line"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_line_tenant_id_transfer_id_product_id_key" ON "stock_transfer_line"("tenant_id", "transfer_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_allocation_tenant_id_id_key" ON "stock_transfer_allocation"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "inventory_count_tenant_id_status_created_at_idx" ON "inventory_count"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_tenant_id_id_key" ON "inventory_count"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_tenant_id_code_key" ON "inventory_count"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_line_tenant_id_id_key" ON "inventory_count_line"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_line_tenant_id_count_id_lot_id_key" ON "inventory_count_line"("tenant_id", "count_id", "lot_id");

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_tenant_id_from_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "from_warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_tenant_id_to_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "to_warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "stock_transfer"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_allocation" ADD CONSTRAINT "stock_transfer_allocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_allocation" ADD CONSTRAINT "stock_transfer_allocation_tenant_id_transfer_id_fkey" FOREIGN KEY ("tenant_id", "transfer_id") REFERENCES "stock_transfer"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_allocation" ADD CONSTRAINT "stock_transfer_allocation_tenant_id_line_id_fkey" FOREIGN KEY ("tenant_id", "line_id") REFERENCES "stock_transfer_line"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_allocation" ADD CONSTRAINT "stock_transfer_allocation_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_allocation" ADD CONSTRAINT "stock_transfer_allocation_tenant_id_lot_id_fkey" FOREIGN KEY ("tenant_id", "lot_id") REFERENCES "lot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count" ADD CONSTRAINT "inventory_count_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count" ADD CONSTRAINT "inventory_count_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_line" ADD CONSTRAINT "inventory_count_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_line" ADD CONSTRAINT "inventory_count_line_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "inventory_count"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_line" ADD CONSTRAINT "inventory_count_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_line" ADD CONSTRAINT "inventory_count_line_tenant_id_lot_id_fkey" FOREIGN KEY ("tenant_id", "lot_id") REFERENCES "lot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad de transferencias y conteos ───────────────────────────
ALTER TABLE stock_transfer ADD CONSTRAINT stock_transfer_distinct CHECK (from_warehouse_id <> to_warehouse_id);
ALTER TABLE stock_transfer_line ADD CONSTRAINT stock_transfer_line_qty CHECK (quantity > 0);
-- Lo recibido nunca supera lo despachado (lo que falte se da de baja como pérdida en tránsito).
ALTER TABLE stock_transfer_allocation ADD CONSTRAINT stock_transfer_alloc_qty CHECK (quantity > 0 AND received_qty >= 0 AND received_qty <= quantity AND unit_cost >= 0);
ALTER TABLE inventory_count_line ADD CONSTRAINT inventory_count_line_qty CHECK (expected_qty >= 0 AND (counted_qty IS NULL OR counted_qty >= 0) AND unit_cost >= 0);
-- A lo sumo un almacén de tránsito lógico por empresa (ADR-004, punto 10).
CREATE UNIQUE INDEX warehouse_one_transit_per_tenant ON warehouse (tenant_id) WHERE kind = 'TRANSIT';

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_transfer', 'stock_transfer_line', 'stock_transfer_allocation', 'inventory_count', 'inventory_count_line'] LOOP
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
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON stock_transfer, stock_transfer_line, stock_transfer_allocation, inventory_count, inventory_count_line TO %I', r);
      -- Los documentos no se borran: se cancelan o se aplican (trazabilidad).
      EXECUTE format('REVOKE DELETE, TRUNCATE ON stock_transfer, stock_transfer_allocation, inventory_count FROM %I', r);
    END IF;
  END LOOP;
END $$;
