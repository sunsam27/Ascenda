import {
  attendanceByTeam,
  attendanceTrend,
  departmentUsage,
  leaveTypeBreakdown,
  overviewPeriod,
  payDistribution,
  payrollByDepartment,
  payrollComponents,
  payrollMonths,
  retentionSummary,
  scheduledAttendanceRate,
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
  it('aggregates scheduled attendance and suppresses small cohorts', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      workerId: String(i),
      scheduledDays: 20,
      attendedDays: i === 0 ? 16 : i === 1 ? 18 : 20,
    }));
    expect(scheduledAttendanceRate(rows)).toEqual({
      suppressed: false,
      scheduledDays: 100,
      attendedDays: 94,
      ratePercent: 94,
      lateArrivals: 0,
      clockIns: 0,
      lateArrivalRatePercent: 0,
      unapprovedAbsenceDays: 0,
      absenceRatePercent: 0,
    });
    expect(scheduledAttendanceRate(rows.slice(0, 4))).toEqual({
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
    // Workers with no scheduled days in range cannot reveal a rate.
    expect(
      scheduledAttendanceRate([
        ...rows.slice(0, 4),
        { workerId: 'no-days', scheduledDays: 0, attendedDays: 0 },
      ]),
    ).toMatchObject({ suppressed: true, ratePercent: null });
    expect(
      scheduledAttendanceRate(Array.from({ length: 5 }, (_, i) => ({
        workerId: String(i),
        scheduledDays: 0,
        attendedDays: 0,
      }))),
    ).toMatchObject({ suppressed: true, ratePercent: null });
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
  it('groups attendance by team and month with per-bucket suppression', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      workerId: String(i),
      scheduledDays: 20,
      attendedDays: 18,
      unapprovedAbsenceDays: 1,
      lateArrivals: 1,
      clockIns: 10,
    }));
    const teams = new Map(rows.map((row, i) => [row.workerId, i < 5 ? 'Alpha' : 'Beta']));
    expect(attendanceByTeam(rows, teams)).toEqual([
      {
        team: 'Alpha',
        suppressed: false,
        scheduledDays: 100,
        attendedDays: 90,
        ratePercent: 90,
        lateArrivals: 5,
        clockIns: 50,
        lateArrivalRatePercent: 10,
        unapprovedAbsenceDays: 5,
        absenceRatePercent: 5,
      },
      {
        team: 'Beta',
        suppressed: true,
        scheduledDays: null,
        attendedDays: null,
        ratePercent: null,
        lateArrivals: null,
        clockIns: null,
        lateArrivalRatePercent: null,
        unapprovedAbsenceDays: null,
        absenceRatePercent: null,
      },
    ]);
    const trendRows = rows.slice(0, 5).map((row) => ({
      ...row,
      months: [
        {
          month: '2026-01',
          scheduledDays: 20,
          attendedDays: 18,
          unapprovedAbsenceDays: 1,
          lateArrivals: 1,
          clockIns: 10,
        },
      ],
    }));
    expect(attendanceTrend(trendRows)).toEqual([
      {
        month: '2026-01',
        suppressed: false,
        scheduledDays: 100,
        attendedDays: 90,
        ratePercent: 90,
        lateArrivals: 5,
        clockIns: 50,
        lateArrivalRatePercent: 10,
        unapprovedAbsenceDays: 5,
        absenceRatePercent: 5,
      },
    ]);
  });
  it('groups leave usage and absence by department with small-cohort suppression', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({
        workerId: `ops-${i}`,
        department: 'Operations',
        approvedLeaveDays: 2,
        unapprovedAbsenceDays: 1,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        workerId: `small-${i}`,
        department: 'Small team',
        approvedLeaveDays: 3,
        unapprovedAbsenceDays: 0,
      })),
    ];
    expect(departmentUsage(rows)).toEqual([
      {
        department: 'Operations',
        suppressed: false,
        approvedLeaveDays: 10,
        unapprovedAbsenceDays: 5,
      },
      {
        department: 'Small team',
        suppressed: true,
        approvedLeaveDays: null,
        unapprovedAbsenceDays: null,
      },
    ]);
  });
  it('groups frozen payroll cost by department with small-cohort suppression', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      workerId: String(i),
      department: 'Operations',
      currency: 'NGN',
      month: '2026-01',
      grossMinorUnits: 1000,
      employerCostsMinorUnits: 100,
    }));
    expect(payrollByDepartment(rows)).toEqual([
      {
        month: '2026-01',
        currency: 'NGN',
        department: 'Operations',
        suppressed: false,
        grossMinorUnits: 5000,
        employerCostsMinorUnits: 500,
        totalCostMinorUnits: 5500,
        paidWorkers: 5,
      },
    ]);
    expect(payrollByDepartment(rows.slice(0, 4))[0]).toMatchObject({ suppressed: true });
  });
  it('aggregates pay components, contractor cost and average salary with suppression', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({
        workerId: `employee-${i}`,
        category: 'EMPLOYEE',
        currency: 'NGN',
        month: '2026-01',
        grossMinorUnits: 1000,
        overtimeMinorUnits: i === 0 ? 100 : 0,
        bonusMinorUnits: 0,
        allowanceMinorUnits: 200,
        volunteerStipendMinorUnits: 0,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        workerId: `contractor-${i}`,
        category: 'CONTRACTOR',
        currency: 'NGN',
        month: '2026-01',
        grossMinorUnits: 1000,
        overtimeMinorUnits: 0,
        bonusMinorUnits: 0,
        allowanceMinorUnits: 0,
        // Stipend lines on contractors must not be reported as volunteer stipends.
        volunteerStipendMinorUnits: 999,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        workerId: `volunteer-${i}`,
        category: 'VOLUNTEER',
        currency: 'NGN',
        month: '2026-01',
        grossMinorUnits: 100,
        overtimeMinorUnits: 0,
        bonusMinorUnits: 0,
        allowanceMinorUnits: 0,
        volunteerStipendMinorUnits: 100,
      })),
    ];
    expect(payrollComponents(rows)).toEqual([
      {
        month: '2026-01',
        currency: 'NGN',
        suppressed: false,
        overtimeMinorUnits: null,
        bonusMinorUnits: null,
        allowanceMinorUnits: 1000,
        contractorMinorUnits: 5000,
        volunteerStipendMinorUnits: 500,
        averageSalaryMinorUnits: 1000,
        paidEmployees: 5,
      },
    ]);
    expect(payrollComponents(rows.slice(0, 4))[0]).toMatchObject({ suppressed: true });
  });
});
