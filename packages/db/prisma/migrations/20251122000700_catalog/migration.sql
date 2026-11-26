-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "unit_of_measure" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ProductKind" NOT NULL DEFAULT 'GOODS',
    "category_id" UUID,
    "brand_id" UUID,
    "base_unit_id" UUID NOT NULL,
    "track_lots" BOOLEAN NOT NULL DEFAULT false,
    "track_expiry" BOOLEAN NOT NULL DEFAULT false,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_barcode" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "unit_id" UUID,

    CONSTRAINT "product_barcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_unit_conversion" (
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "product_unit_conversion_pkey" PRIMARY KEY ("tenant_id","product_id","unit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measure_tenant_id_id_key" ON "unit_of_measure"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measure_tenant_id_code_key" ON "unit_of_measure"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "category_tenant_id_id_key" ON "category"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "category_tenant_id_code_key" ON "category"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "brand_tenant_id_id_key" ON "brand"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_tenant_id_name_key" ON "brand"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "product_tenant_id_name_idx" ON "product"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenant_id_id_key" ON "product"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_tenant_id_code_key" ON "product"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "product_barcode_product_id_idx" ON "product_barcode"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcode_tenant_id_id_key" ON "product_barcode"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcode_tenant_id_barcode_key" ON "product_barcode"("tenant_id", "barcode");

-- AddForeignKey
ALTER TABLE "unit_of_measure" ADD CONSTRAINT "unit_of_measure_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "category"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand" ADD CONSTRAINT "brand_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "category"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_brand_id_fkey" FOREIGN KEY ("tenant_id", "brand_id") REFERENCES "brand"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_tenant_id_base_unit_id_fkey" FOREIGN KEY ("tenant_id", "base_unit_id") REFERENCES "unit_of_measure"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcode" ADD CONSTRAINT "product_barcode_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcode" ADD CONSTRAINT "product_barcode_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcode" ADD CONSTRAINT "product_barcode_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "unit_of_measure"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit_conversion" ADD CONSTRAINT "product_unit_conversion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit_conversion" ADD CONSTRAINT "product_unit_conversion_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit_conversion" ADD CONSTRAINT "product_unit_conversion_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "unit_of_measure"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Reglas de integridad del catálogo ────────────────────────────────
ALTER TABLE unit_of_measure ADD CONSTRAINT unit_decimals CHECK (decimals BETWEEN 0 AND 6);
ALTER TABLE product_unit_conversion ADD CONSTRAINT conversion_factor_positive CHECK (factor > 0);
-- El vencimiento requiere control por lote; los servicios no llevan lote ni vencimiento.
ALTER TABLE product ADD CONSTRAINT product_expiry_needs_lots CHECK (NOT track_expiry OR track_lots);
ALTER TABLE product ADD CONSTRAINT product_service_untracked CHECK (kind = 'GOODS' OR (NOT track_lots AND NOT track_expiry));
-- Una categoría no puede ser su propio padre.
ALTER TABLE category ADD CONSTRAINT category_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
-- Un producto no puede convertirse a su propia unidad base mediante una fila redundante: se valida en la aplicación
-- (requiere comparar con product.base_unit_id).

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['unit_of_measure', 'category', 'brand', 'product', 'product_barcode', 'product_unit_conversion'] LOOP
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
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON unit_of_measure, category, brand, product, product_barcode, product_unit_conversion TO erp_app;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_platform') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON unit_of_measure, category, brand, product, product_barcode, product_unit_conversion TO erp_platform;
  END IF;
END $$;
