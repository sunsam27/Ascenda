import {
  AccrualPolicy,
  accrualToDate,
  carryOverDays,
  computeAccrued,
  daysInYear,
} from './leave-accrual';

const base: AccrualPolicy = {
  method: 'ANNUAL_UPFRONT',
  annualEntitlement: 20,
  carryOverEnabled: false,
  carryOverMaxDays: null,
  carryOverExpiryMonths: null,
};

const at = (iso: string) => new Date(`${iso}T06:00:00.000Z`);

describe('leave accrual (LVE-05)', () => {
  it('grants the full entitlement upfront', () => {
    expect(accrualToDate('ANNUAL_UPFRONT', 20, 2026, at('2026-01-01'))).toBe(20);
    expect(accrualToDate('ANNUAL_UPFRONT', 20, 2026, at('2026-07-01'))).toBe(20);
  });

  it('returns nothing for NONE and before the year starts', () => {
    expect(accrualToDate('NONE', 20, 2026, at('2026-07-01'))).toBe(0);
    expect(accrualToDate('MONTHLY', 20, 2026, at('2025-12-31'))).toBe(0);
  });

  it('accrues monthly in equal steps', () => {
    expect(accrualToDate('MONTHLY', 24, 2026, at('2026-01-15'))).toBe(2);
    expect(accrualToDate('MONTHLY', 24, 2026, at('2026-06-15'))).toBe(12);
    expect(accrualToDate('MONTHLY', 24, 2026, at('2026-12-31'))).toBe(24);
  });

  it('rounds monthly accrual to the nearest half day', () => {
    expect(accrualToDate('MONTHLY', 20, 2026, at('2026-02-01'))).toBe(3.5);
  });

  it('accrues pro-rata across the year', () => {
    const mid = accrualToDate('PRO_RATA', 20, 2026, at('2026-07-02'));
    expect(mid).toBeGreaterThan(9.5);
    expect(mid).toBeLessThan(10.5);
    expect(accrualToDate('PRO_RATA', 20, 2026, at('2026-12-31'))).toBe(20);
  });

  it('carries over the remaining balance within the cap', () => {
    const carried = carryOverDays(
      { accrued: 20, used: 6 },
      { enabled: true, maxDays: 5, expiryMonths: null, year: 2026, asOf: at('2026-01-05') },
    );
    expect(carried).toBe(5);
  });

  it('does not carry over when disabled or absent', () => {
    expect(
      carryOverDays(
        { accrued: 20, used: 0 },
        { enabled: false, maxDays: null, expiryMonths: null, year: 2026, asOf: at('2026-02-01') },
      ),
    ).toBe(0);
    expect(
      carryOverDays(null, {
        enabled: true,
        maxDays: null,
        expiryMonths: null,
        year: 2026,
        asOf: at('2026-02-01'),
      }),
    ).toBe(0);
  });

  it('expires carried days after the expiry window', () => {
    const opts = { enabled: true, maxDays: null, expiryMonths: 3, year: 2026 };
    expect(carryOverDays({ accrued: 10, used: 0 }, { ...opts, asOf: at('2026-03-31') })).toBe(10);
    expect(carryOverDays({ accrued: 10, used: 0 }, { ...opts, asOf: at('2026-04-01') })).toBe(0);
  });

  it('folds carry-over into the computed entitlement', () => {
    const policy: AccrualPolicy = { ...base, carryOverEnabled: true, carryOverMaxDays: 5 };
    expect(computeAccrued(policy, 2026, at('2026-01-02'), { accrued: 20, used: 6 })).toBe(25);
  });

  it('knows leap years', () => {
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2028)).toBe(366);
  });
});
