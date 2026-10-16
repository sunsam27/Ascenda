// ─────────────────────────────────────────────────────────────────────────────
// LEAVE ACCRUAL MATH (PRD LVE-05)
// Pure functions — no I/O, no Prisma. Day counts are 0.5-increment numbers. A
// leave year is the calendar year (UTC). Carry-over is *folded into* the new
// year's `accrued` — there is no separate balance column — so a run simply
// recomputes `accrued` from the policy plus the prior year's remainder.
// ─────────────────────────────────────────────────────────────────────────────

export type LeaveAccrualMethodValue =
  | 'NONE'
  | 'ANNUAL_UPFRONT'
  | 'MONTHLY'
  | 'PRO_RATA';

export interface AccrualPolicy {
  method: LeaveAccrualMethodValue;
  annualEntitlement: number;
  carryOverEnabled: boolean;
  /** Cap on days carried in (null = uncapped). */
  carryOverMaxDays: number | null;
  /** Months into the new year before carried days expire (null = never). */
  carryOverExpiryMonths: number | null;
}

export interface PriorYearBalance {
  accrued: number;
  used: number;
}

const MS_PER_DAY = 86_400_000;

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Days in a Gregorian year (365 or 366). */
export function daysInYear(year: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leap ? 366 : 365;
}

/**
 * Entitlement earned for `year` as of the instant `asOf` (UTC), per the method.
 * The result is always a multiple of 0.5. Dates before the year start earn 0;
 * dates after the year end earn the full entitlement.
 */
export function accrualToDate(
  method: LeaveAccrualMethodValue,
  annualEntitlement: number,
  year: number,
  asOf: Date,
): number {
  if (method === 'NONE') return 0;

  const annual = Math.max(0, annualEntitlement);
  if (method === 'ANNUAL_UPFRONT') return roundHalf(annual);

  const yearStart = Date.UTC(year, 0, 1);
  if (asOf.getTime() < yearStart) return 0;

  if (method === 'MONTHLY') {
    const months = clamp(asOf.getUTCMonth() + 1, 0, 12);
    return roundHalf((annual * months) / 12);
  }

  // PRO_RATA — the entitlement accrues day by day across the leave year.
  const total = daysInYear(year);
  const dayOfYear = Math.floor((asOf.getTime() - yearStart) / MS_PER_DAY) + 1;
  const elapsed = clamp(dayOfYear, 0, total);
  return roundHalf((annual * elapsed) / total);
}

/**
 * Days carried from the prior year into `year`, capped and expired per policy.
 * Carry-over only applies once the new year begins; carried days expire at the
 * start of `year + carryOverExpiryMonths`.
 */
export function carryOverDays(
  prior: PriorYearBalance | null,
  opts: {
    enabled: boolean;
    maxDays: number | null;
    expiryMonths: number | null;
    year: number;
    asOf: Date;
  },
): number {
  if (!opts.enabled || !prior) return 0;

  const yearStart = Date.UTC(opts.year, 0, 1);
  if (opts.asOf.getTime() < yearStart) return 0;

  const remaining = Math.max(0, prior.accrued - prior.used);
  const capped = opts.maxDays == null ? remaining : Math.min(remaining, opts.maxDays);

  if (opts.expiryMonths != null) {
    const expiry = Date.UTC(opts.year, opts.expiryMonths, 1);
    if (opts.asOf.getTime() >= expiry) return 0;
  }

  return roundHalf(Math.max(0, capped));
}

/** Total accrued for `year` = entitlement earned to date + valid carried days. */
export function computeAccrued(
  policy: AccrualPolicy,
  year: number,
  asOf: Date,
  prior: PriorYearBalance | null,
): number {
  const earned = accrualToDate(policy.method, policy.annualEntitlement, year, asOf);
  const carried = carryOverDays(prior, {
    enabled: policy.carryOverEnabled,
    maxDays: policy.carryOverMaxDays,
    expiryMonths: policy.carryOverExpiryMonths,
    year,
    asOf,
  });
  return roundHalf(earned + carried);
}
