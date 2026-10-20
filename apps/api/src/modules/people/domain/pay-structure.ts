// ─────────────────────────────────────────────────────────────────────────────
// PAY STRUCTURE MATH (PRD PAY-01)
// Pure functions — no I/O. A worker's pay structure is a list of components
// (base salary + housing + transport + other allowances). The record's gross
// is ALWAYS the sum of its components; money is integer minor units.
// ─────────────────────────────────────────────────────────────────────────────

/** Machine code for the base-salary component synthesised from a legacy gross. */
export const BASE_CODE = 'BASE';

/** Hard cap on components per compensation record. */
export const MAX_COMPONENTS = 10;

/** Upper bound for a single component or a computed gross (Postgres Int4). */
export const MAX_MINOR_UNITS = 2_147_483_647;

export class PayStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayStructureError';
  }
}

/** True when the error is a client-input problem (map to a 400). */
export function isPayStructureError(error: unknown): error is PayStructureError {
  return error instanceof PayStructureError;
}

export interface PayComponent {
  code: string;
  label: string;
  amountMinorUnits: number;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,23}$/;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Validate a client-supplied component list. Returns human-readable errors
 * (empty array when valid). Codes must be unique uppercase machine codes;
 * amounts are non-negative integer minor units.
 */
export function validateComponents(components: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(components)) {
    return ['components must be an array'];
  }
  if (components.length === 0) {
    errors.push('components must not be empty');
    return errors;
  }
  if (components.length > MAX_COMPONENTS) {
    errors.push(`components must contain at most ${MAX_COMPONENTS} items`);
  }

  const seen = new Set<string>();
  components.forEach((raw, index) => {
    const at = `components[${index}]`;
    if (raw === null || typeof raw !== 'object') {
      errors.push(`${at} must be an object`);
      return;
    }
    const item = raw as Record<string, unknown>;
    const code = item['code'];
    const label = item['label'];
    const amount = item['amountMinorUnits'];

    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
      errors.push(
        `${at}.code must be an uppercase machine code (A-Z, 0-9, _, max 24 chars)`,
      );
    } else if (seen.has(code)) {
      errors.push(`${at}.code "${code}" is duplicated`);
    } else {
      seen.add(code);
    }

    if (typeof label !== 'string' || label.trim().length === 0 || label.length > 80) {
      errors.push(`${at}.label must be 1–80 characters`);
    }

    if (!isInt(amount) || amount < 0) {
      errors.push(`${at}.amountMinorUnits must be a non-negative integer`);
    } else if (amount > MAX_MINOR_UNITS) {
      errors.push(`${at}.amountMinorUnits exceeds the maximum`);
    }
  });

  if (errors.length === 0 && sumComponents(components as PayComponent[]) > MAX_MINOR_UNITS) {
    errors.push('the sum of components exceeds the maximum allowed amount');
  }

  return errors;
}

/** Sum of component amounts in integer minor units. */
export function sumComponents(components: readonly PayComponent[]): number {
  return components.reduce((total, c) => total + c.amountMinorUnits, 0);
}

/** The single BASE component a legacy (gross-only) record is read as. */
export function baseComponent(grossMinorUnits: number): PayComponent {
  return {
    code: BASE_CODE,
    label: 'Base salary',
    amountMinorUnits: Math.max(0, grossMinorUnits),
  };
}

/**
 * Read-side normalisation: stored components when present, otherwise a single
 * BASE component synthesised from the stored gross (legacy rows).
 */
export function normaliseComponents(
  stored: unknown,
  grossMinorUnits: number,
): PayComponent[] {
  if (Array.isArray(stored) && stored.length > 0) {
    return stored as PayComponent[];
  }
  return [baseComponent(grossMinorUnits)];
}

export interface GrossInput {
  components?: PayComponent[];
  grossAmountMinorUnits?: number;
}

/**
 * Resolve the gross a compensation record should be stored with.
 * - components only → their sum
 * - gross only (legacy) → that gross (a BASE component is synthesised on read)
 * - both → rejected when they disagree
 * - neither → rejected
 */
export function grossFromInput(input: GrossInput): number {
  const hasComponents =
    Array.isArray(input.components) && input.components.length > 0;
  const hasGross = isInt(input.grossAmountMinorUnits);

  if (!hasComponents && !hasGross) {
    throw new PayStructureError(
      'Either components or grossAmountMinorUnits must be provided',
    );
  }
  if (hasComponents && hasGross) {
    const sum = sumComponents(input.components!);
    if (sum !== input.grossAmountMinorUnits) {
      throw new PayStructureError(
        `grossAmountMinorUnits (${input.grossAmountMinorUnits}) must equal the sum of components (${sum})`,
      );
    }
    return sum;
  }
  if (hasComponents) return sumComponents(input.components!);
  return input.grossAmountMinorUnits!;
}
