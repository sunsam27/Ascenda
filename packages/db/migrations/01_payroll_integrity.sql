-- ─────────────────────────────────────────────────────────────────────────────
-- ASCENDA — Payroll integrity guards (PAY-08 / PAY-12)
--
-- Idempotent. Applied with the privileged (DIRECT_URL) connection:
--   pnpm --filter @ascenda/db db:integrity
--
-- Application-level checks are not enough: two concurrent prepare/process
-- requests can both pass a read-then-write check. These partial unique indexes
-- make the database the final arbiter without blocking legitimate reversal
-- runs or ad-hoc (non-run) payments.
-- ─────────────────────────────────────────────────────────────────────────────

-- One live run per organisation + pay calendar + period. Reversal runs and
-- reversed originals are excluded so corrections remain possible.
CREATE UNIQUE INDEX IF NOT EXISTS payroll_runs_live_period_unique
  ON payroll_runs ("organisationId", "payCalendarId", "periodStart", "periodEnd")
  WHERE "reversalOfRunId" IS NULL
    AND "reversedAt" IS NULL
    AND status IN ('PENDING_APPROVAL', 'APPROVED', 'PROCESSED', 'LOCKED');

-- At most one payment row per worker in a payroll run. This protects against
-- duplicate payment creation if process/retry is executed concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS payments_run_worker_unique
  ON payments ("payrollRunId", "workerId")
  WHERE "payrollRunId" IS NOT NULL;

-- Payment batches are tenant-unique by reference (also in Prisma) and are
-- looked up by status in the admin UI.
CREATE INDEX IF NOT EXISTS payment_batches_org_status_idx
  ON payment_batches ("organisationId", status);

-- Bank-detail changes awaiting payroll review are a hot path for validation.
CREATE INDEX IF NOT EXISTS bank_accounts_payroll_review_idx
  ON bank_accounts ("organisationId", "requiresPayrollReview")
  WHERE "requiresPayrollReview" = true;
