-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionKind" AS ENUM ('APPROVE', 'REJECT');

-- CreateTable
CREATE TABLE "approval_workflow" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_workflow_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_workflow_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_request" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "code" TEXT NOT NULL,
    "workflow_id" UUID NOT NULL,
    "workflow_version" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(18,6),
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "config_snapshot" JSONB NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "requested_by_id" UUID NOT NULL,
    "due_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decision" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "decider_id" UUID NOT NULL,
    "on_behalf_of_id" UUID,
    "decision" "ApprovalDecisionKind" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "delegator_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "event_type" TEXT,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_escalation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "target_roles" JSONB NOT NULL,
    "target_users" JSONB NOT NULL,
    "escalated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "ref_type" TEXT,
    "ref_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_workflow_tenant_id_id_key" ON "approval_workflow"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_workflow_tenant_id_event_type_key" ON "approval_workflow"("tenant_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "approval_workflow_version_tenant_id_id_key" ON "approval_workflow_version"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_workflow_version_tenant_id_workflow_id_version_key" ON "approval_workflow_version"("tenant_id", "workflow_id", "version");

-- CreateIndex
CREATE INDEX "approval_request_tenant_id_status_created_at_idx" ON "approval_request"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approval_request_tenant_id_event_type_subject_id_idx" ON "approval_request"("tenant_id", "event_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_tenant_id_id_key" ON "approval_request"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_request_tenant_id_code_key" ON "approval_request"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decision_tenant_id_id_key" ON "approval_decision"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_decision_tenant_id_request_id_step_key" ON "approval_decision"("tenant_id", "request_id", "step");

-- CreateIndex
CREATE INDEX "approval_delegation_tenant_id_delegate_id_idx" ON "approval_delegation"("tenant_id", "delegate_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_delegation_tenant_id_id_key" ON "approval_delegation"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "approval_escalation_tenant_id_request_id_idx" ON "approval_escalation"("tenant_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_escalation_tenant_id_id_key" ON "approval_escalation"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "notification_tenant_id_user_id_read_at_created_at_idx" ON "notification"("tenant_id", "user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_tenant_id_id_key" ON "notification"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "approval_workflow" ADD CONSTRAINT "approval_workflow_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_workflow_version" ADD CONSTRAINT "approval_workflow_version_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_workflow_version" ADD CONSTRAINT "approval_workflow_version_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "approval_workflow"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_tenant_id_workflow_id_fkey" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "approval_workflow"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decision" ADD CONSTRAINT "approval_decision_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "approval_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegation" ADD CONSTRAINT "approval_delegation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_escalation" ADD CONSTRAINT "approval_escalation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_escalation" ADD CONSTRAINT "approval_escalation_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "approval_request"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integridad de aprobaciones ───────────────────────────────────────
ALTER TABLE approval_workflow ADD CONSTRAINT approval_workflow_event CHECK (event_type ~ '^[A-Z][A-Z0-9_]{2,40}$');
ALTER TABLE approval_request ADD CONSTRAINT approval_request_step CHECK (current_step >= 1);
-- Una solicitud resuelta tiene fecha de resolución; una pendiente no.
ALTER TABLE approval_request ADD CONSTRAINT approval_request_resolved CHECK ((status = 'PENDING') = (resolved_at IS NULL));
ALTER TABLE approval_request ADD CONSTRAINT approval_request_executed CHECK ((status = 'EXECUTED') = (executed_at IS NOT NULL));
ALTER TABLE approval_delegation ADD CONSTRAINT approval_delegation_dates CHECK (valid_to >= valid_from AND delegator_id <> delegate_id);

-- ── RLS, inmutabilidad de tenant_id y grants ─────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approval_workflow', 'approval_workflow_version', 'approval_request', 'approval_decision', 'approval_delegation', 'approval_escalation', 'notification'] LOOP
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
      -- Workflow, solicitud y delegación cambian de estado; nada se borra.
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON approval_workflow, approval_request, approval_delegation TO %I', r);
      EXECUTE format('REVOKE DELETE, TRUNCATE ON approval_workflow, approval_request, approval_delegation FROM %I', r);
      -- Versiones, decisiones y escalamientos son historia inmutable.
      EXECUTE format('GRANT SELECT, INSERT ON approval_workflow_version, approval_decision, approval_escalation TO %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON approval_workflow_version, approval_decision, approval_escalation FROM %I', r);
      -- Los avisos solo cambian su marca de lectura.
      EXECUTE format('GRANT SELECT, INSERT ON notification TO %I', r);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON notification FROM %I', r);
      EXECUTE format('GRANT UPDATE (read_at) ON notification TO %I', r);
    END IF;
  END LOOP;
END $$;
