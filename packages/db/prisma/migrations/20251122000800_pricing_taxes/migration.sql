-- CreateEnum
CREATE TYPE "PriceMode" AS ENUM ('WITH_TAX', 'WITHOUT_TAX');

-- CreateEnum
CREATE TYPE "ScalingMode" AS ENUM ('TIER_THRESHOLD', 'PROGRESSIVE');

-- CreateEnum
CREATE TYPE "PriceListScope" AS ENUM ('TENANT', 'BRANCH', 'CHANNEL');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('POS', 'ECOMMERCE', 'MESSAGING');

-- CreateEnum
CREATE TYPE "TaxProfileApplies" AS ENUM ('PRODUCT', 'CUSTOMER', 'OPERATION');

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "tax_profile_id" UUID;

-- CreateTable
CREATE TABLE "price_list" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_mode" "PriceMode" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "scope" "PriceListScope" NOT NULL DEFAULT 'TENANT',
    "branch_id" UUID,
    "channel" "SalesChannel",
    "scaling_mode" "ScalingMode" NOT NULL DEFAULT 'TIER_THRESHOLD',
    "valid_from" DATE,
    "valid_to" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "rounding_decimals" INTEGER NOT NULL DEFAULT 2,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_price_tier" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_price_id" UUID NOT NULL,
    "min_quantity" DECIMAL(18,4) NOT NULL,
    "max_quantity" DECIMAL(18,4),
    "unit_price" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "product_price_tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "price_list_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor_id" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_code" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "rate" DECIMAL(9,6) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,

    CONSTRAINT "tax_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_profile" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "applies_to" "TaxProfileApplies" NOT NULL DEFAULT 'PRODUCT',
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tax_profile_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "exemption_reason" TEXT,
    "valid_from" DATE,
    "valid_to" DATE,

    CONSTRAINT "tax_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_list_tenant_id_id_key" ON "price_list"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_tenant_id_code_key" ON "price_list"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "product_price_product_id_idx" ON "product_price"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_price_tenant_id_id_key" ON "product_price"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_price_tenant_id_price_list_id_product_id_key" ON "product_price"("tenant_id", "price_list_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_price_tier_tenant_id_id_key" ON "product_price_tier"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_price_tier_product_price_id_min_quantity_key" ON "product_price_tier"("product_price_id", "min_quantity");

-- CreateIndex
CREATE INDEX "price_history_price_list_id_product_id_changed_at_idx" ON "price_history"("price_list_id", "product_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "tax_code_tenant_id_id_key" ON "tax_code"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_code_tenant_id_code_key" ON "tax_code"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rate_tenant_id_id_key" ON "tax_rate"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rate_tax_code_id_valid_from_key" ON "tax_rate"("tax_code_id", "valid_from");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profile_tenant_id_id_key" ON "tax_profile"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profile_tenant_id_code_key" ON "tax_profile"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rule_tenant_id_id_key" ON "tax_rule"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rule_tax_profile_id_tax_code_id_key" ON "tax_rule"("tax_profile_id", "tax_code_id");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_tax_profile_id_fkey" FOREIGN KEY ("tenant_id", "tax_profile_id") REFERENCES "tax_profile"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list" ADD CONSTRAINT "price_list_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price" ADD CONSTRAINT "product_price_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price" ADD CONSTRAINT "product_price_tenant_id_price_list_id_fkey" FOREIGN KEY ("tenant_id", "price_list_id") REFERENCES "price_list"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price" ADD CONSTRAINT "product_price_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_tier" ADD CONSTRAINT "product_price_tier_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_price_tier" ADD CONSTRAINT "product_price_tier_tenant_id_product_price_id_fkey" FOREIGN KEY ("tenant_id", "product_price_id") REFERENCES "product_price"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_tenant_id_price_list_id_fkey" FOREIGN KEY ("tenant_id", "price_list_id") REFERENCES "price_list"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_code" ADD CONSTRAINT "tax_code_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_tenant_id_tax_code_id_fkey" FOREIGN KEY ("tenant_id", "tax_code_id") REFERENCES "tax_code"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_profile" ADD CONSTRAINT "tax_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rule" ADD CONSTRAINT "tax_rule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rule" ADD CONSTRAINT "tax_rule_tenant_id_tax_profile_id_fkey" FOREIGN KEY ("tenant_id", "tax_profile_id") REFERENCES "tax_profile"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rule" ADD CONSTRAINT "tax_rule_tenant_id_tax_code_id_fkey" FOREIGN KEY ("tenant_id", "tax_code_id") REFERENCES "tax_code"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad de listas de precios ──────────────────────────────────
ALTER TABLE price_list ADD CONSTRAINT price_list_scope_branch
  CHECK ((scope = 'BRANCH') = (branch_id IS NOT NULL));
ALTER TABLE price_list ADD CONSTRAINT price_list_scope_channel
  CHECK ((scope = 'CHANNEL') = (channel IS NOT NULL));
ALTER TABLE price_list ADD CONSTRAINT price_list_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from);
ALTER TABLE price_list ADD CONSTRAINT price_list_rounding CHECK (rounding_decimals BETWEEN 0 AND 4);
ALTER TABLE price_list ADD CONSTRAINT price_list_currency CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE product_price_tier ADD CONSTRAINT tier_quantities
  CHECK (min_quantity > 0 AND (max_quantity IS NULL OR max_quantity > min_quantity));
ALTER TABLE product_price_tier ADD CONSTRAINT tier_price_nonnegative CHECK (unit_price >= 0);

-- ── Integridad de impuestos ──────────────────────────────────────────
ALTER TABLE tax_rate ADD CONSTRAINT tax_rate_range CHECK (rate >= 0 AND rate <= 100);
ALTER TABLE tax_rate ADD CONSTRAINT tax_rate_validity CHECK (valid_to IS NULL OR valid_to >= valid_from);
ALTER TABLE tax_rule ADD CONSTRAINT tax_rule_validity CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from);

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'price_list', 'product_price', 'product_price_tier', 'price_history',
    'tax_code', 'tax_rate', 'tax_profile', 'tax_rule'
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
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON price_list, product_price, product_price_tier, tax_code, tax_rate, tax_profile, tax_rule TO %I', r);
      -- El historial de precios es append-only.
      EXECUTE format('GRANT SELECT, INSERT ON price_history TO %I', r);
    END IF;
  END LOOP;
END $$;
