// ─────────────────────────────────────────────────────────────────────────────
// RECURRING PAY ITEM MATH (PRD PAY-02 / PAY-03)
// Pure functions — no I/O. A recurring item is a per-worker deduction
// (org-defined, tax, pension, salary advance, cooperative…) or employer-side
// cost that recurs each pay period while it is in force. Amounts are integer
// minor units; percentages are basis points of period gross (500 = 5%).
//
// Statutory values are DATA configured by the organisation here — never
// hard-coded per country. The run engine (Phase 3 M2) applies the sign and
// the employee/employer partition derived from the item's type.
// ─────────────────────────────────────────────────────────────────────────────

export type PayItemCalculation = 'FIXED' | 'PERCENTAGE';

export interface RecurringPayItemInput {
  calculation: PayItemCalculation;
  /** FIXED: positive integer minor units. Must be null for PERCENTAGE. */
  amountMinorUnits?: number | null;
  /** PERCENTAGE: basis points of period gross (1–10000). Null for FIXED. */
  rateBps?: number | null;
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Validate the money fields of a recurring pay item. Returns human-readable
 * errors (empty array when valid). Exactly one of the two amount forms must
 * be set, matching `calculation`.
 */
export function validateRecurringItem(input: RecurringPayItemInput): string[] {
  const errors: string[] = [];
  const { calculation, amountMinorUnits, rateBps } = input;

  if (calculation === 'FIXED') {
    if (rateBps != null) {
      errors.push('rateBps must not be set when calculation is FIXED');
    }
    if (
      !isInt(amountMinorUnits) ||
      amountMinorUnits <= 0 ||
      amountMinorUnits > 2_147_483_647
    ) {
      errors.push(
        'amountMinorUnits must be a positive integer when calculation is FIXED',
      );
    }
  } else if (calculation === 'PERCENTAGE') {
    if (amountMinorUnits != null) {
      errors.push('amountMinorUnits must not be set when calculation is PERCENTAGE');
    }
    if (!isInt(rateBps) || rateBps < 1 || rateBps > 10_000) {
      errors.push(
        'rateBps must be an integer between 1 and 10000 when calculation is PERCENTAGE',
      );
    }
  } else {
    errors.push('calculation must be FIXED or PERCENTAGE');
  }

  return errors;
}

/**
 * The amount this item contributes to one pay period, as a POSITIVE magnitude
 * in integer minor units. FIXED returns the stored amount; PERCENTAGE returns
 * `round(gross × rateBps / 10000)` (half rounds up), never negative.
 */
export function recurringItemAmountMinor(
  input: RecurringPayItemInput,
  grossMinorUnits: number,
): number {
  const gross = Math.max(0, Math.round(grossMinorUnits));
  if (input.calculation === 'FIXED') {
    return Math.max(0, input.amountMinorUnits ?? 0);
  }
  const rateBps = input.rateBps ?? 0;
  return Math.max(0, Math.round((gross * rateBps) / 10_000));
}
