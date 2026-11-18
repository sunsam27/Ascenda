import type {
  AnalyticsOverview,
  AnalyticsReportColumn,
  AnalyticsReportDefinition,
  AnalyticsReportType,
} from '@ascenda/types';

export const REPORT_DEFINITIONS: AnalyticsReportDefinition[] = [
  {
    type: 'employee',
    title: 'Employee / workforce directory',
    description:
      'Non-draft workforce at period end, across all worker categories. Current assignments and statuses; not a historical status ledger. Includes workers on their last working day. Open-ended records must currently be active, on leave or on probation.',
    requiresStepUp: false,
  },
  {
    type: 'payroll',
    title: 'Payroll summary',
    description:
      'Frozen payslips from processed/locked runs by pay-period end month and currency. Reversed originals and reversal runs excluded. Money uses a two-decimal minor-unit convention; not confirmation of payment. Small cohorts hidden.',
    requiresStepUp: true,
  },
  {
    type: 'attendance',
    title: 'Attendance summary',
    description:
      'Recorded worker-days plus the scheduled-working-day attendance rate. Effective work schedule, holidays, employment dates and approved leave form the denominator; unrecorded scheduled days count as not attended. Cohorts below five contributors hidden.',
    requiresStepUp: false,
  },
  {
    type: 'leave',
    title: 'Leave summary',
    description:
      'Currently approved requests starting in the selected range and their full stored booked duration, including days outside the range. No leave reasons or medical details. Cohorts below five contributors hidden.',
    requiresStepUp: false,
  },
  {
    type: 'department',
    title: 'Department summary',
    description:
      'Period-end workforce headcount by current department assignment. Historical transfers are not reconstructed. All worker categories included.',
    requiresStepUp: false,
  },
  {
    type: 'retention',
    title: 'Retention summary',
    description:
      'Workers present at the start of the range who are still present at period end, using recorded start and last-working dates. Open-ended records use current status; cohort rates below five eligible workers hidden.',
    requiresStepUp: false,
  },
  {
    type: 'tenure',
    title: 'Tenure summary',
    description:
      'Period-end tenure bands and average completed months from recorded start and last-working dates. Current snapshot only; historical transfers and status changes are not reconstructed. Cohorts below five workers hidden.',
    requiresStepUp: false,
  },
  {
    type: 'leave-types',
    title: 'Leave type summary',
    description:
      'Approved requests starting in the range, grouped by leave type and category using their frozen booked days. No reasons or medical details. Leave types with fewer than five contributing workers hidden.',
    requiresStepUp: false,
  },
  {
    type: 'pay-distribution',
    title: 'Pay distribution summary',
    description:
      'Relative gross-pay bands by pay-period month and currency from frozen processed/locked payslips. Bands compare workers with their own cohort average; the average and individual pay are not shown. Cohorts below five paid workers hidden.',
    requiresStepUp: true,
  },
  {
    type: 'workforce-cost',
    title: 'Workforce cost summary',
    description:
      'Gross payroll plus employer-side costs, by pay-period end month and currency. Processed/locked frozen payslips only; reversed originals and reversal runs excluded. Not cash paid. Small cohorts hidden.',
    requiresStepUp: true,
  },
];

export const DIRECTORY_COLUMNS: AnalyticsReportColumn[] = [
  { key: 'employeeNumber', label: 'Worker number', kind: 'text' },
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'category', label: 'Category', kind: 'text' },
  { key: 'status', label: 'Current status', kind: 'text' },
  { key: 'jobTitle', label: 'Job title', kind: 'text' },
  { key: 'department', label: 'Current department', kind: 'text' },
  { key: 'location', label: 'Current location', kind: 'text' },
  { key: 'startDate', label: 'Start date', kind: 'text' },
  { key: 'endDate', label: 'Last working day', kind: 'text' },
];

export function summaryReport(
  type: Exclude<AnalyticsReportType, 'employee'>,
  overview: AnalyticsOverview,
): {
  columns: AnalyticsReportColumn[];
  rows: Record<string, string | number | null>[];
} {
  if (type === 'department')
    return {
      columns: [
        { key: 'department', label: 'Current department', kind: 'text' },
        { key: 'headcount', label: 'Headcount', kind: 'number' },
      ],
      rows: overview.workforce.departments.map((row) => ({
        department: row.label,
        headcount: row.count,
      })),
    };
  if (type === 'retention') {
    const { retention } = overview.workforce;
    return {
      columns: [
        { key: 'metric', label: 'Retention metric', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'number' },
      ],
      rows: [
        { metric: 'Eligible at period start', value: retention.eligible },
        { metric: 'Retained at period end', value: retention.retained },
        { metric: 'Retention rate (%)', value: retention.ratePercent },
      ],
    };
  }
  if (type === 'tenure') {
    const { tenure } = overview.workforce;
    return {
      columns: [
        { key: 'metric', label: 'Tenure band / metric', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'number' },
      ],
      rows: [
        { metric: 'Average tenure (months)', value: tenure.averageMonths },
        ...tenure.bands.map((row) => ({ metric: row.label, value: row.count })),
      ],
    };
  }
  if (type === 'leave-types') {
    if (!overview.leave) throw new Error('Leave type report requires authorised data');
    return {
      columns: [
        { key: 'leaveType', label: 'Leave type', kind: 'text' },
        { key: 'category', label: 'Category', kind: 'text' },
        { key: 'requests', label: 'Requests', kind: 'number' },
        { key: 'approvedDays', label: 'Booked days', kind: 'number' },
      ],
      rows: overview.leave.byType.map((row) => ({
        leaveType: row.label,
        category: row.category,
        requests: row.requests,
        approvedDays: row.approvedDays,
      })),
    };
  }
  if (type === 'pay-distribution') {
    if (!overview.payroll) throw new Error('Pay distribution report requires authorised data');
    const rows: Record<string, string | number | null>[] =
      overview.payroll.distribution.flatMap<Record<string, string | number | null>>((month) =>
        month.bands.length === 0
          ? [
              {
                month: month.month,
                currency: month.currency,
                band: 'Hidden: fewer than 5 paid workers',
                workers: null,
              },
            ]
          : month.bands.map((band) => ({
              month: month.month,
              currency: month.currency,
              band: band.label,
              workers: band.count,
            })),
      );
    return {
      columns: [
        { key: 'month', label: 'Period-end month', kind: 'text' },
        { key: 'currency', label: 'Currency', kind: 'text' },
        { key: 'band', label: 'Relative gross-pay band', kind: 'text' },
        { key: 'workers', label: 'Workers', kind: 'number' },
      ],
      rows,
    };
  }
  if (type === 'attendance') {
    if (!overview.attendance) throw new Error('Attendance report requires authorised data');
    return {
      columns: [
        { key: 'metric', label: 'Attendance metric', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'number' },
      ],
      rows: [
        { metric: 'All records', value: overview.attendance.records },
        { metric: 'Present', value: overview.attendance.present },
        { metric: 'Remote', value: overview.attendance.remote },
        { metric: 'Late', value: overview.attendance.late },
        { metric: 'Absent', value: overview.attendance.absent },
        { metric: 'Scheduled working days', value: overview.attendance.scheduled.scheduledDays },
        { metric: 'Days attended', value: overview.attendance.scheduled.attendedDays },
        { metric: 'Attendance rate (%)', value: overview.attendance.scheduled.ratePercent },
      ],
    };
  }
  if (type === 'leave') {
    if (!overview.leave) throw new Error('Leave report requires authorised data');
    return {
      columns: [
        { key: 'metric', label: 'Approved leave metric', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'number' },
      ],
      rows: [
        {
          metric: 'Booked days for requests starting in range',
          value: overview.leave.approvedDays,
        },
        { metric: 'Requests starting in range', value: overview.leave.requests },
      ],
    };
  }
  if (!overview.payroll) throw new Error('Payroll report requires authorised data');
  const moneyKeys =
    type === 'payroll'
      ? [
          ['grossMinorUnits', 'Gross pay'],
          ['deductionsMinorUnits', 'Deductions'],
          ['netMinorUnits', 'Net pay'],
        ]
      : [
          ['grossMinorUnits', 'Gross pay'],
          ['employerCostsMinorUnits', 'Employer-side costs'],
          ['totalCostMinorUnits', 'Total employer cost'],
        ];
  return {
    columns: [
      { key: 'month', label: 'Period-end month', kind: 'text' },
      { key: 'currency', label: 'Currency', kind: 'text' },
      ...moneyKeys.map(([key, label]) => ({ key: key!, label: label!, kind: 'money' as const })),
      { key: 'privacy', label: 'Privacy', kind: 'text' },
    ],
    rows: overview.payroll.months.map((month) => ({
      month: month.month,
      currency: month.currency,
      ...Object.fromEntries(moneyKeys.map(([key]) => [key!, month[key as keyof typeof month]])),
      privacy: month.suppressed ? 'Hidden: fewer than 5 paid workers' : 'Reportable',
    })),
  };
}
