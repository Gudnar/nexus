-- Rol de worker (ADR-001 / ADR-006): el dispatcher del outbox debe leer eventos de TODOS los
-- tenants. En vez de darle BYPASSRLS (que levantaría el aislamiento en todas las tablas), se le
-- concede una política propia SOLO sobre outbox_event y privilegios mínimos (leer y marcar).
-- Los consumidores ejecutan su trabajo con el rol de aplicación y el contexto del tenant del evento.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_worker') THEN
    GRANT SELECT, UPDATE ON outbox_event TO erp_worker;
    CREATE POLICY worker_dispatch ON outbox_event FOR ALL TO erp_worker USING (true) WITH CHECK (true);
  END IF;
END $$;
