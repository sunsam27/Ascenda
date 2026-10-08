-- ─────────────────────────────────────────────────────────────────────────────
-- ASCENDA — Row Level Security (RLS) Setup Migration
-- Run this after the initial Prisma migration
-- Source: ARCHITECTURE.md §2 + SECURITY.md §3
-- ─────────────────────────────────────────────────────────────────────────────

-- Create application role (not superuser, cannot bypass RLS)
-- Replace 'ascenda_app' and password with your actual credentials
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ascenda_app') THEN
    CREATE ROLE ascenda_app LOGIN PASSWORD 'REPLACE_WITH_SECRETS_MANAGER_VALUE';
  END IF;
END $$;

-- Create migrations role (separate from app role)
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ascenda_migrations') THEN
    CREATE ROLE ascenda_migrations LOGIN PASSWORD 'REPLACE_WITH_SECRETS_MANAGER_VALUE';
  END IF;
END $$;

-- Grant schema usage to app role
GRANT USAGE ON SCHEMA public TO ascenda_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ascenda_app;
-- Audit log: app role can only INSERT (append-only)
REVOKE UPDATE, DELETE ON audit_log FROM ascenda_app;

-- ── Function to read current org from session config ─────────────────────────
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid AS $$
  SELECT current_setting('app.current_org', true)::uuid;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── Enable RLS on all tenant tables ──────────────────────────────────────────
ALTER TABLE memberships             ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_identities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE compensation_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances          ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_calendars           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory_rule_packs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_workflows      ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_steps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ─────────────────────────────────────────────────────────────
-- Template: each tenant table gets a policy that filters by organisation_id
-- The app MUST set `app.current_org` at the start of each transaction.

CREATE POLICY tenant_isolation ON memberships
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON departments
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON locations
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON workers
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON worker_identities
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON compensation_records
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON bank_accounts
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON leave_types
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON leave_requests
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON leave_balances
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON attendance_records
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON pay_calendars
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON payroll_runs
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON payroll_items
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON statutory_rule_packs
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON payments
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON approval_workflows
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY tenant_isolation ON documents
  FOR ALL TO ascenda_app
  USING (organisation_id = current_org_id());

-- Audit log: read filtered by org; insert for any org (interceptor sets org)
CREATE POLICY tenant_read ON audit_log
  FOR SELECT TO ascenda_app
  USING (organisation_id = current_org_id());

CREATE POLICY audit_insert ON audit_log
  FOR INSERT TO ascenda_app
  WITH CHECK (true);

-- ── Approval steps: join-based policy (no direct org_id) ─────────────────────
-- approval_steps links to approval_workflows which carries organisation_id
-- Access is managed at the application layer; RLS on approval_workflows
-- already prevents cross-tenant access to workflows.
