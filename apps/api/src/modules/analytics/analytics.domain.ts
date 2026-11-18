import { BadRequestException } from '@nestjs/common';
import type {
  AnalyticsAttendanceTeam,
  AnalyticsAttendanceTrend,
  AnalyticsDepartmentUsage,
  AnalyticsLeaveTypeBreakdown,
  AnalyticsPayDistributionMonth,
  AnalyticsPayrollComponents,
  AnalyticsPayrollDepartment,
  AnalyticsScheduledAttendance,
  AnalyticsPayrollMonth,
  AnalyticsRetention,
  AnalyticsTenure,
} from '@ascenda/types';
import type { ScheduledAttendanceMonth } from '../time-leave/domain/scheduled-attendance';

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

export interface ScheduledAttendanceAggregate {
  workerId: string;
  scheduledDays: number;
  attendedDays: number;
  unapprovedAbsenceDays?: number;
  lateArrivals?: number;
  clockIns?: number;
}

export interface AttendanceAggregateWithMonths extends ScheduledAttendanceAggregate {
  months: {
    month: string;
    scheduledDays: number;
    attendedDays: number;
    unapprovedAbsenceDays: number;
    lateArrivals: number;
    clockIns: number;
  }[];
}

const percent = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;

const suppressedAttendance = (): AnalyticsScheduledAttendance => ({
  suppressed: true,
  scheduledDays: null,
  attendedDays: null,
  ratePercent: null,
  lateArrivals: null,
  clockIns: null,
  lateArrivalRatePercent: null,
  unapprovedAbsenceDays: null,
  absenceRatePercent: null,
});

/**
 * Aggregate per-worker ANA-03 metrics. Cohorts below five workers are
 * suppressed; no per-person counts or identifiers are exposed.
 */
export function scheduledAttendanceRate(
  rows: ScheduledAttendanceAggregate[],
): AnalyticsScheduledAttendance {
  const eligible = rows.filter((row) => row.scheduledDays > 0);
  if (eligible.length < MINIMUM_COHORT) return suppressedAttendance();
  const scheduledDays = eligible.reduce((sum, row) => sum + row.scheduledDays, 0);
  const attendedDays = eligible.reduce((sum, row) => sum + row.attendedDays, 0);
  const unapprovedAbsenceDays = eligible.reduce(
    (sum, row) => sum + (row.unapprovedAbsenceDays ?? 0),
    0,
  );
  const lateArrivals = eligible.reduce((sum, row) => sum + (row.lateArrivals ?? 0), 0);
  const clockIns = eligible.reduce((sum, row) => sum + (row.clockIns ?? 0), 0);
  return {
    suppressed: false,
    scheduledDays,
    attendedDays,
    ratePercent: percent(attendedDays, scheduledDays),
    lateArrivals,
    clockIns,
    lateArrivalRatePercent: percent(lateArrivals, clockIns),
    unapprovedAbsenceDays,
    absenceRatePercent: percent(unapprovedAbsenceDays, scheduledDays),
  };
}

/**
 * ANA-03 attendance grouped by the worker's current department as the team
 * proxy; the present schema has no Team/Roster entity.
 */
export function attendanceByTeam(
  rows: ScheduledAttendanceAggregate[],
  teamByWorker: Map<string, string>,
): AnalyticsAttendanceTeam[] {
  const groups = new Map<string, ScheduledAttendanceAggregate[]>();
  for (const row of rows) {
    const team = teamByWorker.get(row.workerId) ?? 'Unassigned';
    const group = groups.get(team) ?? [];
    group.push(row);
    groups.set(team, group);
  }
  return [...groups.entries()]
    .map(([team, group]) => ({ team, ...scheduledAttendanceRate(group) }))
    .sort((a, b) => a.team.localeCompare(b.team));
}

/** ANA-03 monthly trend buckets, each with its own five-worker suppression. */
export function attendanceTrend(rows: AttendanceAggregateWithMonths[]): AnalyticsAttendanceTrend[] {
  const grouped = new Map<string, Map<string, ScheduledAttendanceAggregate>>();
  for (const row of rows) {
    for (const month of row.months) {
      const workers = grouped.get(month.month) ?? new Map<string, ScheduledAttendanceAggregate>();
      workers.set(row.workerId, {
        workerId: row.workerId,
        scheduledDays: month.scheduledDays,
        attendedDays: month.attendedDays,
        unapprovedAbsenceDays: month.unapprovedAbsenceDays,
        lateArrivals: month.lateArrivals,
        clockIns: month.clockIns,
      });
      grouped.set(month.month, workers);
    }
  }
  return [...grouped.entries()]
    .map(([month, workers]) => ({ month, ...scheduledAttendanceRate([...workers.values()]) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface DepartmentUsageAggregate {
  workerId: string;
  department: string;
  approvedLeaveDays: number;
  unapprovedAbsenceDays: number;
}

/** ANA-01 leave usage and unapproved absence by current department. */
export function departmentUsage(rows: DepartmentUsageAggregate[]): AnalyticsDepartmentUsage[] {
  const groups = new Map<string, Map<string, DepartmentUsageAggregate>>();
  for (const row of rows) {
    const workers = groups.get(row.department) ?? new Map<string, DepartmentUsageAggregate>();
    const existing = workers.get(row.workerId);
    workers.set(row.workerId, {
      workerId: row.workerId,
      department: row.department,
      approvedLeaveDays:
        (existing?.approvedLeaveDays ?? 0) + row.approvedLeaveDays,
      unapprovedAbsenceDays:
        (existing?.unapprovedAbsenceDays ?? 0) + row.unapprovedAbsenceDays,
    });
    groups.set(row.department, workers);
  }
  const round = (value: number) => Math.round(value * 10) / 10;
  return [...groups.entries()]
    .map(([department, workers]) => {
      const rows = [...workers.values()];
      if (rows.length < MINIMUM_COHORT)
        return {
          department,
          suppressed: true,
          approvedLeaveDays: null,
          unapprovedAbsenceDays: null,
        };
      return {
        department,
        suppressed: false,
        approvedLeaveDays: round(rows.reduce((sum, row) => sum + row.approvedLeaveDays, 0)),
        unapprovedAbsenceDays: round(rows.reduce((sum, row) => sum + row.unapprovedAbsenceDays, 0)),
      };
    })
    .sort((a, b) => a.department.localeCompare(b.department));
}

export interface PayrollDepartmentAggregate {
  workerId: string;
  department: string;
  currency: string;
  month: string;
  grossMinorUnits: number;
  employerCostsMinorUnits: number;
}

/** ANA-02 frozen payroll cost grouped by the worker's current department. */
export function payrollByDepartment(
  rows: PayrollDepartmentAggregate[],
): AnalyticsPayrollDepartment[] {
  const groups = new Map<string, Map<string, PayrollDepartmentAggregate>>();
  for (const row of rows) {
    const key = `${row.month}|${row.currency}|${row.department}`;
    const workers = groups.get(key) ?? new Map<string, PayrollDepartmentAggregate>();
    const existing = workers.get(row.workerId);
    workers.set(row.workerId, {
      ...row,
      grossMinorUnits: (existing?.grossMinorUnits ?? 0) + row.grossMinorUnits,
      employerCostsMinorUnits:
        (existing?.employerCostsMinorUnits ?? 0) + row.employerCostsMinorUnits,
    });
    groups.set(key, workers);
  }
  return [...groups.entries()]
    .map(([key, workers]) => {
      const [month, currency, department] = key.split('|');
      const paidWorkers = workers.size;
      if (paidWorkers < MINIMUM_COHORT)
        return {
          month: month ?? '',
          currency: currency ?? '',
          department: department ?? '',
          suppressed: true,
          grossMinorUnits: null,
          employerCostsMinorUnits: null,
          totalCostMinorUnits: null,
          paidWorkers: null,
        };
      const grossMinorUnits = [...workers.values()].reduce((sum, row) => sum + row.grossMinorUnits, 0);
      const employerCostsMinorUnits = [...workers.values()].reduce(
        (sum, row) => sum + row.employerCostsMinorUnits,
        0,
      );
      return {
        month: month ?? '',
        currency: currency ?? '',
        department: department ?? '',
        suppressed: false,
        grossMinorUnits,
        employerCostsMinorUnits,
        totalCostMinorUnits: grossMinorUnits + employerCostsMinorUnits,
        paidWorkers,
      };
    })
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        a.currency.localeCompare(b.currency) ||
        a.department.localeCompare(b.department),
    );
}

export interface PayrollComponentAggregate {
  workerId: string;
  category: string;
  currency: string;
  month: string;
  grossMinorUnits: number;
  overtimeMinorUnits: number;
  bonusMinorUnits: number;
  allowanceMinorUnits: number;
  volunteerStipendMinorUnits: number;
}

/** ANA-02 pay components, contractor cost and average salary from frozen payslip lines. */
export function payrollComponents(rows: PayrollComponentAggregate[]): AnalyticsPayrollComponents[] {
  const groups = new Map<string, PayrollComponentAggregate[]>();
  for (const row of rows) {
    const key = `${row.month}|${row.currency}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const component = (
    group: PayrollComponentAggregate[],
    value: (row: PayrollComponentAggregate) => number,
  ) => {
    const contributors = new Set(
      group.filter((row) => value(row) > 0).map((row) => row.workerId),
    );
    if (contributors.size < MINIMUM_COHORT) return null;
    return group.reduce((sum, row) => sum + value(row), 0);
  };
  return [...groups.entries()]
    .map(([key, group]) => {
      const [month, currency] = key.split('|');
      const paidWorkers = new Set(group.map((row) => row.workerId)).size;
      const employees = group.filter((row) => row.category === 'EMPLOYEE');
      const paidEmployees = new Set(employees.map((row) => row.workerId)).size;
      const contractors = group.filter((row) => row.category === 'CONTRACTOR');
      const volunteers = group.filter((row) => row.category === 'VOLUNTEER');
      if (paidWorkers < MINIMUM_COHORT)
        return {
          month: month ?? '',
          currency: currency ?? '',
          suppressed: true,
          overtimeMinorUnits: null,
          bonusMinorUnits: null,
          allowanceMinorUnits: null,
          contractorMinorUnits: null,
          volunteerStipendMinorUnits: null,
          averageSalaryMinorUnits: null,
          paidEmployees: null,
        };
      const employeeGross = employees.reduce((sum, row) => sum + row.grossMinorUnits, 0);
      const contractorContributors = new Set(contractors.map((row) => row.workerId)).size;
      return {
        month: month ?? '',
        currency: currency ?? '',
        suppressed: false,
        overtimeMinorUnits: component(group, (row) => row.overtimeMinorUnits),
        bonusMinorUnits: component(group, (row) => row.bonusMinorUnits),
        allowanceMinorUnits: component(group, (row) => row.allowanceMinorUnits),
        contractorMinorUnits:
          contractorContributors >= MINIMUM_COHORT
            ? contractors.reduce((sum, row) => sum + row.grossMinorUnits, 0)
            : null,
        volunteerStipendMinorUnits: component(volunteers, (row) => row.volunteerStipendMinorUnits),
        averageSalaryMinorUnits:
          paidEmployees >= MINIMUM_COHORT ? Math.round(employeeGross / paidEmployees) : null,
        paidEmployees: paidEmployees >= MINIMUM_COHORT ? paidEmployees : null,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
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
