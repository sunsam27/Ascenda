// ─────────────────────────────────────────────────────────────────────────────
// LEAVE BALANCE MATH (PRD LVE-01 / LVE-05)
// Pure functions — no I/O. Balances are day counts in 0.5 increments (never
// money). `accrued` is the entitlement earned for the year; `used` is consumed
// by approved leave; `balance` is the remainder. Balances change ONLY when a
// request reaches APPROVED, or is cancelled/reversed afterwards — the timing is
// enforced by the service, the arithmetic lives here.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeaveBalanceState {
  accrued: number;
  used: number;
}

export interface LeaveBalanceView extends LeaveBalanceState {
  balance: number;
}

export class InsufficientLeaveBalanceError extends Error {
  constructor(
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(
      `Insufficient leave balance: ${requested} requested, ${available} available`,
    );
    this.name = 'InsufficientLeaveBalanceError';
  }
}

/** Round to the nearest 0.5 (defensive against float drift). */
export function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/** Remaining days = accrued − used, floored at 0 for display purposes. */
export function remaining(state: LeaveBalanceState): number {
  return roundHalf(state.accrued - state.used);
}

export function toView(state: LeaveBalanceState): LeaveBalanceView {
  return {
    accrued: roundHalf(state.accrued),
    used: roundHalf(state.used),
    balance: remaining(state),
  };
}

/**
 * Consume `days` from a balance. Throws when the request exceeds the available
 * balance unless `allowNegative` is set (e.g. an HR override).
 */
export function applyUsage(
  state: LeaveBalanceState,
  days: number,
  opts: { allowNegative?: boolean } = {},
): LeaveBalanceState {
  const amount = roundHalf(days);
  if (amount < 0) throw new RangeError('days must be non-negative');

  const available = remaining(state);
  if (!opts.allowNegative && amount > available + Number.EPSILON) {
    throw new InsufficientLeaveBalanceError(available, amount);
  }

  return { accrued: roundHalf(state.accrued), used: roundHalf(state.used + amount) };
}

/** Restore `days` to a balance (cancel/reject of previously-approved leave). */
export function reverseUsage(
  state: LeaveBalanceState,
  days: number,
): LeaveBalanceState {
  const amount = roundHalf(days);
  if (amount < 0) throw new RangeError('days must be non-negative');

  return {
    accrued: roundHalf(state.accrued),
    used: roundHalf(Math.max(0, state.used - amount)),
  };
}

/** Accrue a pro-rata fraction of an annual entitlement (LVE-05). */
export function prorateAccrual(
  annualEntitlement: number,
  fraction: number,
): number {
  return roundHalf(annualEntitlement * Math.max(0, Math.min(1, fraction)));
}

/** The leave year (calendar year) a date falls in. */
export function leaveYear(date: Date): number {
  return date.getUTCFullYear();
}
