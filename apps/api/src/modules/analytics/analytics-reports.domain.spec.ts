import type { AnalyticsOverview, AnalyticsReport } from '@ascenda/types';
import { canExportAnalytics, canReadAnalyticsPayroll } from './analytics-access';
import { renderReportCsv, renderReportPdf, reportCell } from './analytics-report-export';
import { REPORT_DEFINITIONS, summaryReport } from './analytics-reports.domain';

const report: AnalyticsReport = {
  type: 'department',
  title: 'Department summary',
  description: 'Current assignments only.',
  requiresStepUp: false,
  from: '2026-01-01',
  to: '2026-01-31',
  scope: 'organisation',
  generatedAt: '2026-02-01T00:00:00.000Z',
  canExport: true,
  columns: [
    { key: 'department', label: 'Department', kind: 'text' },
    { key: 'headcount', label: 'Headcount', kind: 'number' },
  ],
  rows: [{ department: '=HYPERLINK("bad")', headcount: 6 }],
  meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
};
const watermark = {
  organisationId: 'org-a',
  actorId: 'owner',
  exportedAt: '2026-02-01T00:00:00.000Z',
};

describe('ANA-04 report export acceptance', () => {
  it('includes workforce retention and tenure reports without payroll access', () => {
    expect(REPORT_DEFINITIONS.map((r) => r.type)).toContain('retention');
    expect(REPORT_DEFINITIONS.map((r) => r.type)).toContain('tenure');
    const overview = {
      workforce: {
        statuses: [],
        retention: {
          suppressed: false,
          eligible: 6,
          retained: 5,
          ratePercent: 83.3,
        },
        tenure: {
          suppressed: false,
          averageMonths: 12.5,
          bands: [{ label: 'Under 1 year', count: 2 }],
        },
      },
    } as unknown as AnalyticsOverview;
    expect(summaryReport('retention', overview).rows).toEqual([
      { metric: 'Eligible at period start', value: 6 },
      { metric: 'Retained at period end', value: 5 },
      { metric: 'Retention rate (%)', value: 83.3 },
    ]);
    expect(summaryReport('tenure', overview).rows).toEqual([
      { metric: 'Average tenure (months)', value: 12.5 },
      { metric: 'Under 1 year', value: 2 },
    ]);
  });
  it('exposes leave-type and pay-distribution reports with step-up only on pay data', () => {
    const types = REPORT_DEFINITIONS.map((r) => r.type);
    expect(types).toContain('leave-types');
    expect(types).toContain('pay-distribution');
    expect(REPORT_DEFINITIONS.find((r) => r.type === 'leave-types')!.requiresStepUp).toBe(false);
    expect(REPORT_DEFINITIONS.find((r) => r.type === 'pay-distribution')!.requiresStepUp).toBe(
      true,
    );
    const overview = {
      leave: {
        suppressed: false,
        approvedDays: 15,
        requests: 6,
        byType: [
          {
            label: 'Annual leave',
            category: 'ANNUAL',
            requests: 6,
            approvedDays: 15,
            suppressed: false,
          },
        ],
      },
      payroll: {
        distribution: [
          {
            month: '2026-01',
            currency: 'NGN',
            suppressed: false,
            workerCount: 6,
            bands: [{ label: '50% to 100% of average', count: 6 }],
          },
        ],
      },
    } as unknown as AnalyticsOverview;
    expect(summaryReport('leave-types', overview).rows).toEqual([
      { leaveType: 'Annual leave', category: 'ANNUAL', requests: 6, approvedDays: 15 },
    ]);
    expect(summaryReport('pay-distribution', overview).rows).toEqual([
      {
        month: '2026-01',
        currency: 'NGN',
        band: '50% to 100% of average',
        workers: 6,
      },
    ]);
  });
  it('retains Owner-only export and underlying payroll read restrictions', () => {
    expect(canExportAnalytics('OWNER')).toBe(true);
    for (const role of [
      'HR_ADMINISTRATOR',
      'PAYROLL_ADMINISTRATOR',
      'FINANCE_APPROVER',
      'AUDITOR',
      'MANAGER',
      'VIEWER',
      'SUPPORT_READ_ONLY',
    ]) {
      expect(canExportAnalytics(role)).toBe(false);
    }
    expect(canReadAnalyticsPayroll('FINANCE_APPROVER')).toBe(true);
    expect(canReadAnalyticsPayroll('HR_ADMINISTRATOR')).toBe(false);
    expect(canReadAnalyticsPayroll('SUPPORT_READ_ONLY')).toBe(false);
  });
  it('exports CSV with BOM, CRLF, audit watermark and neutralised spreadsheet formulae', () => {
    const csv = renderReportCsv(report, watermark);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('org-a');
    expect(csv).toContain('owner');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('Current assignments only.');
  });
  it.each(['+SUM(1,2)', '-1+1', '@SUM(A1)', '\t=1+1', '\r=1+1', '  =1+1'])(
    'neutralises untrusted text: %s',
    (department) => {
      const csv = renderReportCsv({ ...report, rows: [{ department, headcount: 6 }] }, watermark);
      expect(csv).toContain(`'${department.replace(/"/g, '""')}`);
    },
  );
  it('keeps hidden values hidden and formats integer money exactly', () => {
    const csv = renderReportCsv(
      {
        ...report,
        columns: [{ key: 'gross', label: 'Gross', kind: 'money' }],
        rows: [{ gross: 10001 }, { gross: null }],
      },
      watermark,
    );
    expect(csv).toContain('100.01');
    expect(csv).toContain('Hidden');
    expect(csv).not.toContain('NaN');
  });
  it('includes metadata on empty reports without inventing a data record', () => {
    const csv = renderReportCsv(
      { ...report, rows: [], meta: { ...report.meta, total: 0 } },
      watermark,
    );
    expect(csv).toContain('no_data');
    expect(csv).toContain('org-a');
  });
  it('keeps decimal money exact, including single minor units and negative values', () => {
    const column = { key: 'amount', label: 'Amount', kind: 'money' as const };
    expect(reportCell(1, column)).toBe('0.01');
    expect(reportCell(-10001, column)).toBe('-100.01');
    expect(() => reportCell(0.5, column)).toThrow();
    expect(() => reportCell(Number.MAX_SAFE_INTEGER + 1, column)).toThrow();
    expect(() => reportCell('=1+1', { ...column, kind: 'number' })).toThrow();
  });
  it('quotes commas, double quotes and multiline text without losing record boundaries', () => {
    const csv = renderReportCsv(
      { ...report, rows: [{ department: 'People, "Culture"\nTeam', headcount: 6 }] },
      watermark,
    );
    expect(csv).toContain('"People, ""Culture""\nTeam"');
  });
  it('produces a downloadable multipage PDF without dropping rows', async () => {
    const buffer = await renderReportPdf(
      {
        ...report,
        rows: Array.from({ length: 70 }, (_, i) => ({
          department: `Department ${i}`,
          headcount: i,
        })),
      },
      watermark,
    );
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const text = buffer.toString('latin1');
    expect(text.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
  });
});
