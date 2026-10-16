import {
  absenceDeductionMinor,
  buildPayslip,
  proratedBaseMinor,
  roundHalfDay,
} from './payroll';

describe('payroll preview engine (LVE-06 / ATT-03)', () => {
  describe('base proration', () => {
    it('pays the full gross when there is no unpaid leave', () => {
      expect(proratedBaseMinor(500_000_00, 20, 0)).toBe(50_000_000);
      expect(proratedBaseMinor(500_000_00, 20, 0)).toBe(50_000_000);
    });

    it('prorates by unpaid leave days', () => {
      // 500,000.00 over 20 working days, 2 unpaid days → 18/20 payable.
      expect(proratedBaseMinor(50_000_000, 20, 2)).toBe(45_000_000);
    });

    it('supports half-day unpaid leave and rounds to minor units', () => {
      // 50,000,000 / 20 = 2,500,000 per day; 0.5 day off → 48,750,000.
      expect(proratedBaseMinor(50_000_000, 20, 0.5)).toBe(48_750_000);
      expect(proratedBaseMinor(100, 21, 0)).toBe(100);
    });

    it('never goes below zero when leave exceeds the period', () => {
      expect(proratedBaseMinor(50_000_000, 20, 25)).toBe(0);
    });

    it('returns zero for a zero-length period', () => {
      expect(proratedBaseMinor(50_000_000, 0, 0)).toBe(0);
    });
  });

  describe('absence deduction', () => {
    it('deducts the day rate per absent day', () => {
      expect(absenceDeductionMinor(50_000_000, 20, 1)).toBe(2_500_000);
      expect(absenceDeductionMinor(50_000_000, 20, 1.5)).toBe(3_750_000);
    });

    it('honours the cap', () => {
      expect(absenceDeductionMinor(50_000_000, 20, 10, 5_000_000)).toBe(5_000_000);
    });
  });

  describe('buildPayslip', () => {
    it('produces a full-earnings payslip with no deductions', () => {
      const slip = buildPayslip({
        currency: 'NGN',
        grossMinorUnits: 50_000_000,
        periodWorkingDays: 20,
      });
      expect(slip.grossMinorUnits).toBe(50_000_000);
      expect(slip.deductionsMinorUnits).toBe(0);
      expect(slip.netMinorUnits).toBe(50_000_000);
      expect(slip.lines).toHaveLength(1);
      expect(slip.lines[0]).toMatchObject({ type: 'EARNING', code: 'BASE', amountMinorUnits: 50_000_000 });
    });

    it('prorates base for unpaid leave and deducts absences', () => {
      const slip = buildPayslip({
        currency: 'NGN',
        grossMinorUnits: 50_000_000,
        periodWorkingDays: 20,
        unpaidLeaveDays: 2,
        absenceDays: 1,
      });
      // base = 45,000,000; absence = 2,500,000 → net 42,500,000.
      expect(slip.grossMinorUnits).toBe(45_000_000);
      expect(slip.deductionsMinorUnits).toBe(2_500_000);
      expect(slip.netMinorUnits).toBe(42_500_000);
      expect(slip.payableDays).toBe(18);
      const deduction = slip.lines.find((l) => l.code === 'UNPAID_ABSENCE');
      expect(deduction && deduction.amountMinorUnits).toBe(-2_500_000);
    });

    it('caps deductions at gross so net is never negative', () => {
      const slip = buildPayslip({
        currency: 'NGN',
        grossMinorUnits: 10_000_000,
        periodWorkingDays: 20,
        unpaidLeaveDays: 20,
        absenceDays: 20,
      });
      expect(slip.grossMinorUnits).toBe(0);
      expect(slip.netMinorUnits).toBe(0);
      expect(slip.lines).toHaveLength(1); // no deduction line when base is 0
    });

    it('signed lines sum to net', () => {
      const slip = buildPayslip({
        currency: 'NGN',
        grossMinorUnits: 12_345_678,
        periodWorkingDays: 22,
        unpaidLeaveDays: 1.5,
        absenceDays: 2.5,
      });
      const sum = slip.lines.reduce((t, l) => t + l.amountMinorUnits, 0);
      expect(sum).toBe(slip.netMinorUnits);
    });
  });
});
