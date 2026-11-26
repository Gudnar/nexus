-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "stock_reservation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "note" TEXT,
    "created_by_id" UUID,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservation_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "stock_reservation_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_reservation_tenant_id_status_expires_at_idx" ON "stock_reservation"("tenant_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "stock_reservation_tenant_id_source_type_source_id_idx" ON "stock_reservation"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservation_tenant_id_id_key" ON "stock_reservation"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservation_tenant_id_code_key" ON "stock_reservation"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservation_line_tenant_id_id_key" ON "stock_reservation_line"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_tenant_id_warehouse_id_fkey" FOREIGN KEY ("tenant_id", "warehouse_id") REFERENCES "warehouse"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation_line" ADD CONSTRAINT "stock_reservation_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation_line" ADD CONSTRAINT "stock_reservation_line_tenant_id_reservation_id_fkey" FOREIGN KEY ("tenant_id", "reservation_id") REFERENCES "stock_reservation"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation_line" ADD CONSTRAINT "stock_reservation_line_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "product"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation_line" ADD CONSTRAINT "stock_reservation_line_tenant_id_lot_id_fkey" FOREIGN KEY ("tenant_id", "lot_id") REFERENCES "lot"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad de reservas ───────────────────────────────────────────
ALTER TABLE stock_reservation_line ADD CONSTRAINT stock_reservation_line_qty CHECK (quantity > 0);
-- Una reserva cerrada (liberada, consumida o vencida) tiene fecha de cierre; una activa no.
ALTER TABLE stock_reservation ADD CONSTRAINT stock_reservation_closed CHECK ((status = 'ACTIVE') = (closed_at IS NULL));

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_reservation', 'stock_reservation_line'] LOOP
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
      -- La cabecera cambia de estado (cierre); las líneas son inmutables y nada se borra.
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON stock_reservation TO %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON stock_reservation FROM %I', r);
      EXECUTE format('GRANT SELECT, INSERT ON stock_reservation_line TO %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON stock_reservation_line FROM %I', r);
    END IF;
  END LOOP;
END $$;
