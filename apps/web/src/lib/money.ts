// ─────────────────────────────────────────────────────────────────────────────
// Money helpers — integer minor units only. Amounts are stored in the API as
// whole kobo (or cents); nothing here ever puts a pay figure through a float.
// ─────────────────────────────────────────────────────────────────────────────

const SYMBOLS: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  GBP: '£',
  EUR: '€',
  GHS: 'GH₵',
  KES: 'KSh',
  ZAR: 'R',
  XOF: 'F',
  XAF: 'FCFA',
};

/** Symbol (or bare code with a trailing space) for an ISO 4217 code. */
export function currencySymbol(code: string): string {
  return SYMBOLS[code.toUpperCase()] ?? `${code.toUpperCase()} `;
}

/**
 * Parse a user-typed major-unit amount ("1,250.50") into integer minor units,
 * or null when the text is not a valid non-negative amount. Parsing is done on
 * the string so "0.1 + 0.2" can never appear in a pay figure.
 */
export function toMinorUnits(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const digits = `${whole}${fraction.padEnd(2, '0')}`;
  const minor = Number(digits);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units → "1250.50" (the value an input field shows). */
export function toMajorUnits(minor: number): string {
  const padded = String(Math.trunc(Math.abs(minor))).padStart(3, '0');
  const head = padded.slice(0, padded.length - 2);
  const tail = padded.slice(-2);
  return `${minor < 0 ? '-' : ''}${head}.${tail}`;
}

/** Minor units → "₦650,000.00" for display. */
export function formatMinorUnits(minor: number, currency: string): string {
  const padded = String(Math.trunc(Math.abs(minor))).padStart(3, '0');
  const head = padded
    .slice(0, padded.length - 2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = padded.slice(-2);
  const sign = minor < 0 ? '-' : '';
  return `${sign}${currencySymbol(currency)}${head}.${tail}`;
}
