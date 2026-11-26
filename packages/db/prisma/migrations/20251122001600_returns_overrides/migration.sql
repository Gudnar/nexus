-- AlterTable
ALTER TABLE "quote_line" ADD COLUMN     "applied_unit_price" DECIMAL(18,6),
ADD COLUMN     "override_by_id" UUID,
ADD COLUMN     "override_reason" TEXT;

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "refunded_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
ADD COLUMN     "returned_total" DECIMAL(18,6) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sale_line" ADD COLUMN     "applied_unit_price" DECIMAL(18,6),
ADD COLUMN     "override_by_id" UUID,
ADD COLUMN     "override_reason" TEXT;

-- CreateTable
CREATE TABLE "sale_return" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "net_total" DECIMAL(18,6) NOT NULL,
    "tax_total" DECIMAL(18,6) NOT NULL,
    "total" DECIMAL(18,6) NOT NULL,
    "refund_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "net_amount" DECIMAL(18,6) NOT NULL,
    "tax_amount" DECIMAL(18,6) NOT NULL,
    "total_amount" DECIMAL(18,6) NOT NULL,
    "cost_total" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "sale_return_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "reference" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_return_tenant_id_sale_id_idx" ON "sale_return"("tenant_id", "sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_tenant_id_id_key" ON "sale_return"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_tenant_id_code_key" ON "sale_return"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "sale_return_line_tenant_id_sale_line_id_idx" ON "sale_return_line"("tenant_id", "sale_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_line_tenant_id_id_key" ON "sale_return_line"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "refund_tenant_id_sale_id_idx" ON "refund"("tenant_id", "sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_tenant_id_id_key" ON "refund"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_line" ADD CONSTRAINT "sale_return_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_line" ADD CONSTRAINT "sale_return_line_tenant_id_return_id_fkey" FOREIGN KEY ("tenant_id", "return_id") REFERENCES "sale_return"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_line" ADD CONSTRAINT "sale_return_line_tenant_id_sale_line_id_fkey" FOREIGN KEY ("tenant_id", "sale_line_id") REFERENCES "sale_line"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_line" ADD CONSTRAINT "sale_return_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenant_id_sale_id_fkey" FOREIGN KEY ("tenant_id", "sale_id") REFERENCES "sale"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenant_id_return_id_fkey" FOREIGN KEY ("tenant_id", "return_id") REFERENCES "sale_return"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad de devoluciones y sobreprecios ────────────────────────
ALTER TABLE sale ADD CONSTRAINT sale_returns_bounds CHECK (returned_total >= 0 AND returned_total <= total AND refunded_total >= 0 AND refunded_total <= paid_total);
-- Un precio cambiado a mano siempre lleva su motivo.
ALTER TABLE sale_line ADD CONSTRAINT sale_line_override_reason CHECK ((applied_unit_price IS NULL) = (override_reason IS NULL) AND (applied_unit_price IS NULL OR applied_unit_price >= 0));
ALTER TABLE quote_line ADD CONSTRAINT quote_line_override_reason CHECK ((applied_unit_price IS NULL) = (override_reason IS NULL) AND (applied_unit_price IS NULL OR applied_unit_price >= 0));
ALTER TABLE sale_return ADD CONSTRAINT sale_return_totals CHECK (net_total >= 0 AND tax_total >= 0 AND total >= 0 AND refund_total >= 0 AND refund_total <= total);
ALTER TABLE sale_return_line ADD CONSTRAINT sale_return_line_values CHECK (quantity > 0 AND net_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND cost_total >= 0);
ALTER TABLE refund ADD CONSTRAINT refund_amount CHECK (amount > 0);

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sale_return', 'sale_return_line', 'refund'] LOOP
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
      -- Notas de crédito y reembolsos son hechos inmutables: solo se insertan.
      EXECUTE format('GRANT SELECT, INSERT ON sale_return, sale_return_line, refund TO %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON sale_return, sale_return_line, refund FROM %I', r);
    END IF;
  END LOOP;
END $$;
