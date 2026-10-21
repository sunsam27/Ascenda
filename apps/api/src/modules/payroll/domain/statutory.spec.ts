import {
  applyStatutoryToWorker,
  percentBandsAmount,
  ruleAmountMinor,
  ruleBaseMinor,
  StatutoryRule,
  WorkerStatutoryInput,
} from './statutory';

const input: WorkerStatutoryInput = {
  workerId: 'w1',
  grossMinorUnits: 1_000_000,
  basicSalaryMinorUnits: 600_000,
};

describe('statutory engine (PAY-12 / LOC-02)', () => {
  it('resolves the rule base from the worker pay components', () => {
    expect(ruleBaseMinor('GROSS', input)).toBe(1_000_000);
    expect(ruleBaseMinor('BASIC_SALARY', input)).toBe(600_000);
    expect(ruleBaseMinor('TAXABLE', input)).toBe(1_000_000);
    expect(ruleBaseMinor('PENSIONABLE', input)).toBe(1_000_000);
  });

  it('FLAT returns the configured amount, never an invented one', () => {
    const rule: StatutoryRule = {
      code: 'LEVY',
      label: 'Health Levy',
      kind: 'FLAT',
      base: 'GROSS',
      side: 'EMPLOYEE',
      itemType: 'DEDUCTION',
      amountMinorUnits: 2500,
    };
    expect(ruleAmountMinor(rule, input)).toBe(2500);
  });

  it('PERCENT_CAPPED applies rate then caps the amount', () => {
    const uncapped: StatutoryRule = {
      code: 'PENSION',
      label: 'Pension',
      kind: 'PERCENT_CAPPED',
      base: 'GROSS',
      side: 'EMPLOYEE',
      itemType: 'EMPLOYEE_PENSION',
      rateBps: 800,
      capMinorUnits: null,
    };
    expect(ruleAmountMinor(uncapped, input)).toBe(80_000);

    const capped: StatutoryRule = { ...uncapped, capMinorUnits: 50_000 };
    expect(ruleAmountMinor(capped, input)).toBe(50_000);
  });

  it('PERCENT_CAPPED honours a base floor', () => {
    const rule: StatutoryRule = {
      code: 'PENSION',
      label: 'Pension',
      kind: 'PERCENT_CAPPED',
      base: 'GROSS',
      side: 'EMPLOYEE',
      itemType: 'EMPLOYEE_PENSION',
      rateBps: 1000,
      baseFloorMinorUnits: 200_000,
      capMinorUnits: null,
    };
    // (1_000_000 - 200_000) * 10% = 80_000
    expect(ruleAmountMinor(rule, input)).toBe(80_000);
  });

  it('PERCENT_BANDS taxes only the slice inside each band (progressive)', () => {
    const bands = [
      { upToMinorUnits: 300_000, rateBps: 0 },
      { upToMinorUnits: 600_000, rateBps: 1000 },
      { upToMinorUnits: null, rateBps: 2000 },
    ];
    // 0 for first 300k, 10% of (600k-300k)=30k, 20% of (1m-600k)=80k → 110k
    expect(percentBandsAmount(1_000_000, bands)).toBe(110_000);
  });

  it('PERCENT_BANDS sorts unordered bands ascending', () => {
    const bands = [
      { upToMinorUnits: null, rateBps: 2000 },
      { upToMinorUnits: 600_000, rateBps: 1000 },
      { upToMinorUnits: 300_000, rateBps: 0 },
    ];
    expect(percentBandsAmount(1_000_000, bands)).toBe(110_000);
  });

  it('applies employee rules as negative lines and employer rules separately', () => {
    const rules: StatutoryRule[] = [
      {
        code: 'PAYE',
        label: 'Income Tax',
        kind: 'PERCENT_CAPPED',
        base: 'GROSS',
        side: 'EMPLOYEE',
        itemType: 'TAX',
        rateBps: 1000,
        capMinorUnits: null,
      },
      {
        code: 'ER_PENSION',
        label: 'Employer Pension',
        kind: 'PERCENT_CAPPED',
        base: 'GROSS',
        side: 'EMPLOYER',
        itemType: 'EMPLOYER_PENSION',
        rateBps: 1000,
        capMinorUnits: null,
      },
    ];
    const applied = applyStatutoryToWorker('w1', input, rules);
    expect(applied.employeeMinorUnits).toBe(100_000);
    expect(applied.employerMinorUnits).toBe(100_000);

    const tax = applied.lines.find((l) => l.code === 'PAYE')!;
    expect(tax.amountMinorUnits).toBe(-100_000);
    const employer = applied.lines.find((l) => l.code === 'ER_PENSION')!;
    expect(employer.amountMinorUnits).toBe(100_000);
  });

  it('emits no line for a rule that computes zero', () => {
    const rules: StatutoryRule[] = [
      {
        code: 'ZERO',
        label: 'Zero',
        kind: 'FLAT',
        base: 'GROSS',
        side: 'EMPLOYEE',
        itemType: 'DEDUCTION',
        amountMinorUnits: 0,
      },
    ];
    expect(applyStatutoryToWorker('w1', input, rules).lines).toHaveLength(0);
  });
});
