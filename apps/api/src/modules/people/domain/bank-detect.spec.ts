import {
  NG_BANKS,
  detectBankFromAccountNumber,
  isNubanAccountNumber,
} from './bank-detect';

describe('isNubanAccountNumber', () => {
  it('accepts exactly 10 digits', () => {
    expect(isNubanAccountNumber('0123456789')).toBe(true);
  });

  it('rejects the wrong length or non-digits', () => {
    expect(isNubanAccountNumber('123456789')).toBe(false);
    expect(isNubanAccountNumber('01234567890')).toBe(false);
    expect(isNubanAccountNumber('01234abcde')).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isNubanAccountNumber('  0123456789 ')).toBe(true);
  });
});

describe('detectBankFromAccountNumber', () => {
  it('detects a known prefix (GTBank 058)', () => {
    const bank = detectBankFromAccountNumber('0581234567');
    expect(bank).not.toBeNull();
    expect(bank?.bankCode).toBe('058');
    expect(bank?.bankName).toBe('Guaranty Trust Bank');
  });

  it('returns null for an unmapped prefix', () => {
    // '777' is not in the conservative prefix table.
    expect(detectBankFromAccountNumber('7771234567')).toBeNull();
  });

  it('returns null for a malformed account number', () => {
    expect(detectBankFromAccountNumber('12345')).toBeNull();
  });

  it('only returns banks drawn from the static list', () => {
    const bank = detectBankFromAccountNumber('0441234567');
    expect(NG_BANKS).toContainEqual(bank);
  });
});
