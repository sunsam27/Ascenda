import { PayrollItemType } from '@ascenda/types';
import {
  aggregateRemittance,
  aggregateStatement,
  buildRemittanceCsv,
  minorUnitsToDecimal,
  resolveTaxYear,
  withinTaxYear,
  type StatementPayslipInput,
} from './year-end';

function slip(over: Partial<StatementPayslipInput> = {}): StatementPayslipInput {
  return {
    periodStart: '2026-01-01T00:00:00.000Z',
    currency: 'NGN',
    grossMinorUnits: 0,
    deductionsMinorUnits: 0,
    employerCostsMinorUnits: 0,
    netMinorUnits: 0,
    lines: [],
    ...over,
  };
}

describe('year-end tax-year window (PAY-16)', () => {
  it('labels a January-start year as a plain calendar year', () => {
    const w = resolveTaxYear(2026, 1);
    expect(w.label).toBe('2026');
    expect(w.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('labels a non-January year as a two-year span', () => {
    const w = resolveTaxYear(2026, 4);
    expect(w.label).toBe('2026/2027');
    expect(w.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });

  it('treats the window as [start, endExclusive)', () => {
    const w = resolveTaxYear(2026, 1);
    expect(withinTaxYear('2026-01-01T00:00:00.000Z', w)).toBe(true);
    expect(withinTaxYear('2026-12-31T23:59:59.999Z', w)).toBe(true);
    expect(withinTaxYear('2027-01-01T00:00:00.000Z', w)).toBe(false);
    expect(withinTaxYear('2025-12-31T23:59:59.999Z', w)).toBe(false);
  });

  it('clamps an out-of-range start month', () => {
    expect(resolveTaxYear(2026, 99).startMonth).toBe(12);
    expect(resolveTaxYear(2026, 0).startMonth).toBe(1);
  });
});

describe('year-end statement aggregation (PAY-16)', () => {
  it('sums totals and rolls lines up per type + description', () => {
    const totals = aggregateStatement([
      slip({
        grossMinorUnits: 500000,
        deductionsMinorUnits: 75000,
        netMinorUnits: 425000,
        lines: [
          { type: PayrollItemType.BASIC_SALARY, description: 'Base salary', amountMinorUnits: 500000 },
          { type: PayrollItemType.TAX, description: 'PAYE', amountMinorUnits: -75000 },
        ],
      }),
      slip({
        grossMinorUnits: 500000,
        deductionsMinorUnits: 75000,
        netMinorUnits: 425000,
        lines: [
          { type: PayrollItemType.BASIC_SALARY, description: 'Base salary', amountMinorUnits: 500000 },
          { type: PayrollItemType.TAX, description: 'PAYE', amountMinorUnits: -75000 },
        ],
      }),
    ]);

    expect(totals.grossMinorUnits).toBe(1000000);
    expect(totals.deductionsMinorUnits).toBe(150000);
    expect(totals.netMinorUnits).toBe(850000);
    expect(totals.payslipCount).toBe(2);
    expect(totals.currency).toBe('NGN');

    const base = totals.lines.find((l) => l.description === 'Base salary');
    const paye = totals.lines.find((l) => l.description === 'PAYE');
    expect(base?.amountMinorUnits).toBe(1000000);
    expect(paye?.amountMinorUnits).toBe(-150000);
  });

  it('lists earnings before deductions', () => {
    const totals = aggregateStatement([
      slip({
        lines: [
          { type: PayrollItemType.TAX, description: 'PAYE', amountMinorUnits: -75000 },
          { type: PayrollItemType.BASIC_SALARY, description: 'Base salary', amountMinorUnits: 500000 },
        ],
      }),
    ]);
    expect(totals.lines[0]?.amountMinorUnits).toBeGreaterThanOrEqual(0);
    expect(totals.lines[1]?.amountMinorUnits).toBeLessThan(0);
  });

  it('carries employer costs through', () => {
    const totals = aggregateStatement([
      slip({ employerCostsMinorUnits: 50000 }),
      slip({ employerCostsMinorUnits: 50000 }),
    ]);
    expect(totals.employerCostsMinorUnits).toBe(100000);
  });

  it('handles an empty set', () => {
    const totals = aggregateStatement([]);
    expect(totals.payslipCount).toBe(0);
    expect(totals.netMinorUnits).toBe(0);
    expect(totals.lines).toEqual([]);
  });
});

describe('remittance schedule aggregation (PAY-16)', () => {
  it('groups statutory lines and splits employee vs employer', () => {
    const result = aggregateRemittance(
      [
        slip({
          lines: [
            { type: PayrollItemType.TAX, description: 'PAYE', amountMinorUnits: -75000 },
            { type: PayrollItemType.EMPLOYEE_PENSION, description: 'Pension 8%', amountMinorUnits: -40000 },
            { type: PayrollItemType.BASIC_SALARY, description: 'Base salary', amountMinorUnits: 500000 },
          ],
        }),
      ],
      [{ validated: true }],
    );
    expect(result.employeeTotalMinorUnits).toBe(115000);
    expect(result.employerTotalMinorUnits).toBe(0);
    expect(result.lines.map((l) => l.label)).toEqual(['PAYE', 'Pension 8%']);
  });

  it('totalises employee-side lines only when no employer lines exist', () => {
    const result = aggregateRemittance(
      [
        slip({
          lines: [
            { type: PayrollItemType.TAX, description: 'PAYE', amountMinorUnits: -75000 },
          ],
        }),
      ],
      [{ validated: true }],
    );
    expect(result.employeeTotalMinorUnits).toBe(75000);
  });

  it('splits employer cost onto the employer side from employerCostsMinorUnits', () => {
    const result = aggregateRemittance(
      [
        slip({
          employerCostsMinorUnits: 50000,
          lines: [
            { type: PayrollItemType.EMPLOYEE_PENSION, description: 'Pension 8%', amountMinorUnits: -40000 },
          ],
        }),
      ],
      [{ validated: true, employerLabels: ['Employer pension 10%'] }],
    );
    expect(result.employeeTotalMinorUnits).toBe(40000);
    expect(result.employerTotalMinorUnits).toBe(50000);
    const employer = result.lines.find((l) => l.side === 'EMPLOYER');
    expect(employer?.label).toBe('Employer pension 10%');
    expect(employer?.itemType).toBe('EMPLOYER_PENSION');
  });

  it('ignores employer pension as a payslip line (it is a cost, not a deduction)', () => {
    const result = aggregateRemittance(
      [
        slip({
          lines: [
            { type: PayrollItemType.EMPLOYER_PENSION, description: 'Employer pension', amountMinorUnits: -50000 },
          ],
        }),
      ],
      [{ validated: true }],
    );
    expect(result.employeeTotalMinorUnits).toBe(0);
    expect(result.employerTotalMinorUnits).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('labels an unlabelled employer total generically', () => {
    const result = aggregateRemittance(
      [slip({ employerCostsMinorUnits: 25000 })],
      [{ validated: true }],
    );
    const employer = result.lines.find((l) => l.side === 'EMPLOYER');
    expect(employer?.label).toBe('Employer contributions');
  });

  it('flags the schedule unvalidated when any pack is unvalidated', () => {
    const result = aggregateRemittance(
      [slip({ lines: [{ type: PayrollItemType.TAX, description: 'PAYE', amountMinorUnits: -100 }] })],
      [{ validated: true }, { validated: false }],
    );
    expect(result.validatedByProfessional).toBe(false);
  });

  it('ignores non-statutory lines', () => {
    const result = aggregateRemittance(
      [slip({ lines: [{ type: PayrollItemType.ALLOWANCE, description: 'Housing', amountMinorUnits: 100000 }] })],
      [{ validated: true }],
    );
    expect(result.lines).toEqual([]);
    expect(result.employeeTotalMinorUnits).toBe(0);
  });
});

describe('remittance CSV (PAY-16)', () => {
  it('renders minor units as a decimal string', () => {
    expect(minorUnitsToDecimal(123456)).toBe('1234.56');
    expect(minorUnitsToDecimal(-500000)).toBe('-5000.00');
  });

  it('emits a BOM, header row and CRLF endings', () => {
    const csv = buildRemittanceCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('tax_year,scheme,side');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes fields with commas', () => {
    const csv = buildRemittanceCsv([
      {
        taxYearLabel: '2026',
        scheme: 'PAYE, main',
        side: 'EMPLOYEE',
        itemType: PayrollItemType.TAX,
        amountMinorUnits: 75000,
        currency: 'NGN',
      },
    ]);
    expect(csv).toContain('"PAYE, main"');
    expect(csv).toContain('750.00,NGN');
  });
});
