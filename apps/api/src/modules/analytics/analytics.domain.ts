import { BadRequestException } from '@nestjs/common';
import type {
  AnalyticsLeaveTypeBreakdown,
  AnalyticsPayDistributionMonth,
  AnalyticsPayrollMonth,
  AnalyticsRetention,
  AnalyticsTenure,
} from '@ascenda/types';

export const MINIMUM_COHORT = 5;

export function retentionSummary(eligible: number, retained: number): AnalyticsRetention {
  if (eligible < MINIMUM_COHORT)
    return { suppressed: true, eligible: null, retained: null, ratePercent: null };
  return {
    suppressed: false,
    eligible,
    retained,
    ratePercent: Math.round((retained / eligible) * 1000) / 10,
  };
}

function wholeMonthsBetween(start: Date, end: Date): number {
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Period-end tenure from recorded start/last-working dates; no historical assignment changes. */
export function tenureSummary(
  rows: { startDate: Date; endDate: Date | null }[],
  periodEnd: Date,
): AnalyticsTenure {
  if (rows.length < MINIMUM_COHORT)
    return { suppressed: true, averageMonths: null, bands: [] };
  const bands = [
    { label: 'Under 1 year', count: 0 },
    { label: '1 to 3 years', count: 0 },
    { label: '3 to 5 years', count: 0 },
    { label: '5 years or more', count: 0 },
  ];
  let months = 0;
  for (const row of rows) {
    const effectiveEnd = row.endDate && row.endDate < periodEnd ? row.endDate : periodEnd;
    const value = wholeMonthsBetween(row.startDate, effectiveEnd);
    months += value;
    bands[value < 12 ? 0 : value < 36 ? 1 : value < 60 ? 2 : 3]!.count += 1;
  }
  return { suppressed: false, averageMonths: Math.round((months / rows.length) * 10) / 10, bands };
}

export function overviewPeriod(from?: string, to?: string, now = new Date()) {
  const last = to ?? now.toISOString().slice(0, 10);
  const first = from ?? `${last.slice(0, 4)}-01-01`;
  const start = new Date(`${first}T00:00:00.000Z`);
  const end = new Date(`${last}T00:00:00.000Z`);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start.toISOString().slice(0, 10) !== first ||
    end.toISOString().slice(0, 10) !== last ||
    end < start ||
    end.getTime() - start.getTime() > 365 * 86_400_000
  ) {
    throw new BadRequestException('Choose a valid date range of at most 366 days');
  }
  return { from: first, to: last, start, endExclusive: new Date(end.getTime() + 86_400_000) };
}

export interface LeaveTypeAggregate {
  leaveTypeId: string | null;
  label: string;
  category: string;
  workerId: string;
  days: number;
}

/** No reasons or medical details are read; small leave-type cohorts are hidden independently. */
export function leaveTypeBreakdown(rows: LeaveTypeAggregate[]): AnalyticsLeaveTypeBreakdown[] {
  const groups = new Map<
    string,
    { label: string; category: string; workers: Set<string>; requests: number; days: number }
  >();
  for (const row of rows) {
    const key = row.leaveTypeId ?? 'unassigned';
    const group = groups.get(key) ?? {
      label: row.label,
      category: row.category,
      workers: new Set<string>(),
      requests: 0,
      days: 0,
    };
    group.workers.add(row.workerId);
    group.requests += 1;
    group.days += row.days;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([id, group]) => ({
      label: group.label,
      category: group.category,
      requests: group.workers.size < MINIMUM_COHORT ? null : group.requests,
      approvedDays: group.workers.size < MINIMUM_COHORT ? null : group.days,
      suppressed: group.workers.size < MINIMUM_COHORT,
      id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ id: _id, ...row }) => row);
}

export interface PayDistributionAggregate {
  currency: string;
  periodEnd: Date;
  workerId: string;
  grossMinorUnits: number;
}

const PAY_BANDS = [
  'Below 50% of average',
  '50% to 100% of average',
  'Above 100% to 150% of average',
  'Above 150% of average',
] as const;

/** Relative bands avoid cross-currency comparisons; the average itself is never exposed. */
export function payDistribution(rows: PayDistributionAggregate[]): AnalyticsPayDistributionMonth[] {
  const groups = new Map<
    string,
    { month: string; currency: string; workers: Map<string, number> }
  >();
  for (const row of rows) {
    const month = row.periodEnd.toISOString().slice(0, 7);
    const key = `${month}:${row.currency}`;
    const group = groups.get(key) ?? { month, currency: row.currency, workers: new Map() };
    const total = (group.workers.get(row.workerId) ?? 0) + row.grossMinorUnits;
    if (!Number.isSafeInteger(total))
      throw new BadRequestException('Analytics money total exceeds the safe integer range');
    group.workers.set(row.workerId, total);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ month, currency, workers }) => {
      if (workers.size < MINIMUM_COHORT)
        return {
          month,
          currency,
          suppressed: true,
          workerCount: null,
          bands: [],
        };
      const values = [...workers.values()];
      const sum = values.reduce((total, value) => total + value, 0);
      if (!Number.isSafeInteger(sum))
        throw new BadRequestException('Analytics money total exceeds the safe integer range');
      const average = sum / values.length;
      const bands = PAY_BANDS.map((label) => ({ label, count: 0 }));
      for (const value of values) {
        const ratio = average === 0 ? 1 : value / average;
        const index = ratio < 0.5 ? 0 : ratio <= 1 ? 1 : ratio <= 1.5 ? 2 : 3;
        bands[index]!.count += 1;
      }
      return { month, currency, suppressed: false, workerCount: workers.size, bands };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
}

export interface PayrollAggregate {
  currency: string;
  periodEnd: Date;
  workerId: string;
  _sum: {
    grossMinorUnits: number | null;
    netMinorUnits: number | null;
    deductionsMinorUnits: number | null;
    employerCostsMinorUnits: number | null;
  };
}

/** Keep currencies separate and suppress each month independently. No grand total can reveal a hidden month. */
export function payrollMonths(rows: PayrollAggregate[]): AnalyticsPayrollMonth[] {
  const groups = new Map<string, { workers: Set<string>; value: AnalyticsPayrollMonth }>();
  for (const row of rows) {
    const month = row.periodEnd.toISOString().slice(0, 7);
    const key = `${month}:${row.currency}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        workers: new Set(),
        value: {
          month,
          currency: row.currency,
          suppressed: false,
          grossMinorUnits: 0,
          netMinorUnits: 0,
          deductionsMinorUnits: 0,
          employerCostsMinorUnits: 0,
          totalCostMinorUnits: 0,
        },
      };
      groups.set(key, group);
    }
    group.workers.add(row.workerId);
    for (const field of [
      'grossMinorUnits',
      'netMinorUnits',
      'deductionsMinorUnits',
      'employerCostsMinorUnits',
    ] as const) {
      const sum = group.value[field]! + (row._sum[field] ?? 0);
      if (!Number.isSafeInteger(sum))
        throw new BadRequestException('Analytics money total exceeds the safe integer range');
      group.value[field] = sum;
    }
  }
  return [...groups.values()]
    .map(({ workers, value }) => {
      if (workers.size < MINIMUM_COHORT)
        return {
          ...value,
          suppressed: true,
          grossMinorUnits: null,
          netMinorUnits: null,
          deductionsMinorUnits: null,
          employerCostsMinorUnits: null,
          totalCostMinorUnits: null,
        };
      const cost = value.grossMinorUnits! + value.employerCostsMinorUnits!;
      if (!Number.isSafeInteger(cost))
        throw new BadRequestException('Analytics money total exceeds the safe integer range');
      return { ...value, totalCostMinorUnits: cost };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
}
