import {
  recurringItemAmountMinor,
  validateRecurringItem,
} from './recurring-pay-item';

describe('validateRecurringItem', () => {
  it('accepts a FIXED salary-advance deduction', () => {
    expect(
      validateRecurringItem({ calculation: 'FIXED', amountMinorUnits: 25_000_00 }),
    ).toEqual([]);
  });

  it('accepts a PERCENTAGE employer pension (10% = 1000 bps)', () => {
    expect(
      validateRecurringItem({ calculation: 'PERCENTAGE', rateBps: 1000 }),
    ).toEqual([]);
  });

  it('rejects a FIXED item without a positive whole amount', () => {
    expect(
      validateRecurringItem({ calculation: 'FIXED' })[0],
    ).toContain('amountMinorUnits');
    expect(
      validateRecurringItem({ calculation: 'FIXED', amountMinorUnits: 0 })[0],
    ).toContain('amountMinorUnits');
    expect(
      validateRecurringItem({ calculation: 'FIXED', amountMinorUnits: 1.5 })[0],
    ).toContain('amountMinorUnits');
  });

  it('rejects a FIXED item that also carries a rate', () => {
    expect(
      validateRecurringItem({
        calculation: 'FIXED',
        amountMinorUnits: 1,
        rateBps: 500,
      }),
    ).toContain('rateBps must not be set when calculation is FIXED');
  });

  it('rejects PERCENTAGE rates outside 1–10000 bps', () => {
    expect(
      validateRecurringItem({ calculation: 'PERCENTAGE', rateBps: 0 })[0],
    ).toContain('rateBps');
    expect(
      validateRecurringItem({ calculation: 'PERCENTAGE', rateBps: 10_001 })[0],
    ).toContain('rateBps');
  });

  it('rejects a PERCENTAGE item that also carries an amount', () => {
    expect(
      validateRecurringItem({
        calculation: 'PERCENTAGE',
        rateBps: 500,
        amountMinorUnits: 100,
      }),
    ).toContain('amountMinorUnits must not be set when calculation is PERCENTAGE');
  });
});

describe('recurringItemAmountMinor', () => {
  it('returns the stored amount for FIXED items', () => {
    expect(
      recurringItemAmountMinor(
        { calculation: 'FIXED', amountMinorUnits: 25_000_00 },
        67_500_000,
      ),
    ).toBe(25_000_00);
  });

  it('computes basis points of period gross for PERCENTAGE items', () => {
    // 10% of ₦675,000.00
    expect(
      recurringItemAmountMinor(
        { calculation: 'PERCENTAGE', rateBps: 1000 },
        67_500_000,
      ),
    ).toBe(6_750_000);
    // 3.33% of ₦100,000.00
    expect(
      recurringItemAmountMinor(
        { calculation: 'PERCENTAGE', rateBps: 333 },
        10_000_000,
      ),
    ).toBe(333_000);
  });

  it('rounds half up to the nearest minor unit', () => {
    expect(
      recurringItemAmountMinor(
        { calculation: 'PERCENTAGE', rateBps: 5000 },
        1,
      ),
    ).toBe(1); // 0.5 → 1
    expect(
      recurringItemAmountMinor(
        { calculation: 'PERCENTAGE', rateBps: 5000 },
        3,
      ),
    ).toBe(2); // 1.5 → 2
  });

  it('never returns a negative amount', () => {
    expect(
      recurringItemAmountMinor(
        { calculation: 'FIXED', amountMinorUnits: -100 },
        1_000,
      ),
    ).toBe(0);
    expect(
      recurringItemAmountMinor(
        { calculation: 'PERCENTAGE', rateBps: 500 },
        -1_000,
      ),
    ).toBe(0);
  });
});
