// ─────────────────────────────────────────────────────────────────────────────
// STATUTORY RULE-PACK ENGINE (PRD PAY-12 / LOC-02 / LOC-03)
// Pure functions — no I/O, no hard-coded statutory values. Every rate, band and
// cap comes from the organisation-supplied pack (rules-as-data). The engine only
// interprets the configuration; it never invents a number, per CLAUDE.md.
//
// All maths is integer minor units. Percentages are basis points (500 = 5%) and
// rounded half-up, matching the rest of the payroll module.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type StatutoryBand,
  type StatutoryRule,
  type StatutoryRuleBase,
  type StatutoryRuleKind,
  type StatutoryRuleSide,
} from '@ascenda/types';

export type {
  StatutoryBand,
  StatutoryRule,
  StatutoryRuleBase,
  StatutoryRuleKind,
  StatutoryRuleSide,
} from '@ascenda/types';

/** Item types a statutory rule may produce. */
export type StatutoryItemType =
  | 'DEDUCTION'
  | 'TAX'
  | 'EMPLOYEE_PENSION'
  | 'EMPLOYER_PENSION';

export interface WorkerStatutoryInput {
  workerId: string;
  grossMinorUnits: number;
  basicSalaryMinorUnits: number;
}

export interface StatutoryLine {
  code: string;
  itemType: StatutoryItemType;
  description: string;
  /** Signed minor units: negative for employee-side, positive for employer-side
   * (employer costs are a cost, not a pay deduction — kept separate by callers). */
  amountMinorUnits: number;
}

export interface AppliedStatutoryRule {
  workerId: string;
  lines: StatutoryLine[];
  /** Employee-side total (positive magnitude). */
  employeeMinorUnits: number;
  /** Employer-side total (positive magnitude). */
  employerMinorUnits: number;
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function applyBps(baseMinorUnits: number, rateBps: number): number {
  return roundHalfUp((baseMinorUnits * rateBps) / 10_000);
}

/** The base a rule applies to, from the worker's pay components. */
export function ruleBaseMinor(
  base: StatutoryRuleBase,
  input: WorkerStatutoryInput,
): number {
  switch (base) {
    case 'GROSS':
      return input.grossMinorUnits;
    case 'BASIC_SALARY':
      return input.basicSalaryMinorUnits;
    // TAXABLE/PENSIONABLE default to gross until the pack distinguishes them;
    // the distinction itself is configured data, not an assumption here.
    case 'TAXABLE':
    case 'PENSIONABLE':
      return input.grossMinorUnits;
    default:
      return 0;
  }
}

/**
 * Progressive bands: each band taxes only the slice of base within it. Bands are
 * sorted ascending; a `null` upper bound terminates the schedule.
 */
export function percentBandsAmount(
  baseMinorUnits: number,
  bands: StatutoryBand[],
): number {
  const base = Math.max(0, Math.round(baseMinorUnits));
  const ordered = [...bands].sort((a, b) => {
    if (a.upToMinorUnits == null) return 1;
    if (b.upToMinorUnits == null) return -1;
    return a.upToMinorUnits - b.upToMinorUnits;
  });

  let total = 0;
  let lower = 0;
  for (const band of ordered) {
    if (base <= lower) break;
    const upper = band.upToMinorUnits == null ? base : band.upToMinorUnits;
    const slice = Math.max(0, Math.min(base, upper) - lower);
    if (slice > 0) total += applyBps(slice, band.rateBps);
    lower = upper;
  }
  return total;
}

/** Compute one rule's amount (positive magnitude) for a worker. */
export function ruleAmountMinor(
  rule: StatutoryRule,
  input: WorkerStatutoryInput,
): number {
  const base = ruleBaseMinor(rule.base, input);
  switch (rule.kind) {
    case 'FLAT':
      return Math.max(0, Math.round(rule.amountMinorUnits ?? 0));
    case 'PERCENT_CAPPED': {
      const floor = Math.max(0, Math.round(rule.baseFloorMinorUnits ?? 0));
      const taxable = Math.max(0, base - floor);
      const raw = applyBps(taxable, rule.rateBps ?? 0);
      const cap = rule.capMinorUnits;
      return cap == null ? raw : Math.min(raw, Math.max(0, Math.round(cap)));
    }
    case 'PERCENT_BANDS':
      return percentBandsAmount(base, rule.bands ?? []);
    default:
      return 0;
  }
}

const STATUTORY_KINDS: StatutoryRuleKind[] = [
  'PERCENT_BANDS',
  'FLAT',
  'PERCENT_CAPPED',
];
const STATUTORY_BASES: StatutoryRuleBase[] = [
  'GROSS',
  'BASIC_SALARY',
  'TAXABLE',
  'PENSIONABLE',
];
const STATUTORY_SIDES: StatutoryRuleSide[] = ['EMPLOYEE', 'EMPLOYER'];
const STATUTORY_ITEM_TYPES: StatutoryItemType[] = [
  'DEDUCTION',
  'TAX',
  'EMPLOYEE_PENSION',
  'EMPLOYER_PENSION',
];

/**
 * Structural validation of one rule — configuration only, never a statutory
 * value. Returns human-readable problems (empty = valid).
 */
export function validateRule(rule: Partial<StatutoryRule>, index: number): string[] {
  const errors: string[] = [];
  const prefix = `rules[${index}]`;
  if (!rule.code || rule.code.trim().length === 0) {
    errors.push(`${prefix}.code is required`);
  }
  if (!rule.label || rule.label.trim().length === 0) {
    errors.push(`${prefix}.label is required`);
  }
  if (!rule.kind || !STATUTORY_KINDS.includes(rule.kind)) {
    errors.push(`${prefix}.kind is invalid`);
  }
  if (!rule.base || !STATUTORY_BASES.includes(rule.base)) {
    errors.push(`${prefix}.base is invalid`);
  }
  if (!rule.side || !STATUTORY_SIDES.includes(rule.side)) {
    errors.push(`${prefix}.side is invalid`);
  }
  if (!rule.itemType || !STATUTORY_ITEM_TYPES.includes(rule.itemType)) {
    errors.push(`${prefix}.itemType is invalid`);
  }

  if (rule.kind === 'PERCENT_BANDS') {
    if (!rule.bands || rule.bands.length === 0) {
      errors.push(`${prefix}.bands is required for PERCENT_BANDS`);
    }
  }
  if (rule.kind === 'FLAT' && rule.amountMinorUnits == null) {
    errors.push(`${prefix}.amountMinorUnits is required for FLAT`);
  }
  if (rule.kind === 'PERCENT_CAPPED' && rule.rateBps == null) {
    errors.push(`${prefix}.rateBps is required for PERCENT_CAPPED`);
  }
  return errors;
}

/** Validate a whole pack (code uniqueness + per-rule structure). */
export function validatePackRules(rules: Partial<StatutoryRule>[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    errors.push(...validateRule(rule, index));
    const code = rule.code?.trim();
    if (code) {
      if (seen.has(code)) errors.push(`Duplicate rule code "${code}"`);
      seen.add(code);
    }
  });
  return errors;
}

/**
 * Apply every rule in the pack to one worker. Employee-side rules become
 * negative pay lines; employer-side rules are returned separately (they are a
 * workforce cost, not a deduction). Zero-amount rules emit no line.
 */
export function applyStatutoryToWorker(
  workerId: string,
  input: WorkerStatutoryInput,
  rules: StatutoryRule[],
): AppliedStatutoryRule {
  const lines: StatutoryLine[] = [];
  let employee = 0;
  let employer = 0;
  for (const rule of rules) {
    const amount = ruleAmountMinor(rule, input);
    if (amount <= 0) continue;
    if (rule.side === 'EMPLOYER') {
      employer += amount;
      lines.push({
        code: rule.code,
        itemType: rule.itemType,
        description: rule.label,
        amountMinorUnits: amount,
      });
    } else {
      employee += amount;
      lines.push({
        code: rule.code,
        itemType: rule.itemType,
        description: rule.label,
        amountMinorUnits: -amount,
      });
    }
  }
  return { workerId, lines, employeeMinorUnits: employee, employerMinorUnits: employer };
}
