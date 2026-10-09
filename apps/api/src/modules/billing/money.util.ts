// ─────────────────────────────────────────────────────────────────────────────
// MONEY + SIGNATURE HELPERS
// Pure functions shared by the billing flow. Kept dependency-free so they can be
// unit-tested in isolation. Money is always handled in minor units (kobo).
// ─────────────────────────────────────────────────────────────────────────────
import { timingSafeEqual } from 'node:crypto';

/** Convert a major-unit amount (e.g. 250.00) to minor units (25000). */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

/**
 * Constant-time comparison of a hex signature against a digest (Paystack).
 * Returns false on any length mismatch or non-hex input.
 */
export function safeEqualHex(signature: string, digest: Buffer): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return expected.length === digest.length && timingSafeEqual(expected, digest);
}

/** Constant-time plain-string comparison (Flutterwave verif-hash). */
export function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}