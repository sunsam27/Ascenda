// ─────────────────────────────────────────────────────────────────────────────
// PRE-APPROVAL VALIDATION (PRD PAY-08 / PAY-10)
// Pure functions — no I/O. Blocking errors prevent submission; warnings must
// be acknowledged before approval. Thresholds are the organisation's own
// configuration (defaults documented here, overridable per org) — no country
// statutory values are hard-coded.
//
// PAY-08: missing data (compensation, bank details) blocks the run; workers on
// non-payroll statuses are excluded from items entirely and surfaced for
// visibility, not as errors.
// PAY-10: unusual salary change vs the previous run, excessive deductions, and
// negative net pay are warnings that must be acknowledged.
// ─────────────────────────────────────────────────────────────────────────────

export type RunValidationCode =
  | 'MISSING_SALARY'
  | 'MISSING_BANK_DETAILS'
  | 'BANK_DETAILS_UNREVIEWED'
  | 'DUPLICATE_RUN'
  | 'DUPLICATE_WORKER'
  | 'NO_ITEMS'
  | 'SALARY_INCREASE'
  | 'HIGH_DEDUCTIONS'
  | 'NEGATIVE_NET';

export interface RunValidationIssue {
  code: RunValidationCode;
  /** Present for worker-scoped issues; absent for run-scoped ones. */
  workerId?: string;
  message: string;
  /** Context values (minor units or percentages) for clients. */
  detail?: Record<string, number | string>;
}

export interface RunValidationThresholds {
  /** Warn when gross rises more than this % vs the previous run (default 30). */
  salaryChangeWarnPct: number;
  /** Warn when deductions exceed this share of gross, in bps (default 5000). */
  deductionRatioWarnBps: number;
  /** Blocking error when a worker has no bank account on file (default true). */
  requireBankDetails: boolean;
}

export const DEFAULT_VALIDATION_THRESHOLDS: RunValidationThresholds = {
  salaryChangeWarnPct: 30,
  deductionRatioWarnBps: 5000,
  requireBankDetails: true,
};

export interface WorkerValidationInput {
  workerId: string;
  /** Human identifier for messages (employee number or name). */
  identifier: string;
  hasCompensation: boolean;
  hasBankAccount: boolean;
  /** Bank details changed since the last payroll review (requires sign-off). */
  bankDetailsAwaitingReview?: boolean;
  /** This run's prorated earnings for the worker. */
  grossMinorUnits: number;
  /** Absolute deduction magnitude for the worker. */
  deductionMinorUnits: number;
  netMinorUnits: number;
  /** Same worker's gross in the previous comparable run, if one exists. */
  previousGrossMinorUnits?: number | null;
}

export interface RunValidationInput {
  workers: WorkerValidationInput[];
  /** Number of item lines prepared for the run. */
  itemCount: number;
  /** True when another non-reversed run exists for the same calendar+period. */
  duplicateRunExists: boolean;
  /** Worker ids appearing more than once in the run. */
  duplicateWorkerIds: string[];
  thresholds: RunValidationThresholds;
}

export interface RunValidationOutput {
  errors: RunValidationIssue[];
  warnings: RunValidationIssue[];
}

/**
 * Evaluate every PAY-08/PAY-10 rule for a prepared run. Errors block submit;
 * warnings require an explicit acknowledgement on the run before approval.
 */
export function validateRun(input: RunValidationInput): RunValidationOutput {
  const errors: RunValidationIssue[] = [];
  const warnings: RunValidationIssue[] = [];
  const t = input.thresholds;

  if (input.itemCount === 0) {
    errors.push({
      code: 'NO_ITEMS',
      message:
        'Run has no prepared items — prepare the run before submitting it',
    });
  }

  if (input.duplicateRunExists) {
    errors.push({
      code: 'DUPLICATE_RUN',
      message:
        'Another payroll run already exists for this pay calendar and period',
    });
  }

  for (const workerId of input.duplicateWorkerIds) {
    errors.push({
      code: 'DUPLICATE_WORKER',
      workerId,
      message: 'Worker appears more than once in this run',
    });
  }

  for (const worker of input.workers) {
    if (!worker.hasCompensation) {
      errors.push({
        code: 'MISSING_SALARY',
        workerId: worker.workerId,
        message: `Worker ${worker.identifier} has no compensation record effective for this period`,
      });
    }

    if (t.requireBankDetails && !worker.hasBankAccount) {
      errors.push({
        code: 'MISSING_BANK_DETAILS',
        workerId: worker.workerId,
        message: `Worker ${worker.identifier} has no bank account on file — payments cannot be processed`,
      });
    }

    if (worker.hasBankAccount && worker.bankDetailsAwaitingReview) {
      warnings.push({
        code: 'BANK_DETAILS_UNREVIEWED',
        workerId: worker.workerId,
        message: `Worker ${worker.identifier} has bank details changed since the last payroll review — confirm them before paying`,
      });
    }

    const previous = worker.previousGrossMinorUnits;
    if (
      previous != null &&
      previous > 0 &&
      worker.grossMinorUnits >
        (previous * (100 + t.salaryChangeWarnPct)) / 100
    ) {
      warnings.push({
        code: 'SALARY_INCREASE',
        workerId: worker.workerId,
        message: `Worker ${worker.identifier} gross increased by more than ${t.salaryChangeWarnPct}% since the previous run — review before approving`,
        detail: {
          previousGrossMinorUnits: previous,
          currentGrossMinorUnits: worker.grossMinorUnits,
          thresholdPct: t.salaryChangeWarnPct,
        },
      });
    }

    if (
      worker.grossMinorUnits > 0 &&
      (worker.deductionMinorUnits * 10_000) / worker.grossMinorUnits >
        t.deductionRatioWarnBps
    ) {
      warnings.push({
        code: 'HIGH_DEDUCTIONS',
        workerId: worker.workerId,
        message: `Worker ${worker.identifier} deductions exceed ${t.deductionRatioWarnBps / 100}% of gross`,
        detail: {
          grossMinorUnits: worker.grossMinorUnits,
          deductionMinorUnits: worker.deductionMinorUnits,
          thresholdBps: t.deductionRatioWarnBps,
        },
      });
    }

    if (worker.netMinorUnits < 0) {
      warnings.push({
        code: 'NEGATIVE_NET',
        workerId: worker.workerId,
        message: `Worker ${worker.identifier} net pay is negative — deductions exceed earnings`,
        detail: { netMinorUnits: worker.netMinorUnits },
      });
    }
  }

  return { errors, warnings };
}
