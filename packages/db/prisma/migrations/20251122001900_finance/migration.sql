-- CreateEnum
CREATE TYPE "PayableStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- AlterEnum
ALTER TYPE "CashMovementType" ADD VALUE 'SUPPLIER_PAYMENT';

-- AlterTable
ALTER TABLE "sale" ADD COLUMN     "due_date" DATE;

-- CreateTable
CREATE TABLE "payable" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BOB',
    "total" DECIMAL(18,6) NOT NULL,
    "paid_total" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "status" "PayableStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "branch_id" UUID,
    "code" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "reference" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cash_session_id" UUID,
    "created_by_id" UUID,

    CONSTRAINT "supplier_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "payable_id" UUID NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "supplier_payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payable_tenant_id_supplier_id_status_idx" ON "payable"("tenant_id", "supplier_id", "status");

-- CreateIndex
CREATE INDEX "payable_tenant_id_status_due_date_idx" ON "payable"("tenant_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "payable_tenant_id_id_key" ON "payable"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payable_tenant_id_receipt_id_key" ON "payable"("tenant_id", "receipt_id");

-- CreateIndex
CREATE INDEX "supplier_payment_tenant_id_supplier_id_paid_at_idx" ON "supplier_payment"("tenant_id", "supplier_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_tenant_id_id_key" ON "supplier_payment"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_tenant_id_code_key" ON "supplier_payment"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_allocation_tenant_id_id_key" ON "supplier_payment_allocation"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_allocation_tenant_id_payment_id_payable_id_key" ON "supplier_payment_allocation"("tenant_id", "payment_id", "payable_id");

-- AddForeignKey
ALTER TABLE "payable" ADD CONSTRAINT "payable_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable" ADD CONSTRAINT "payable_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable" ADD CONSTRAINT "payable_tenant_id_receipt_id_fkey" FOREIGN KEY ("tenant_id", "receipt_id") REFERENCES "goods_receipt"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_tenant_id_supplier_id_fkey" FOREIGN KEY ("tenant_id", "supplier_id") REFERENCES "supplier"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment" ADD CONSTRAINT "supplier_payment_tenant_id_cash_session_id_fkey" FOREIGN KEY ("tenant_id", "cash_session_id") REFERENCES "cash_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "supplier_payment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocation" ADD CONSTRAINT "supplier_payment_allocation_tenant_id_payable_id_fkey" FOREIGN KEY ("tenant_id", "payable_id") REFERENCES "payable"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad de cuentas por pagar ──────────────────────────────────
ALTER TABLE payable ADD CONSTRAINT payable_amounts CHECK (total >= 0 AND paid_total >= 0 AND paid_total <= total);
-- Una deuda pagada por completo está en PAID; una abierta tiene saldo (salvo las de importe cero, que nacen pagadas).
ALTER TABLE payable ADD CONSTRAINT payable_status_consistent CHECK (status = 'VOID' OR ((status = 'PAID') = (paid_total >= total)));
ALTER TABLE supplier_payment ADD CONSTRAINT supplier_payment_amount CHECK (amount > 0);
ALTER TABLE supplier_payment_allocation ADD CONSTRAINT supplier_alloc_amount CHECK (amount > 0);

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payable', 'supplier_payment', 'supplier_payment_allocation'] LOOP
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
      -- La deuda cambia (pagos aplicados, anulación); los pagos y sus asignaciones son hechos inmutables.
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON payable TO %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON payable FROM %I', r);
      EXECUTE format('GRANT SELECT, INSERT ON supplier_payment, supplier_payment_allocation TO %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON supplier_payment, supplier_payment_allocation FROM %I', r);
    END IF;
  END LOOP;
END $$;
