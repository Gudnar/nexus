-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "expected_on" DATE,
    "note" TEXT,
    "created_by_id" UUID,
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "received_qty" DECIMAL(18,6) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "order_id" UUID,
    "code" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'POSTED',
    "supplier_ref" TEXT,
    "note" TEXT,
    "created_by_id" UUID,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "order_line_id" UUID,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "goods_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_tenant_id_name_idx" ON "supplier"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_tenant_id_id_key" ON "supplier"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_tenant_id_code_key" ON "supplier"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "purchase_order_tenant_id_status_created_at_idx" ON "purchase_order"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_tenant_id_id_key" ON "purchase_order"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_tenant_id_code_key" ON "purchase_order"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_line_tenant_id_id_key" ON "purchase_order_line"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_line_tenant_id_order_id_product_id_key" ON "purchase_order_line"("tenant_id", "order_id", "product_id");

-- CreateIndex
CREATE INDEX "goods_receipt_tenant_id_created_at_idx" ON "goods_receipt"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_tenant_id_id_key" ON "goods_receipt"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_tenant_id_code_key" ON "goods_receipt"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_line_tenant_id_id_key" ON "goods_receipt_line"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "purchase_order"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line" ADD CONSTRAINT "purchase_order_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "purchase_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tenant_id_receipt_id_fkey" FOREIGN KEY ("tenant_id", "receipt_id") REFERENCES "goods_receipt"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tenant_id_order_line_id_fkey" FOREIGN KEY ("tenant_id", "order_line_id") REFERENCES "purchase_order_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_tenant_id_lot_id_fkey" FOREIGN KEY ("tenant_id", "lot_id") REFERENCES "lot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad de compras ────────────────────────────────────────────
ALTER TABLE supplier ADD CONSTRAINT supplier_code_format CHECK (code ~ '^[A-Za-z0-9._-]{1,32}$');
ALTER TABLE supplier ADD CONSTRAINT supplier_terms CHECK (payment_terms_days BETWEEN 0 AND 365);
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE purchase_order_line ADD CONSTRAINT po_line_quantity CHECK (quantity > 0 AND unit_cost >= 0);
-- Nunca se recibe más de lo pedido ni cantidades negativas (la base lo garantiza aunque falle el código).
ALTER TABLE purchase_order_line ADD CONSTRAINT po_line_received CHECK (received_qty >= 0 AND received_qty <= quantity);
ALTER TABLE goods_receipt_line ADD CONSTRAINT gr_line_quantity CHECK (quantity > 0 AND unit_cost >= 0);
ALTER TABLE goods_receipt ADD CONSTRAINT gr_void_consistency CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL));

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier', 'purchase_order', 'purchase_order_line', 'goods_receipt', 'goods_receipt_line'] LOOP
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
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON supplier, purchase_order, purchase_order_line, goods_receipt, goods_receipt_line TO %I', r);
      -- Los documentos de compra no se borran: se anulan o cancelan (trazabilidad).
      EXECUTE format('REVOKE DELETE, TRUNCATE ON supplier, goods_receipt, goods_receipt_line, purchase_order FROM %I', r);
    END IF;
  END LOOP;
END $$;
