import {
  componentItemType,
  foldWorkerLines,
  PreparedLine,
  prepareWorker,
  reverseLines,
  runTotals,
  WorkerPrepareInput,
} from './run-calc';

function baseInput(
  overrides: Partial<WorkerPrepareInput> = {},
): WorkerPrepareInput {
  return {
    workerId: 'w1',
    components: [
      { code: 'BASIC_SALARY', description: 'Basic salary', amountMinorUnits: 4_000_000 },
    ],
    periodWorkingDays: 20,
    employedWorkingDays: 20,
    unpaidLeaveDays: 0,
    absenceDays: 0,
    recurring: [],
    ...overrides,
  };
}

describe('componentItemType', () => {
  it('maps BASIC_SALARY and legacy BASE to itself, everything else to ALLOWANCE', () => {
    expect(componentItemType('BASIC_SALARY')).toBe('BASIC_SALARY');
    expect(componentItemType('BASE')).toBe('BASIC_SALARY');
    expect(componentItemType('HOUSING_ALLOWANCE')).toBe('ALLOWANCE');
  });
});

describe('prepareWorker', () => {
  it('pays a full-month worker with no leave or absence', () => {
    const result = prepareWorker(baseInput());
    expect(result.lines).toEqual([
      { itemType: 'BASIC_SALARY', description: 'Basic salary', amountMinorUnits: 4_000_000 },
    ]);
    expect(result.grossMinorUnits).toBe(4_000_000);
    expect(result.deductionsMinorUnits).toBe(0);
    expect(result.netMinorUnits).toBe(4_000_000);
  });

  it('prorates a mid-period joiner by employed working days', () => {
    const result = prepareWorker(baseInput({ employedWorkingDays: 10 }));
    expect(result.grossMinorUnits).toBe(2_000_000);
    expect(result.netMinorUnits).toBe(2_000_000);
  });

  it('prorates by unpaid-leave days (PAY-05)', () => {
    const result = prepareWorker(baseInput({ unpaidLeaveDays: 2 }));
    expect(result.grossMinorUnits).toBe(3_600_000);
  });

  it('applies joiner and unpaid-leave proration together', () => {
    const result = prepareWorker(
      baseInput({ employedWorkingDays: 10, unpaidLeaveDays: 2 }),
    );
    expect(result.grossMinorUnits).toBe(1_800_000);
  });

  it('deducts unexcused absences at the day rate (PAY-05)', () => {
    const result = prepareWorker(baseInput({ absenceDays: 2 }));
    expect(result.lines).toContainEqual({
      itemType: 'DEDUCTION',
      description: 'Unexcused absence',
      amountMinorUnits: -400_000,
    });
    expect(result.grossMinorUnits).toBe(4_000_000);
    expect(result.deductionsMinorUnits).toBe(400_000);
    expect(result.netMinorUnits).toBe(3_600_000);
  });

  it('caps the absence deduction at gross', () => {
    const result = prepareWorker(baseInput({ absenceDays: 30 }));
    expect(result.deductionsMinorUnits).toBe(4_000_000);
    expect(result.netMinorUnits).toBe(0);
  });

  it('adds a FIXED recurring deduction as a negative line', () => {
    const result = prepareWorker(
      baseInput({
        recurring: [
          {
            name: 'Salary advance',
            type: 'DEDUCTION',
            calculation: 'FIXED',
            amountMinorUnits: 25_000_00,
          },
        ],
      }),
    );
    expect(result.lines).toContainEqual({
      itemType: 'DEDUCTION',
      description: 'Salary advance',
      amountMinorUnits: -2_500_000,
    });
    expect(result.netMinorUnits).toBe(1_500_000);
  });

  it('computes PERCENTAGE recurring items from the PRORATED gross', () => {
    const result = prepareWorker(
      baseInput({
        employedWorkingDays: 10,
        recurring: [
          {
            name: 'Tax',
            type: 'TAX',
            calculation: 'PERCENTAGE',
            rateBps: 500,
          },
        ],
      }),
    );
    // 5% (500 bps) of the prorated gross (2 000 000), not of the full salary.
    expect(result.lines).toContainEqual({
      itemType: 'TAX',
      description: 'Tax',
      amountMinorUnits: -100_000,
    });
  });

  it('skips employer-side recurring items defensively', () => {
    const result = prepareWorker(
      baseInput({
        recurring: [
          {
            name: 'Employer pension',
            type: 'EMPLOYER_PENSION' as never,
            calculation: 'PERCENTAGE',
            rateBps: 1000,
          },
        ],
      }),
    );
    expect(result.lines).toHaveLength(1);
  });

  it('keeps earning lines at zero and omits zero deduction lines', () => {
    const result = prepareWorker(
      baseInput({
        components: [
          { code: 'BASIC_SALARY', description: 'Basic salary', amountMinorUnits: 0 },
        ],
      }),
    );
    expect(result.lines).toEqual([
      { itemType: 'BASIC_SALARY', description: 'Basic salary', amountMinorUnits: 0 },
    ]);
  });

  it('reconciles net to gross minus deductions on every path', () => {
    const result = prepareWorker(
      baseInput({
        absenceDays: 2,
        recurring: [
          { name: 'Tax', type: 'TAX', calculation: 'PERCENTAGE', rateBps: 1000 },
        ],
      }),
    );
    expect(result.netMinorUnits).toBe(
      result.grossMinorUnits - result.deductionsMinorUnits,
    );
  });
});

describe('runTotals', () => {
  it('sums workers to the smallest unit', () => {
    const a = prepareWorker(baseInput());
    const b = prepareWorker(
      baseInput({ workerId: 'w2', absenceDays: 2, employedWorkingDays: 10 }),
    );
    expect(runTotals([a, b])).toEqual({
      grossMinorUnits: 6_000_000,
      deductionsMinorUnits: 200_000,
      netMinorUnits: 5_800_000,
    });
  });
});

describe('reverseLines / foldWorkerLines', () => {
  it('mirrors signs so the reversal pays back exactly', () => {
    const original: PreparedLine[] = [
      { itemType: 'BASIC_SALARY', description: 'Basic salary', amountMinorUnits: 1_000_000 },
      { itemType: 'DEDUCTION', description: 'Tax', amountMinorUnits: -100_000 },
    ];
    expect(reverseLines(original)).toEqual([
      { itemType: 'BASIC_SALARY', description: 'Basic salary', amountMinorUnits: -1_000_000 },
      { itemType: 'DEDUCTION', description: 'Tax', amountMinorUnits: 100_000 },
    ]);
  });

  it('keeps the gross − deductions = net invariant on both directions', () => {
    const original = foldWorkerLines('w1', [
      { itemType: 'BASIC_SALARY', description: 'Basic salary', amountMinorUnits: 1_000_000 },
      { itemType: 'DEDUCTION', description: 'Tax', amountMinorUnits: -100_000 },
    ]);
    expect(original).toMatchObject({
      grossMinorUnits: 1_000_000,
      deductionsMinorUnits: 100_000,
      netMinorUnits: 900_000,
    });

    const reversed = foldWorkerLines(
      'w1',
      reverseLines(original.lines),
    );
    expect(reversed).toMatchObject({
      grossMinorUnits: -1_000_000,
      deductionsMinorUnits: -100_000,
      netMinorUnits: -900_000,
    });
    expect(reversed.netMinorUnits).toBe(
      reversed.grossMinorUnits - reversed.deductionsMinorUnits,
    );
    expect(reversed.netMinorUnits).toBe(-original.netMinorUnits);
  });
});
