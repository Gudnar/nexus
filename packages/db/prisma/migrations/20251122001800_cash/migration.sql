-- CreateEnum
CREATE TYPE "CashRegisterKind" AS ENUM ('BOX', 'VAULT');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING', 'SALE_PAYMENT', 'REFUND', 'INCOME', 'EXPENSE', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "DifferenceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "cash_session_id" UUID;

-- AlterTable
ALTER TABLE "refund" ADD COLUMN     "cash_session_id" UUID;

-- CreateTable
CREATE TABLE "cash_register" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CashRegisterKind" NOT NULL DEFAULT 'BOX',
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_session" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "responsible_id" UUID NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_cash" DECIMAL(18,2) NOT NULL,
    "opening_denominations" JSONB,
    "open_note" TEXT,
    "closing_requested_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by_id" UUID,
    "reopened_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_session_participant" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_session_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "source_type" TEXT,
    "source_id" UUID,
    "group_id" UUID,
    "reversal_of_id" UUID,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_count" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "is_closing" BOOLEAN NOT NULL DEFAULT false,
    "expected_cash" DECIMAL(18,2) NOT NULL,
    "counted_cash" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "denominations" JSONB NOT NULL,
    "note" TEXT,
    "counted_by_id" UUID,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_difference" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "DifferenceStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_difference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closing" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_closing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_register_tenant_id_id_key" ON "cash_register"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_register_tenant_id_code_key" ON "cash_register"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "cash_session_tenant_id_register_id_status_idx" ON "cash_session"("tenant_id", "register_id", "status");

-- CreateIndex
CREATE INDEX "cash_session_tenant_id_responsible_id_status_idx" ON "cash_session"("tenant_id", "responsible_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_session_tenant_id_id_key" ON "cash_session"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_session_tenant_id_code_key" ON "cash_session"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cash_session_participant_tenant_id_id_key" ON "cash_session_participant"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_session_participant_tenant_id_session_id_user_id_key" ON "cash_session_participant"("tenant_id", "session_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movement_seq_key" ON "cash_movement"("seq");

-- CreateIndex
CREATE INDEX "cash_movement_tenant_id_session_id_seq_idx" ON "cash_movement"("tenant_id", "session_id", "seq");

-- CreateIndex
CREATE INDEX "cash_movement_tenant_id_source_type_source_id_idx" ON "cash_movement"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movement_tenant_id_id_key" ON "cash_movement"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "cash_count_tenant_id_session_id_idx" ON "cash_count"("tenant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_count_tenant_id_id_key" ON "cash_count"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "cash_difference_tenant_id_session_id_status_idx" ON "cash_difference"("tenant_id", "session_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_difference_tenant_id_id_key" ON "cash_difference"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closing_tenant_id_id_key" ON "cash_closing"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_closing_tenant_id_session_id_version_key" ON "cash_closing"("tenant_id", "session_id", "version");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_cash_session_id_fkey" FOREIGN KEY ("tenant_id", "cash_session_id") REFERENCES "cash_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenant_id_cash_session_id_fkey" FOREIGN KEY ("tenant_id", "cash_session_id") REFERENCES "cash_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_register" ADD CONSTRAINT "cash_register_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_register" ADD CONSTRAINT "cash_register_tenant_id_branch_id_fkey" FOREIGN KEY ("tenant_id", "branch_id") REFERENCES "branch"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_tenant_id_register_id_fkey" FOREIGN KEY ("tenant_id", "register_id") REFERENCES "cash_register"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session_participant" ADD CONSTRAINT "cash_session_participant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_session_participant" ADD CONSTRAINT "cash_session_participant_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "cash_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movement" ADD CONSTRAINT "cash_movement_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "cash_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "cash_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_difference" ADD CONSTRAINT "cash_difference_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_difference" ADD CONSTRAINT "cash_difference_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "cash_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_difference" ADD CONSTRAINT "cash_difference_tenant_id_count_id_fkey" FOREIGN KEY ("tenant_id", "count_id") REFERENCES "cash_count"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closing" ADD CONSTRAINT "cash_closing_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_closing" ADD CONSTRAINT "cash_closing_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "cash_session"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad de caja ───────────────────────────────────────────────
ALTER TABLE cash_register ADD CONSTRAINT cash_register_code_format CHECK (code ~ '^[A-Za-z0-9._-]{1,32}$');
ALTER TABLE cash_session ADD CONSTRAINT cash_session_opening CHECK (opening_cash >= 0);
ALTER TABLE cash_session ADD CONSTRAINT cash_session_closed_fields CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL));
-- Una sola sesión abierta (o en cierre) por caja: dos aperturas simultáneas, solo una prospera (ADR-005, punto 2).
CREATE UNIQUE INDEX cash_session_one_active_per_register ON cash_session (tenant_id, register_id) WHERE status IN ('OPEN', 'CLOSING');
ALTER TABLE cash_movement ADD CONSTRAINT cash_movement_amount CHECK (amount <> 0);
ALTER TABLE cash_count ADD CONSTRAINT cash_count_values CHECK (expected_cash >= 0 AND counted_cash >= 0);
ALTER TABLE cash_difference ADD CONSTRAINT cash_difference_nonzero CHECK (amount <> 0);
ALTER TABLE cash_difference ADD CONSTRAINT cash_difference_decision CHECK ((status = 'PENDING') = (decided_at IS NULL));
-- La sesión solo recibe movimientos mientras está ABIERTA: en cierre o cerrada rechaza cualquier movimiento (ADR-005, puntos 7 y 10).
CREATE FUNCTION cash_movement_requires_open_session() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE
  st text;
BEGIN
  SELECT status::text INTO st FROM cash_session WHERE tenant_id = NEW.tenant_id AND id = NEW.session_id;
  IF st IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'La sesión de caja no está abierta (estado %)', COALESCE(st, 'inexistente') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER cash_movement_open_session BEFORE INSERT ON cash_movement FOR EACH ROW EXECUTE FUNCTION cash_movement_requires_open_session();

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_register', 'cash_session', 'cash_session_participant', 'cash_movement', 'cash_count', 'cash_difference', 'cash_closing'] LOOP
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
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON cash_register, cash_session, cash_difference TO %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON cash_register, cash_session, cash_difference FROM %I', r);
      EXECUTE format('GRANT SELECT, INSERT ON cash_session_participant, cash_movement, cash_count, cash_closing TO %I', r);
      -- El libro, los arqueos y los cierres solo se insertan: lo corregido se compensa con otro movimiento.
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON cash_session_participant, cash_movement, cash_count, cash_closing FROM %I', r);
    END IF;
  END LOOP;
END $$;
