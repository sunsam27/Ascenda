// ─────────────────────────────────────────────────────────────────────────────
// YEAR-END STATEMENTS & REMITTANCE SCHEDULES (PRD PAY-16)
// Pure functions — no I/O, no hard-coded statutory values. Statements roll up
// the payslips a run already froze; remittance schedules re-group the statutory
// lines those payslips carry. The engine only aggregates configuration-driven
// data; it never invents a rate, band or scheme, per CLAUDE.md.
//
// All maths is integer minor units, matching the rest of the payroll module.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PayrollItemType,
  type PayslipLine,
  type RemittanceLine,
  type StatutoryItemType,
  type StatutoryRuleSide,
  type YearEndLine,
} from '@ascenda/types';

/** The statutory item types that appear on a remittance schedule. */
const STATUTORY_ITEM_TYPES: ReadonlySet<PayrollItemType> = new Set([
  PayrollItemType.TAX,
  PayrollItemType.EMPLOYEE_PENSION,
  PayrollItemType.EMPLOYER_PENSION,
]);

// ── Tax-year window ──────────────────────────────────────────────────────────

export interface TaxYearWindow {
  /** Label, e.g. "2026" or "2026/2027" for a non-calendar tax year. */
  label: string;
  /** Inclusive start (local midnight, UTC). */
  start: Date;
  /** Exclusive end (local midnight, UTC). */
  endExclusive: Date;
  year: number;
  startMonth: number;
}

/**
 * Resolve the tax-year window that starts in `year`, given the organisation's
 * configured start month (1 = January). A start month of 1 is a plain calendar
 * year ("2026"); anything else spans two years ("2026/2027"). Ascenda never
 * assumes a statutory year boundary — it is configuration data (LOC-02).
 */
export function resolveTaxYear(year: number, startMonth: number): TaxYearWindow {
  const month = Math.min(12, Math.max(1, Math.trunc(startMonth)));
  const start = new Date(Date.UTC(year, month - 1, 1));
  const endExclusive = new Date(Date.UTC(year + 1, month - 1, 1));
  const label =
    month === 1 ? String(year) : `${year}/${String(year + 1).padStart(4, '0')}`;
  return { label, start, endExclusive, year, startMonth: month };
}

/** True when a date falls inside [start, endExclusive). */
export function withinTaxYear(iso: string, window: TaxYearWindow): boolean {
  const t = new Date(iso).getTime();
  return t >= window.start.getTime() && t < window.endExclusive.getTime();
}

// ── Year-end statement aggregation ───────────────────────────────────────────

/** The payslip facts the aggregator needs (a projection of the stored row). */
export interface StatementPayslipInput {
  periodStart: string;
  currency: string;
  grossMinorUnits: number;
  deductionsMinorUnits: number;
  employerCostsMinorUnits: number;
  netMinorUnits: number;
  lines: PayslipLine[];
}

export interface StatementTotals {
  currency: string;
  grossMinorUnits: number;
  deductionsMinorUnits: number;
  employerCostsMinorUnits: number;
  netMinorUnits: number;
  lines: YearEndLine[];
  payslipCount: number;
}

/**
 * Roll a worker's payslips into one annual statement. Lines are summed per
 * `type` + `description` so the statement shows annual totals per pay element.
 * Amounts are integer minor units; the currency is taken from the first payslip
 * (multi-currency is PAY-15, deferred).
 */
export function aggregateStatement(
  payslips: StatementPayslipInput[],
): StatementTotals {
  let gross = 0;
  let deductions = 0;
  let employerCosts = 0;
  let net = 0;
  const currency = payslips[0]?.currency ?? '';

  const byKey = new Map<string, YearEndLine>();
  for (const slip of payslips) {
    gross += slip.grossMinorUnits;
    deductions += slip.deductionsMinorUnits;
    employerCosts += slip.employerCostsMinorUnits;
    net += slip.netMinorUnits;
    for (const line of slip.lines) {
      const key = `${line.type}\u0000${line.description}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.amountMinorUnits += line.amountMinorUnits;
      } else {
        byKey.set(key, {
          type: line.type,
          description: line.description,
          amountMinorUnits: line.amountMinorUnits,
        });
      }
    }
  }

  // Earnings first (largest first), then deductions — stable, readable order.
  const lines = [...byKey.values()].sort((a, b) => {
    const aEarning = a.amountMinorUnits >= 0 ? 0 : 1;
    const bEarning = b.amountMinorUnits >= 0 ? 0 : 1;
    if (aEarning !== bEarning) return aEarning - bEarning;
    return Math.abs(b.amountMinorUnits) - Math.abs(a.amountMinorUnits);
  });

  return {
    currency,
    grossMinorUnits: gross,
    deductionsMinorUnits: deductions,
    employerCostsMinorUnits: employerCosts,
    netMinorUnits: net,
    lines,
    payslipCount: payslips.length,
  };
}

// ── Remittance schedule aggregation ──────────────────────────────────────────

/** A pack contributes its validation flag so the schedule can surface LOC-03. */
export interface RemittancePackInput {
  validated: boolean;
  /**
   * Employer-side rule labels from the pack. Employer statutory costs are not
   * stored as payslip lines (they live on `employerCostsMinorUnits`), so the
   * schedule uses these labels to name the aggregated employer line.
   */
  employerLabels?: string[];
}

/**
 * Group the statutory lines across the year's payslips. Employee-side lines are
 * negative on a payslip (a deduction) and are grouped per rule; employer-side
 * cost is not a payslip line — it is the per-payslip `employerCostsMinorUnits`
 * (M3 boundary) — so it is summed and surfaced as a single employer line.
 * Amounts are returned as positive magnitudes, split by side.
 */
export function aggregateRemittance(
  payslips: StatementPayslipInput[],
  packs: RemittancePackInput[],
): {
  employeeTotalMinorUnits: number;
  employerTotalMinorUnits: number;
  lines: RemittanceLine[];
  validatedByProfessional: boolean;
} {
  const byKey = new Map<string, RemittanceLine>();
  let employeeTotal = 0;
  let employerTotal = 0;

  for (const slip of payslips) {
    for (const line of slip.lines) {
      if (!STATUTORY_ITEM_TYPES.has(line.type)) continue;
      // Employer pension is a workforce cost, never a payslip deduction line;
      // any such line here is employee-facing, so only TAX + EMPLOYEE_PENSION
      // contribute to the employee side.
      if (line.type === PayrollItemType.EMPLOYER_PENSION) continue;
      const magnitude = Math.abs(line.amountMinorUnits);
      if (magnitude === 0) continue;
      employeeTotal += magnitude;

      const key = `${line.type}\u0000${line.description}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.amountMinorUnits += magnitude;
      } else {
        byKey.set(key, {
          code: line.description,
          label: line.description,
          itemType: line.type as unknown as StatutoryItemType,
          side: 'EMPLOYEE',
          amountMinorUnits: magnitude,
        });
      }
    }
    if (slip.employerCostsMinorUnits > 0) {
      employerTotal += slip.employerCostsMinorUnits;
    }
  }

  const lines = [...byKey.values()].sort((a, b) => {
    if (a.side !== b.side) return a.side === 'EMPLOYEE' ? -1 : 1;
    return b.amountMinorUnits - a.amountMinorUnits;
  });

  if (employerTotal > 0) {
    const labels = [
      ...new Set(
        packs.flatMap((p) => p.employerLabels ?? []).filter((l) => l.length > 0),
      ),
    ];
    const label = labels.length > 0 ? labels.join(', ') : 'Employer contributions';
    lines.push({
      code: label,
      label,
      itemType: 'EMPLOYER_PENSION' as StatutoryItemType,
      side: 'EMPLOYER',
      amountMinorUnits: employerTotal,
    });
  }

  return {
    employeeTotalMinorUnits: employeeTotal,
    employerTotalMinorUnits: employerTotal,
    lines,
    validatedByProfessional: packs.length > 0 && packs.every((p) => p.validated),
  };
}

// ── Year-end statement CSV ───────────────────────────────────────────────────

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Render minor units as a plain decimal string (e.g. 123456 → "1234.56"). */
export function minorUnitsToDecimal(amountMinorUnits: number): string {
  const sign = amountMinorUnits < 0 ? '-' : '';
  const abs = Math.abs(amountMinorUnits);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const REMITTANCE_COLUMNS = [
  'tax_year',
  'scheme',
  'side',
  'item_type',
  'amount',
  'currency',
] as const;

export interface RemittanceCsvRow {
  taxYearLabel: string;
  scheme: string;
  side: StatutoryRuleSide;
  itemType: string;
  amountMinorUnits: number;
  currency: string;
}

/** RFC 4180 CSV with CRLF endings and a UTF-8 BOM (mirrors payment export). */
export function buildRemittanceCsv(rows: RemittanceCsvRow[]): string {
  const lines: string[] = [REMITTANCE_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.taxYearLabel,
        row.scheme,
        row.side,
        row.itemType,
        minorUnitsToDecimal(row.amountMinorUnits),
        row.currency,
      ]
        .map((value) => csvField(String(value ?? '')))
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
