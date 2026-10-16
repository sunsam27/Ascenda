// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL MATH (PRD LVE-06 / PAY-05 / ATT-03)
// Pure functions — no I/O, no Prisma. All money is integer minor units; day
// counts are 0.5-increment numbers. Deterministic so a run can be reproduced.
//
// MVP model (agreed with product):
//   • Base salary is PRORATED by unpaid-leave days (PAY-05 / LVE-06).
//   • Attendance absences are a separate deduction line (ATT-03).
// Statutory tax/pension and overtime are out of scope for the preview engine.
// ─────────────────────────────────────────────────────────────────────────────

export type PayrollLineType = 'EARNING' | 'DEDUCTION';

export interface PayrollLine {
  type: PayrollLineType;
  /** Stable machine code, e.g. `BASE`, `UNPAID_ABSENCE`. */
  code: string;
  description: string;
  /** Signed integer minor units: positive earning, negative deduction. */
  amountMinorUnits: number;
}

export interface PayslipInput {
  currency: string;
  /** Full-period gross from the effective compensation record. */
  grossMinorUnits: number;
  /** Working days in the pay period (excludes weekends + holidays). */
  periodWorkingDays: number;
  unpaidLeaveDays?: number;
  absenceDays?: number;
}

export interface PayslipResult {
  currency: string;
  periodWorkingDays: number;
  payableDays: number;
  unpaidLeaveDays: number;
  absenceDays: number;
  lines: PayrollLine[];
  /** Sum of earnings (base, already prorated). */
  grossMinorUnits: number;
  /** Positive magnitude of deductions. */
  deductionsMinorUnits: number;
  netMinorUnits: number;
}

/** Round to the nearest minor unit (integer money). */
export function roundMinor(value: number): number {
  return Math.round(value);
}

/** Round to the nearest half day. */
export function roundHalfDay(value: number): number {
  return Math.round(value * 2) / 2;
}

function nonNeg(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Money per working day (may be fractional — round at line level). */
export function dayRateMinor(
  grossMinorUnits: number,
  periodWorkingDays: number,
): number {
  const gross = Math.max(0, roundMinor(grossMinorUnits));
  if (!Number.isFinite(periodWorkingDays) || periodWorkingDays <= 0) return 0;
  return gross / periodWorkingDays;
}

/**
 * Base pay prorated by unpaid-leave days: full gross when no unpaid leave,
 * scaled down by the unpaid fraction otherwise. Never negative.
 */
export function proratedBaseMinor(
  grossMinorUnits: number,
  periodWorkingDays: number,
  unpaidLeaveDays: number,
): number {
  const gross = Math.max(0, roundMinor(grossMinorUnits));
  if (periodWorkingDays <= 0) return 0;
  const payable = Math.min(
    periodWorkingDays,
    Math.max(0, periodWorkingDays - nonNeg(unpaidLeaveDays)),
  );
  return roundMinor((gross * payable) / periodWorkingDays);
}

/**
 * Positive magnitude of the absence deduction: the day rate times the number of
 * absent days (0.5 for a half day), optionally capped.
 */
export function absenceDeductionMinor(
  grossMinorUnits: number,
  periodWorkingDays: number,
  absenceDays: number,
  capMinorUnits?: number,
): number {
  if (periodWorkingDays <= 0) return 0;
  const raw = roundMinor(
    (grossMinorUnits / periodWorkingDays) * nonNeg(absenceDays),
  );
  return capMinorUnits == null ? raw : Math.min(raw, capMinorUnits);
}

/**
 * Build a payslip preview for one worker and pay period. Base pay is prorated
 * by unpaid leave; absences are a separate (capped-at-gross) deduction.
 */
export function buildPayslip(input: PayslipInput): PayslipResult {
  const gross = Math.max(0, roundMinor(input.grossMinorUnits));
  const periodWorkingDays = Math.max(0, input.periodWorkingDays);
  const unpaidLeaveDays = nonNeg(input.unpaidLeaveDays);
  const absenceDays = nonNeg(input.absenceDays);

  const base = proratedBaseMinor(gross, periodWorkingDays, unpaidLeaveDays);
  const absenceDeduction = absenceDeductionMinor(
    gross,
    periodWorkingDays,
    absenceDays,
    base,
  );

  const lines: PayrollLine[] = [
    {
      type: 'EARNING',
      code: 'BASE',
      description: 'Base salary',
      amountMinorUnits: base,
    },
  ];
  if (absenceDeduction > 0) {
    lines.push({
      type: 'DEDUCTION',
      code: 'UNPAID_ABSENCE',
      description: `Unpaid absence (${roundHalfDay(absenceDays)} day(s))`,
      amountMinorUnits: -absenceDeduction,
    });
  }

  const grossMinorUnits = base;
  const deductionsMinorUnits = absenceDeduction;

  return {
    currency: input.currency,
    periodWorkingDays,
    payableDays: roundHalfDay(
      Math.max(0, periodWorkingDays - unpaidLeaveDays),
    ),
    unpaidLeaveDays: roundHalfDay(unpaidLeaveDays),
    absenceDays: roundHalfDay(absenceDays),
    lines,
    grossMinorUnits,
    deductionsMinorUnits,
    netMinorUnits: grossMinorUnits - deductionsMinorUnits,
  };
}
