import {
  DEFAULT_VALIDATION_THRESHOLDS,
  RunValidationInput,
  validateRun,
  WorkerValidationInput,
} from './run-validation';

function worker(
  overrides: Partial<WorkerValidationInput> = {},
): WorkerValidationInput {
  return {
    workerId: 'w1',
    identifier: 'E-001',
    hasCompensation: true,
    hasBankAccount: true,
    grossMinorUnits: 4_000_000,
    deductionMinorUnits: 400_000,
    netMinorUnits: 3_600_000,
    previousGrossMinorUnits: null,
    ...overrides,
  };
}

function input(overrides: Partial<RunValidationInput> = {}): RunValidationInput {
  return {
    workers: [worker()],
    itemCount: 3,
    duplicateRunExists: false,
    duplicateWorkerIds: [],
    thresholds: DEFAULT_VALIDATION_THRESHOLDS,
    ...overrides,
  };
}

describe('validateRun — blocking errors (PAY-08 / PAY-10)', () => {
  it('passes a healthy prepared run with no issues', () => {
    expect(validateRun(input())).toEqual({ errors: [], warnings: [] });
  });

  it('blocks a run with no prepared items', () => {
    const result = validateRun(input({ itemCount: 0 }));
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'NO_ITEMS' }),
    );
  });

  it('blocks a worker with no effective compensation record', () => {
    const result = validateRun(
      input({ workers: [worker({ hasCompensation: false })] }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'MISSING_SALARY', workerId: 'w1' }),
    );
  });

  it('blocks a worker with no bank account when requireBankDetails is on', () => {
    const result = validateRun(
      input({ workers: [worker({ hasBankAccount: false })] }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'MISSING_BANK_DETAILS', workerId: 'w1' }),
    );
  });

  it('does not block missing bank details when the org switched them off', () => {
    const result = validateRun(
      input({
        workers: [worker({ hasBankAccount: false })],
        thresholds: { ...DEFAULT_VALIDATION_THRESHOLDS, requireBankDetails: false },
      }),
    );
    expect(result.errors).toHaveLength(0);
  });

  it('blocks a duplicate run for the same calendar and period', () => {
    const result = validateRun(input({ duplicateRunExists: true }));
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_RUN' }),
    );
  });

  it('blocks duplicated worker rows', () => {
    const result = validateRun(input({ duplicateWorkerIds: ['w9'] }));
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_WORKER', workerId: 'w9' }),
    );
  });
});

describe('validateRun — ack-required warnings (PAY-10)', () => {
  it('warns when gross rises above the configured percentage', () => {
    const result = validateRun(
      input({
        workers: [
          worker({
            grossMinorUnits: 1_400_001,
            previousGrossMinorUnits: 1_000_000,
          }),
        ],
      }),
    );
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'SALARY_INCREASE', workerId: 'w1' }),
    );
  });

  it('does not warn at exactly the threshold', () => {
    const result = validateRun(
      input({
        workers: [
          worker({
            grossMinorUnits: 1_300_000,
            previousGrossMinorUnits: 1_000_000,
          }),
        ],
      }),
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('respects a custom salary-change threshold', () => {
    const result = validateRun(
      input({
        workers: [
          worker({
            grossMinorUnits: 1_200_000,
            previousGrossMinorUnits: 1_000_000,
          }),
        ],
        thresholds: { ...DEFAULT_VALIDATION_THRESHOLDS, salaryChangeWarnPct: 10 },
      }),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'SALARY_INCREASE' }),
    );
  });

  it('warns when deductions exceed the bps share of gross', () => {
    const result = validateRun(
      input({
        workers: [
          worker({
            grossMinorUnits: 1_000_000,
            deductionMinorUnits: 500_001,
            netMinorUnits: 499_999,
          }),
        ],
      }),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'HIGH_DEDUCTIONS', workerId: 'w1' }),
    );
  });

  it('does not warn at exactly the bps boundary', () => {
    const result = validateRun(
      input({
        workers: [
          worker({
            grossMinorUnits: 1_000_000,
            deductionMinorUnits: 500_000,
            netMinorUnits: 500_000,
          }),
        ],
      }),
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('warns on negative net pay', () => {
    const result = validateRun(
      input({
        workers: [
          worker({
            grossMinorUnits: 100_000,
            deductionMinorUnits: 200_000,
            netMinorUnits: -100_000,
          }),
        ],
      }),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'NEGATIVE_NET', workerId: 'w1' }),
    );
  });
});
