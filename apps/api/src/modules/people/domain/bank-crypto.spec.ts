import {
  decryptAccountNumber,
  encryptAccountNumber,
  maskAccountNumber,
} from './bank-crypto';

describe('bank-crypto', () => {
  it('round-trips an account number', () => {
    const enc = encryptAccountNumber('0123456789');
    expect(enc).not.toContain('0123456789');
    expect(decryptAccountNumber(enc)).toBe('0123456789');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptAccountNumber('0123456789');
    const b = encryptAccountNumber('0123456789');
    expect(a).not.toBe(b);
    expect(decryptAccountNumber(a)).toBe('0123456789');
    expect(decryptAccountNumber(b)).toBe('0123456789');
  });

  it('rejects a tampered payload (GCM auth tag)', () => {
    const enc = encryptAccountNumber('0123456789');
    const parts = enc.split(':');
    // Flip a byte in the ciphertext.
    const data = Buffer.from(parts[2] ?? '', 'base64');
    data[0] = (data[0] ?? 0) ^ 0xff;
    parts[2] = data.toString('base64');
    expect(() => decryptAccountNumber(parts.join(':'))).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptAccountNumber('nonsense')).toThrow();
  });
});

describe('maskAccountNumber', () => {
  it('shows only the last four digits', () => {
    expect(maskAccountNumber('0123456789')).toBe('****6789');
  });

  it('strips whitespace', () => {
    expect(maskAccountNumber('0123 456 789')).toBe('****6789');
  });
});
