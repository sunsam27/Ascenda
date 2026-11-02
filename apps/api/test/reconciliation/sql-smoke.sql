BEGIN;

CREATE TEMP TABLE workers (
  id text PRIMARY KEY,
  "employeeNumber" text NOT NULL,
  "firstName" text NOT NULL,
  "lastName" text NOT NULL
);

CREATE TEMP TABLE payroll_runs (
  id text PRIMARY KEY,
  currency text NOT NULL
);

CREATE TEMP TABLE payroll_items (
  "payrollRunId" text NOT NULL,
  "workerId" text NOT NULL,
  type text NOT NULL,
  "amountMinorUnits" bigint NOT NULL
);

CREATE TEMP TABLE payslips (
  "payrollRunId" text NOT NULL,
  "workerId" text NOT NULL,
  "employerCostsMinorUnits" bigint NOT NULL
);

INSERT INTO workers (id, "employeeNumber", "firstName", "lastName") VALUES
  ('w-1', 'SMOKE-001', 'Ada', 'Alpha'),
  ('w-2', 'SMOKE-002', 'Ben', 'Beta');

INSERT INTO payroll_runs (id, currency) VALUES
  ('11111111-1111-1111-1111-111111111111', 'NGN');

INSERT INTO payroll_items ("payrollRunId", "workerId", type, "amountMinorUnits") VALUES
  ('11111111-1111-1111-1111-111111111111', 'w-1', 'BASIC_SALARY', 50000000),
  ('11111111-1111-1111-1111-111111111111', 'w-1', 'OVERTIME', 2000000),
  ('11111111-1111-1111-1111-111111111111', 'w-1', 'TAX', -5000000),
  ('11111111-1111-1111-1111-111111111111', 'w-1', 'EMPLOYEE_PENSION', -2500000),
  ('11111111-1111-1111-1111-111111111111', 'w-2', 'BASIC_SALARY', 30000000),
  ('11111111-1111-1111-1111-111111111111', 'w-2', 'DEDUCTION', -1000000);

INSERT INTO payslips ("payrollRunId", "workerId", "employerCostsMinorUnits") VALUES
  ('11111111-1111-1111-1111-111111111111', 'w-1', 5000000),
  ('11111111-1111-1111-1111-111111111111', 'w-2', 3000000);

\set run_id '11111111-1111-1111-1111-111111111111'
\i apps/api/test/reconciliation/export-run-actuals.sql

ROLLBACK;
