import { createHmac } from 'node:crypto';
import { safeEqualHex, safeEqualString, toMinorUnits } from './money.util';

describe('toMinorUnits', () => {
  it('converts whole major units to minor units', () => {
    expect(toMinorUnits(250)).toBe(25000);
    expect(toMinorUnits(0)).toBe(0);
  });

  it('converts fractional major units to minor units', () => {
    expect(toMinorUnits(0.01)).toBe(1);
  });

  it('rounds sub-ko-bo fractions to the nearest kobo', () => {
    expect(toMinorUnits(1.109)).toBe(111);
  });
});

describe('safeEqualHex', () => {
  function digest(secret: string): Buffer {
    return createHmac('sha512', secret).update('payload').digest();
  }

  it('returns true for a matching hex signature', () => {
    const d = digest('secret');
    expect(safeEqualHex(d.toString('hex'), d)).toBe(true);
  });

  it('returns false for a different signature', () => {
    expect(safeEqualHex(digest('other').toString('hex'), digest('secret'))).toBe(
      false,
    );
  });

  it('returns false on a length mismatch', () => {
    expect(safeEqualHex('abcd', digest('secret'))).toBe(false);
  });

  it('returns false for an empty signature', () => {
    expect(safeEqualHex('', digest('secret'))).toBe(false);
  });

  it('returns false for non-hex input', () => {
    expect(safeEqualHex('zzzz', digest('secret'))).toBe(false);
  });
});

describe('safeEqualString', () => {
  it('returns true for equal strings', () => {
    expect(safeEqualString('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(safeEqualString('abc', 'abd')).toBe(false);
  });

  it('returns false on a length mismatch', () => {
    expect(safeEqualString('abc', 'a')).toBe(false);
  });

  it('returns false for empty versus non-empty', () => {
    expect(safeEqualString('', 'a')).toBe(false);
  });
});