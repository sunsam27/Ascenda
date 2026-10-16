import {
  InsufficientLeaveBalanceError,
  applyUsage,
  leaveYear,
  prorateAccrual,
  remaining,
  reverseUsage,
  toView,
  type LeaveBalanceState,
} from './leave-balance';

describe('leave balance math', () => {
  // PRD 12.2: "Balance is reduced only on final approval and restored if later
  // cancelled."
  it('reduces the balance on approval and restores it on cancellation', () => {
    const start: LeaveBalanceState = { accrued: 20, used: 0 };

    const approved = applyUsage(start, 3.5);
    expect(toView(approved)).toEqual({ accrued: 20, used: 3.5, balance: 16.5 });

    const cancelled = reverseUsage(approved, 3.5);
    expect(cancelled).toEqual(start);
    expect(remaining(cancelled)).toBe(20);
  });

  it('keeps balances in 0.5 increments (half days)', () => {
    const next = applyUsage({ accrued: 12, used: 0 }, 0.5);
    expect(next.used).toBe(0.5);
    expect(remaining(next)).toBe(11.5);
  });

  it('refuses usage beyond the available balance', () => {
    expect(() => applyUsage({ accrued: 5, used: 4.5 }, 1)).toThrow(
      InsufficientLeaveBalanceError,
    );
  });

  it('permits a negative balance only when explicitly allowed', () => {
    const next = applyUsage({ accrued: 5, used: 5 }, 1, { allowNegative: true });
    expect(remaining(next)).toBe(-1);
  });

  it('never drives used below zero when reversing', () => {
    expect(reverseUsage({ accrued: 5, used: 1 }, 3)).toEqual({
      accrued: 5,
      used: 0,
    });
  });

  it('rejects negative day counts', () => {
    expect(() => applyUsage({ accrued: 5, used: 0 }, -1)).toThrow(RangeError);
    expect(() => reverseUsage({ accrued: 5, used: 0 }, -1)).toThrow(RangeError);
  });

  it('pro-rates accrual over the year', () => {
    expect(prorateAccrual(24, 0.5)).toBe(12);
    expect(prorateAccrual(21, 0.25)).toBe(5.5);
    expect(prorateAccrual(21, 2)).toBe(21); // clamped to 1
  });

  it('derives the calendar leave year', () => {
    expect(leaveYear(new Date('2026-06-15T00:00:00Z'))).toBe(2026);
  });
});
