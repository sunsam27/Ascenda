-- ─────────────────────────────────────────────────────────────────────────────
-- ASCENDA — Row Level Security (RLS) Setup
-- Source: ARCHITECTURE.md §2, SECURITY.md §3
--
-- Idempotent: safe to re-run. Applied with a *privileged* connection
-- (DIRECT_URL). The application then connects as `ascenda_app`, which is a
-- non-superuser without BYPASSRLS, so every tenant query is filtered by the
-- policies below. See packages/db/scripts/apply-sql.cjs (via pnpm db:rls).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Roles ────────────────────────────────────────────────────────────────────
-- `__APP_PASSWORD__` is substituted by the apply script from env.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ascenda_app') THEN
    CREATE ROLE ascenda_app LOGIN PASSWORD '__APP_PASSWORD__';
  ELSE
    ALTER ROLE ascenda_app WITH LOGIN PASSWORD '__APP_PASSWORD__';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ascenda_migrations') THEN
    CREATE ROLE ascenda_migrations LOGIN PASSWORD '__APP_PASSWORD__';
  ELSE
    ALTER ROLE ascenda_migrations WITH LOGIN PASSWORD '__APP_PASSWORD__';
  END IF;
END $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO ascenda_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ascenda_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ascenda_app;

-- Objects created later by the owning (migration) role are also granted.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ascenda_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ascenda_app;

-- Audit log is append-only for the app role (SECURITY.md §8).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ascenda_app;

-- ── Context helpers ──────────────────────────────────────────────────────────
-- Set per transaction by PrismaService. `true` = missing_ok, returns NULL when
-- unset so policies simply match nothing.
CREATE OR REPLACE FUNCTION current_org_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_org', true), '')
  $$;

CREATE OR REPLACE FUNCTION current_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_user_id', true), '')
  $$;

-- ── Tenant-scoped tables ─────────────────────────────────────────────────────
-- Every table carrying organisation_id gets a single FOR ALL policy. USING
-- gates reads/updates/deletes; WITH CHECK gates writes.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'memberships', 'departments', 'locations', 'workers', 'worker_identities',
    'compensation_records', 'bank_accounts', 'leave_types', 'leave_requests',
    'leave_balances', 'attendance_records', 'pay_calendars', 'payroll_runs',
    'payroll_items', 'statutory_rule_packs', 'payments', 'approval_workflows',
    'documents', 'audit_log', 'subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO ascenda_app '
      'USING ("organisationId" = current_org_id()) '
      'WITH CHECK ("organisationId" = current_org_id())', t);
  END LOOP;
END $$;

-- ── Memberships: allow a user to read their own rows (needed at login, before
--    an organisation context exists). Permissive policies are OR-ed. ─────────
DROP POLICY IF EXISTS memberships_self_read ON memberships;
CREATE POLICY memberships_self_read ON memberships
  FOR SELECT TO ascenda_app
  USING ("userId" = current_user_id());

-- ── Organisations: only the active organisation is visible/modifiable. ───────
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organisations;
CREATE POLICY tenant_isolation ON organisations
  FOR ALL TO ascenda_app
  USING (id = current_org_id())
  WITH CHECK (id = current_org_id());

-- ── Approval steps: no organisation_id; isolate via their workflow. ──────────
ALTER TABLE approval_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON approval_steps;
CREATE POLICY tenant_isolation ON approval_steps
  FOR ALL TO ascenda_app
  USING (
    EXISTS (
      SELECT 1 FROM approval_workflows w
      WHERE w.id = approval_steps."approvalWorkflowId"
        AND w."organisationId" = current_org_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM approval_workflows w
      WHERE w.id = approval_steps."approvalWorkflowId"
        AND w."organisationId" = current_org_id()
    )
  );
