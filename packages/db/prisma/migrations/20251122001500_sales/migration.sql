-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalePaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'QR', 'CARD', 'CHEQUE');

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "default_price_list_id" UUID,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(18,2),
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_id" UUID,
    "prospect_name" TEXT,
    "valid_until" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "note" TEXT,
    "net_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "converted_sale_id" UUID,
    "created_by_id" UUID,
    "sent_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price_list_id" UUID NOT NULL,
    "price_mode" "PriceMode" NOT NULL,
    "scaling_mode" "ScalingMode" NOT NULL,
    "list_unit_price" DECIMAL(18,6) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(18,6) NOT NULL,
    "tax_amount" DECIMAL(18,6) NOT NULL,
    "total_amount" DECIMAL(18,6) NOT NULL,
    "taxes" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "quote_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "SalePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "customer_id" UUID,
    "seller_id" UUID,
    "channel" "SalesChannel" NOT NULL DEFAULT 'POS',
    "quote_id" UUID,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "net_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "paid_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "note" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price_list_id" UUID NOT NULL,
    "price_mode" "PriceMode" NOT NULL,
    "scaling_mode" "ScalingMode" NOT NULL,
    "list_unit_price" DECIMAL(18,6) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(18,6) NOT NULL,
    "tax_amount" DECIMAL(18,6) NOT NULL,
    "total_amount" DECIMAL(18,6) NOT NULL,
    "taxes" JSONB NOT NULL,
    "breakdown" JSONB NOT NULL,
    "cost_total" DECIMAL(18,6),

    CONSTRAINT "sale_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "movement_id" UUID NOT NULL,

    CONSTRAINT "sale_line_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "reference" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_tenant_id_name_idx" ON "customer"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenant_id_id_key" ON "customer"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tenant_id_code_key" ON "customer"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "quote_converted_sale_id_key" ON "quote"("converted_sale_id");

-- CreateIndex
CREATE INDEX "quote_tenant_id_status_created_at_idx" ON "quote"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quote_tenant_id_id_key" ON "quote"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_tenant_id_code_key" ON "quote"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "quote_line_tenant_id_id_key" ON "quote_line"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_line_tenant_id_quote_id_product_id_key" ON "quote_line"("tenant_id", "quote_id", "product_id");

-- CreateIndex
CREATE INDEX "sale_tenant_id_status_created_at_idx" ON "sale"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "sale_tenant_id_customer_id_idx" ON "sale"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_tenant_id_id_key" ON "sale"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_tenant_id_code_key" ON "sale"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sale_line_tenant_id_id_key" ON "sale_line"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_line_tenant_id_sale_id_product_id_key" ON "sale_line"("tenant_id", "sale_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_line_allocation_tenant_id_id_key" ON "sale_line_allocation"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "payment_tenant_id_sale_id_idx" ON "payment"("tenant_id", "sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenant_id_id_key" ON "payment"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_default_price_list_id_fkey" FOREIGN KEY ("tenant_id", "default_price_list_id") REFERENCES "price_list"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_tenant_id_quote_id_fkey" FOREIGN KEY ("tenant_id", "quote_id") REFERENCES "quote"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_tenant_id_price_list_id_fkey" FOREIGN KEY ("tenant_id", "price_list_id") REFERENCES "price_list"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale" ADD CONSTRAINT "sale_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line" ADD CONSTRAINT "sale_line_tenant_id_price_list_id_fkey" FOREIGN KEY ("tenant_id", "price_list_id") REFERENCES "price_list"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_allocation" ADD CONSTRAINT "sale_line_allocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_allocation" ADD CONSTRAINT "sale_line_allocation_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_allocation" ADD CONSTRAINT "sale_line_allocation_tenant_id_line_id_fkey" FOREIGN KEY ("tenant_id", "line_id") REFERENCES "sale_line"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_allocation" ADD CONSTRAINT "sale_line_allocation_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_allocation" ADD CONSTRAINT "sale_line_allocation_tenant_id_lot_id_fkey" FOREIGN KEY ("tenant_id", "lot_id") REFERENCES "lot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad comercial ─────────────────────────────────────────────
ALTER TABLE customer ADD CONSTRAINT customer_code_format CHECK (code ~ '^[A-Za-z0-9._-]{1,32}$');
ALTER TABLE customer ADD CONSTRAINT customer_terms CHECK (payment_terms_days BETWEEN 0 AND 365 AND (credit_limit IS NULL OR credit_limit >= 0));
-- Un mismo NIT/documento no se registra dos veces en la empresa.
CREATE UNIQUE INDEX customer_tax_id_unique ON customer (tenant_id, lower(tax_id)) WHERE tax_id IS NOT NULL;

ALTER TABLE quote ADD CONSTRAINT quote_party CHECK (customer_id IS NOT NULL OR prospect_name IS NOT NULL);
ALTER TABLE quote ADD CONSTRAINT quote_totals CHECK (net_total >= 0 AND tax_total >= 0 AND total >= 0);
ALTER TABLE quote_line ADD CONSTRAINT quote_line_values CHECK (quantity > 0 AND discount_pct BETWEEN 0 AND 100 AND net_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND list_unit_price >= 0);

ALTER TABLE sale ADD CONSTRAINT sale_totals CHECK (net_total >= 0 AND tax_total >= 0 AND discount_total >= 0 AND total >= 0 AND paid_total >= 0 AND paid_total <= total);
-- Toda venta confirmada tiene su código correlativo.
ALTER TABLE sale ADD CONSTRAINT sale_code_when_confirmed CHECK (confirmed_at IS NULL OR code IS NOT NULL);
ALTER TABLE sale ADD CONSTRAINT sale_cancel_reason CHECK (status <> 'CANCELLED' OR confirmed_at IS NULL OR (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL));
ALTER TABLE sale_line ADD CONSTRAINT sale_line_values CHECK (quantity > 0 AND discount_pct BETWEEN 0 AND 100 AND net_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND list_unit_price >= 0);
ALTER TABLE sale_line_allocation ADD CONSTRAINT sale_alloc_values CHECK (quantity > 0 AND unit_cost >= 0);
ALTER TABLE payment ADD CONSTRAINT payment_amount CHECK (amount > 0);

-- Una venta confirmada es inmutable: sus líneas no se editan ni se borran (la anulación es un cambio de estado de la venta).
CREATE FUNCTION sale_lines_frozen() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE
  st text;
BEGIN
  SELECT status::text INTO st FROM sale WHERE tenant_id = OLD.tenant_id AND id = OLD.sale_id;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'Una venta confirmada no se modifica (sale %)', OLD.sale_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER sale_line_frozen BEFORE UPDATE OR DELETE ON sale_line FOR EACH ROW EXECUTE FUNCTION sale_lines_frozen();

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer', 'quote', 'quote_line', 'sale', 'sale_line', 'sale_line_allocation', 'payment'] LOOP
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
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON customer, quote, quote_line, sale, sale_line, sale_line_allocation, payment TO %I', r);
      -- Nada comercial se borra físicamente: ventas, cobros y trazas. Solo las líneas de un BORRADOR (las protege el trigger).
      EXECUTE format('REVOKE DELETE, TRUNCATE ON customer, quote, sale, sale_line_allocation, payment FROM %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON payment FROM %I', r); -- el cobro es un hecho financiero inmutable
      EXECUTE format('REVOKE TRUNCATE ON sale_line, quote_line FROM %I', r);
    END IF;
  END LOOP;
END $$;
