export interface AnalyticsBreakdown {
  label: string;
  count: number;
}

export interface AnalyticsRetention {
  suppressed: boolean;
  eligible: number | null;
  retained: number | null;
  ratePercent: number | null;
}

export interface AnalyticsTenure {
  suppressed: boolean;
  averageMonths: number | null;
  bands: AnalyticsBreakdown[];
}

/** Scheduled-working-day attendance rate (ANA-03). Null metrics are suppressed. */
export interface AnalyticsScheduledAttendance {
  suppressed: boolean;
  scheduledDays: number | null;
  attendedDays: number | null;
  ratePercent: number | null;
}

export interface AnalyticsLeaveTypeBreakdown {
  label: string;
  category: string;
  requests: number | null;
  approvedDays: number | null;
  suppressed: boolean;
}

export interface AnalyticsPayDistributionBand {
  label: string;
  count: number;
}

export interface AnalyticsPayDistributionMonth {
  month: string;
  currency: string;
  suppressed: boolean;
  workerCount: number | null;
  bands: AnalyticsPayDistributionBand[];
}

export interface AnalyticsPayrollMonth {
  month: string;
  currency: string;
  suppressed: boolean;
  grossMinorUnits: number | null;
  netMinorUnits: number | null;
  deductionsMinorUnits: number | null;
  employerCostsMinorUnits: number | null;
  totalCostMinorUnits: number | null;
}

/** ANA-01–03 overview. Null sections are not authorised; null metrics are suppressed. */
export interface AnalyticsOverview {
  from: string;
  to: string;
  scope: 'organisation' | 'team';
  minimumCohort: number;
  workforce: {
    headcount: number;
    joiners: number;
    exits: number;
    categories: AnalyticsBreakdown[];
    departments: AnalyticsBreakdown[];
    locations: AnalyticsBreakdown[];
    statuses: AnalyticsBreakdown[];
    retention: AnalyticsRetention;
    tenure: AnalyticsTenure;
  };
  payroll: {
    months: AnalyticsPayrollMonth[];
    distribution: AnalyticsPayDistributionMonth[];
  } | null;
  attendance: {
    suppressed: boolean;
    records: number | null;
    present: number | null;
    late: number | null;
    absent: number | null;
    remote: number | null;
    scheduled: AnalyticsScheduledAttendance;
  } | null;
  leave: {
    suppressed: boolean;
    approvedDays: number | null;
    requests: number | null;
    byType: AnalyticsLeaveTypeBreakdown[];
  } | null;
}

export const ANALYTICS_REPORT_TYPES = [
  'employee',
  'payroll',
  'attendance',
  'leave',
  'department',
  'retention',
  'tenure',
  'leave-types',
  'pay-distribution',
  'workforce-cost',
] as const;
export type AnalyticsReportType = (typeof ANALYTICS_REPORT_TYPES)[number];
export type AnalyticsExportFormat = 'csv' | 'pdf';

export interface AnalyticsReportDefinition {
  type: AnalyticsReportType;
  title: string;
  description: string;
  requiresStepUp: boolean;
}

export interface AnalyticsReportColumn {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'money';
}

export interface AnalyticsReport extends AnalyticsReportDefinition {
  from: string;
  to: string;
  scope: 'organisation' | 'team';
  generatedAt: string;
  columns: AnalyticsReportColumn[];
  rows: Record<string, string | number | null>[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  canExport: boolean;
}
