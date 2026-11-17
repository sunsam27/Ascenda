import {
  leaveTypeBreakdown,
  overviewPeriod,
  payDistribution,
  payrollMonths,
  retentionSummary,
  tenureSummary,
} from './analytics.domain';

describe('ANA-01–03 overview acceptance', () => {
  it('uses an inclusive date range and rejects invalid or unbounded ranges', () => {
    expect(overviewPeriod('2026-01-01', '2026-01-31').endExclusive.toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    expect(() => overviewPeriod('2026-02-30', '2026-03-01')).toThrow();
    expect(() => overviewPeriod('2026-02-01', '2026-01-01')).toThrow();
    expect(() => overviewPeriod('2024-01-01', '2026-01-01')).toThrow();
  });
  it('defaults to year-to-date and uses the selected end date year', () => {
    expect(overviewPeriod(undefined, undefined, new Date('2026-11-16T23:30:00Z'))).toMatchObject({
      from: '2026-01-01',
      to: '2026-11-16',
    });
    expect(overviewPeriod(undefined, '2025-05-31')).toMatchObject({
      from: '2025-01-01',
      to: '2025-05-31',
    });
  });
  const row = (workerId: string, currency = 'NGN') => ({
    workerId,
    currency,
    periodEnd: new Date('2026-01-31'),
    _sum: {
      grossMinorUnits: 101,
      netMinorUnits: 91,
      deductionsMinorUnits: 10,
      employerCostsMinorUnits: 5,
    },
  });
  it('suppresses fewer than five distinct paid workers, even with repeated runs', () => {
    const result = payrollMonths(Array.from({ length: 6 }, () => row('same-worker')));
    expect(result[0]).toMatchObject({
      suppressed: true,
      grossMinorUnits: null,
      totalCostMinorUnits: null,
    });
    expect(JSON.stringify(result)).not.toContain('same-worker');
  });
  it('sums frozen integer money and keeps currencies separate', () => {
    const result = payrollMonths([
      ...Array.from({ length: 5 }, (_, i) => row(String(i))),
      row('usd', 'USD'),
    ]);
    expect(result[0]).toMatchObject({
      currency: 'NGN',
      grossMinorUnits: 505,
      netMinorUnits: 455,
      totalCostMinorUnits: 530,
    });
    expect(result[1]).toMatchObject({ currency: 'USD', suppressed: true, netMinorUnits: null });
  });
  it('fails closed on unsafe integer totals', () => {
    expect(() =>
      payrollMonths([
        { ...row('1'), _sum: { ...row('1')._sum, grossMinorUnits: Number.MAX_SAFE_INTEGER } },
        row('2'),
      ]),
    ).toThrow();
  });
  it('suppresses small retention cohorts and rounds eligible rates', () => {
    expect(retentionSummary(4, 4)).toEqual({
      suppressed: true,
      eligible: null,
      retained: null,
      ratePercent: null,
    });
    expect(retentionSummary(6, 5)).toEqual({
      suppressed: false,
      eligible: 6,
      retained: 5,
      ratePercent: 83.3,
    });
  });
  it('bands period-end tenure by completed months and suppresses small cohorts', () => {
    const periodEnd = new Date('2026-01-31');
    const worker = (startDate: string) => ({ startDate: new Date(startDate), endDate: null });
    expect(
      tenureSummary(
        [
          worker('2025-01-01'),
          worker('2020-01-01'),
          worker('2025-06-01'),
          worker('2024-01-01'),
          worker('2022-01-01'),
        ],
        periodEnd,
      ),
    ).toEqual({
      suppressed: false,
      averageMonths: 32.6,
      bands: [
        { label: 'Under 1 year', count: 1 },
        { label: '1 to 3 years', count: 2 },
        { label: '3 to 5 years', count: 1 },
        { label: '5 years or more', count: 1 },
      ],
    });
    expect(tenureSummary([worker('2025-01-01')], periodEnd)).toEqual({
      suppressed: true,
      averageMonths: null,
      bands: [],
    });
  });
  it('groups leave types by label and hides cohorts with fewer than five workers', () => {
    const annual = Array.from({ length: 5 }, (_, i) => ({
      leaveTypeId: 'annual',
      label: 'Annual leave',
      category: 'ANNUAL',
      workerId: String(i),
      days: 2,
    }));
    const sick = Array.from({ length: 4 }, (_, i) => ({
      leaveTypeId: 'sick',
      label: 'Sick leave',
      category: 'SICK',
      workerId: String(i),
      days: 1,
    }));
    expect(leaveTypeBreakdown([...annual, ...sick])).toEqual([
      {
        label: 'Annual leave',
        category: 'ANNUAL',
        requests: 5,
        approvedDays: 10,
        suppressed: false,
      },
      {
        label: 'Sick leave',
        category: 'SICK',
        requests: null,
        approvedDays: null,
        suppressed: true,
      },
    ]);
  });
  it('bands pay relative to each month/currency average without exposing the average', () => {
    const rows = [40, 80, 120, 200, 60].map((grossMinorUnits, i) => ({
      currency: 'NGN',
      periodEnd: new Date('2026-01-31'),
      workerId: String(i),
      grossMinorUnits,
    }));
    const [result] = payDistribution(rows);
    expect(result).toEqual({
      month: '2026-01',
      currency: 'NGN',
      suppressed: false,
      workerCount: 5,
      bands: [
        { label: 'Below 50% of average', count: 1 },
        { label: '50% to 100% of average', count: 2 },
        { label: 'Above 100% to 150% of average', count: 1 },
        { label: 'Above 150% of average', count: 1 },
      ],
    });
    expect(result).not.toHaveProperty('averageMinorUnits');
    expect(payDistribution(rows.slice(0, 4))[0]).toMatchObject({
      suppressed: true,
      workerCount: null,
      bands: [],
    });
  });
});
