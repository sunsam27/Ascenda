// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL RUN PREPARE MATHS (PRD PAY-05 / PAY-08 / PAY-10)
// Pure functions — no I/O. Builds the signed item lines for one worker in one
// pay period, from compensation components (current at the period), employment
// window proration (joiner/leaver), unpaid-leave proration, absence deduction,
// and the worker's recurring deduction/tax items. Totals are the sum of the
// lines by construction, so run totals always equal the sum of payslips to the
// smallest unit.
//
// Employer-side recurring items (EMPLOYER_PENSION) are an org cost, not an
// employee pay run line — they are excluded here (documented M2 boundary;
// employer-cost reporting ships with the reports milestone). Statutory values
// are DATA configured by the organisation — never hard-coded per country.
// ─────────────────────────────────────────────────────────────────────────────

import { absenceDeductionMinor, proratedBaseMinor } from './payroll';
import { recurringItemAmountMinor, RecurringPayItemInput } from './recurring-pay-item';

export type RunItemType =
  | 'BASIC_SALARY'
  | 'ALLOWANCE'
  | 'DEDUCTION'
  | 'TAX'
  | 'EMPLOYEE_PENSION'
  | 'REIMBURSEMENT';

export interface RunComponentInput {
  /** Stable machine code, e.g. `BASIC_SALARY`, `HOUSING_ALLOWANCE`. */
  code: string;
  description: string;
  /** Signed-in-major but stored positive: earnings are positive minor units. */
  amountMinorUnits: number;
}

export interface RunRecurringInput extends RecurringPayItemInput {
  name: string;
  /** Employee-side types only — employer costs are filtered out by the caller. */
  type: 'DEDUCTION' | 'TAX' | 'EMPLOYEE_PENSION';
}

export interface WorkerPrepareInput {
  workerId: string;
  /** Compensation components (positive minor units) effective at period start. */
  components: RunComponentInput[];
  /** Working days in the FULL period (schedule + holidays). */
  periodWorkingDays: number;
  /** Working days actually employed inside the period (joiner/leaver clip). */
  employedWorkingDays: number;
  /** APPROVED unpaid-leave days inside the period. */
  unpaidLeaveDays: number;
  /** Absent (unexcused) days inside the period, from attendance. */
  absenceDays: number;
  /** Active, employee-side recurring items valid for the period. */
  recurring: RunRecurringInput[];
}

export interface PreparedLine {
  itemType: RunItemType;
  description: string;
  /** Signed integer minor units: positive earning, negative deduction. */
  amountMinorUnits: number;
}

export interface PreparedWorkerResult {
  workerId: string;
  lines: PreparedLine[];
  grossMinorUnits: number;
  deductionsMinorUnits: number;
  netMinorUnits: number;
}

/** Component code → run item type. `BASE` (legacy) and `BASIC_SALARY` are base
 * pay; every other component code is an allowance. */
export function componentItemType(code: string): RunItemType {
  return code === 'BASIC_SALARY' || code === 'BASE'
    ? 'BASIC_SALARY'
    : 'ALLOWANCE';
}

/**
 * Build every line for one worker. Earnings are always present (even at 0, so
 * proration is visible); deduction lines appear only above 0.
 */
export function prepareWorker(input: WorkerPrepareInput): PreparedWorkerResult {
  const wd = Math.max(0, Math.round(input.periodWorkingDays));
  const employed = Math.max(
    0,
    Math.min(wd, Math.round(input.employedWorkingDays)),
  );
  // Joiner/leaver factor: share of the period actually employed (≤ 1).
  const factor = wd > 0 ? employed / wd : 0;
  const unpaid = Math.max(0, Math.round(input.unpaidLeaveDays));

  const lines: PreparedLine[] = [];
  let gross = 0;

  for (const component of input.components) {
    const base = proratedBaseMinor(
      Math.max(0, Math.round(component.amountMinorUnits) * factor),
      wd,
      unpaid,
    );
    gross += base;
    lines.push({
      itemType: componentItemType(component.code),
      description: component.description,
      amountMinorUnits: base,
    });
  }

  const absence = absenceDeductionMinor(gross, wd, input.absenceDays, gross);
  if (absence > 0) {
    lines.push({
      itemType: 'DEDUCTION',
      description: 'Unexcused absence',
      amountMinorUnits: -absence,
    });
  }

  let deductions = absence;
  for (const item of input.recurring) {
    if (item.type === 'EMPLOYEE_PENSION' || item.type === 'DEDUCTION' || item.type === 'TAX') {
      const amount = recurringItemAmountMinor(item, gross);
      if (amount > 0) {
        deductions += amount;
        lines.push({
          itemType: item.type,
          description: item.name,
          amountMinorUnits: -amount,
        });
      }
    }
  }

  return {
    workerId: input.workerId,
    lines,
    grossMinorUnits: gross,
    deductionsMinorUnits: deductions,
    netMinorUnits: gross - deductions,
  };
}

/**
 * Fold per-worker results into run totals. By construction each worker's net
 * equals gross − deductions, so the run-level totals reconcile to the sum of
 * payslip lines to the smallest unit.
 */
export function runTotals(
  results: PreparedWorkerResult[],
): { grossMinorUnits: number; deductionsMinorUnits: number; netMinorUnits: number } {
  let gross = 0;
  let deductions = 0;
  let net = 0;
  for (const result of results) {
    gross += result.grossMinorUnits;
    deductions += result.deductionsMinorUnits;
    net += result.netMinorUnits;
  }
  return {
    grossMinorUnits: gross,
    deductionsMinorUnits: deductions,
    netMinorUnits: net,
  };
}

/**
 * Fold signed lines into a worker result with the prepare semantics:
 * `net` = sum of every line; `deductions` = −(sum of deduction-type lines);
 * `gross` = net + deductions (sum of earning-type lines, signed). On normal
 * runs deductions are positive; on reversal mirrors they are negative, and
 * gross − deductions still equals net exactly.
 */
export function foldWorkerLines(
  workerId: string,
  lines: PreparedLine[],
): PreparedWorkerResult {
  let net = 0;
  let deductionSum = 0;
  for (const line of lines) {
    net += line.amountMinorUnits;
    if (
      line.itemType === 'DEDUCTION' ||
      line.itemType === 'TAX' ||
      line.itemType === 'EMPLOYEE_PENSION'
    ) {
      deductionSum += line.amountMinorUnits;
    }
  }
  return {
    workerId,
    lines,
    grossMinorUnits: net - deductionSum,
    deductionsMinorUnits: -deductionSum,
    netMinorUnits: net,
  };
}

/**
 * PAY-06: the mirrored lines of a reversal run — the original's lines with the
 * sign flipped, so processing the reversal produces equal and opposite
 * payments. Totals follow the lines (they are negated too).
 */
export function reverseLines(
  lines: Array<{ itemType: RunItemType; description: string; amountMinorUnits: number }>,
): PreparedLine[] {
  return lines.map((line) => ({
    itemType: line.itemType,
    description: line.description,
    amountMinorUnits: -line.amountMinorUnits,
  }));
}
