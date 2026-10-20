import {
  BASE_CODE,
  MAX_COMPONENTS,
  MAX_MINOR_UNITS,
  baseComponent,
  grossFromInput,
  isPayStructureError,
  normaliseComponents,
  sumComponents,
  validateComponents,
} from './pay-structure';

// PRD PAY-01 example: ₦500,000 + ₦100,000 + ₦50,000 + ₦25,000 = ₦675,000 gross.
const PRD_EXAMPLE = [
  { code: 'BASE', label: 'Base salary', amountMinorUnits: 50_000_000 },
  { code: 'HOUSING', label: 'Housing allowance', amountMinorUnits: 10_000_000 },
  { code: 'TRANSPORT', label: 'Transport allowance', amountMinorUnits: 5_000_000 },
  { code: 'OTHER', label: 'Other allowance', amountMinorUnits: 2_500_000 },
];

describe('validateComponents', () => {
  it('accepts the PRD pay-structure example (PAY-01)', () => {
    expect(validateComponents(PRD_EXAMPLE)).toEqual([]);
  });

  it('rejects a non-array', () => {
    expect(validateComponents({ code: 'BASE' })).toEqual([
      'components must be an array',
    ]);
  });

  it('rejects an empty list', () => {
    expect(validateComponents([])).toEqual(['components must not be empty']);
  });

  it('rejects more than the maximum number of components', () => {
    const many = Array.from({ length: MAX_COMPONENTS + 1 }, (_, i) => ({
      code: `C${i}`,
      label: `Component ${i}`,
      amountMinorUnits: 1,
    }));
    expect(validateComponents(many)).toEqual([
      `components must contain at most ${MAX_COMPONENTS} items`,
    ]);
  });

  it('rejects lowercase or malformed codes', () => {
    const errors = validateComponents([
      { code: 'base', label: 'Base', amountMinorUnits: 1 },
    ]);
    expect(errors[0]).toContain('components[0].code');
  });

  it('rejects duplicate codes', () => {
    const errors = validateComponents([
      { code: 'BASE', label: 'Base', amountMinorUnits: 1 },
      { code: 'BASE', label: 'Base again', amountMinorUnits: 2 },
    ]);
    expect(errors).toEqual(['components[1].code "BASE" is duplicated']);
  });

  it('rejects blank labels and labels over 80 characters', () => {
    const errors = validateComponents([
      { code: 'BASE', label: '   ', amountMinorUnits: 1 },
      { code: 'Housing', label: 'x'.repeat(81), amountMinorUnits: 1 },
    ]);
    expect(errors).toContain('components[0].label must be 1–80 characters');
    expect(errors).toContain('components[1].label must be 1–80 characters');
  });

  it('rejects negative and fractional amounts', () => {
    const errors = validateComponents([
      { code: 'BASE', label: 'Base', amountMinorUnits: -1 },
      { code: 'HOUSING', label: 'Housing', amountMinorUnits: 10.5 },
    ]);
    expect(errors).toEqual([
      'components[0].amountMinorUnits must be a non-negative integer',
      'components[1].amountMinorUnits must be a non-negative integer',
    ]);
  });

  it('rejects a sum above the integer money ceiling', () => {
    const errors = validateComponents([
      { code: 'BASE', label: 'Base', amountMinorUnits: MAX_MINOR_UNITS },
      { code: 'HOUSING', label: 'Housing', amountMinorUnits: 1 },
    ]);
    expect(errors).toEqual([
      'the sum of components exceeds the maximum allowed amount',
    ]);
  });
});

describe('sumComponents', () => {
  it('sums the PRD example to ₦675,000 in kobo', () => {
    expect(sumComponents(PRD_EXAMPLE)).toBe(67_500_000);
  });

  it('is zero for an empty list', () => {
    expect(sumComponents([])).toBe(0);
  });
});

describe('baseComponent / normaliseComponents', () => {
  it('builds a BASE component from a gross', () => {
    expect(baseComponent(50_000_000)).toEqual({
      code: BASE_CODE,
      label: 'Base salary',
      amountMinorUnits: 50_000_000,
    });
  });

  it('never returns a negative amount', () => {
    expect(baseComponent(-5).amountMinorUnits).toBe(0);
  });

  it('prefers stored components when present', () => {
    expect(normaliseComponents(PRD_EXAMPLE, 1)).toEqual(PRD_EXAMPLE);
  });

  it('synthesises BASE for legacy rows with null components', () => {
    expect(normaliseComponents(null, 50_000_000)).toEqual([
      baseComponent(50_000_000),
    ]);
  });
});

describe('grossFromInput', () => {
  it('computes the gross from components alone (PAY-01)', () => {
    expect(grossFromInput({ components: PRD_EXAMPLE })).toBe(67_500_000);
  });

  it('accepts a legacy gross alone and returns it unchanged', () => {
    expect(grossFromInput({ grossAmountMinorUnits: 67_500_000 })).toBe(
      67_500_000,
    );
  });

  it('accepts components plus a matching gross', () => {
    expect(
      grossFromInput({
        components: PRD_EXAMPLE,
        grossAmountMinorUnits: 67_500_000,
      }),
    ).toBe(67_500_000);
  });

  it('rejects a gross that disagrees with the component sum', () => {
    expect(() =>
      grossFromInput({
        components: PRD_EXAMPLE,
        grossAmountMinorUnits: 1,
      }),
    ).toThrow(
      'grossAmountMinorUnits (1) must equal the sum of components (67500000)',
    );
  });

  it('rejects an empty input', () => {
    expect(() => grossFromInput({})).toThrow(
      'Either components or grossAmountMinorUnits must be provided',
    );
  });

  it('marks its errors as client-input problems', () => {
    try {
      grossFromInput({});
    } catch (error) {
      expect(isPayStructureError(error)).toBe(true);
    }
  });
});
