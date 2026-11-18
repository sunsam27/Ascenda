import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { requestContext } from '../../common/context/request-context';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { PayrollAnalyticsReader } from '../payroll/payroll-analytics.reader';
import { PeopleAnalyticsReader } from '../people/people-analytics.reader';
import { TimeLeaveAnalyticsReader } from '../time-leave/time-leave-analytics.reader';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { StepUpGuard } from '../../common/auth/step-up.guard';
import { stepUpSecret } from '../identity-access/identity-access.service';
import { AnalyticsExportGuard } from './analytics-export.guard';
import { AnalyticsReportsService } from './analytics-reports.service';

type Row = Record<string, any>;

/** Real HTTP, DTOs, policy guards, service and module readers; database/auth are doubles.
 * PostgreSQL RLS itself is exercised separately by test/e2e/analytics-rls.cjs.
 */
describe('ANA-01–03 overview HTTP acceptance', () => {
  let app: INestApplication;
  let base: string;
  let workers: Row[];
  let attendance: Row[];
  let leave: Row[];
  let slips: Row[];
  let tx: Row;
  const audit = { record: jest.fn() };
  const jwt = new JwtService();

  // Implements only the Prisma predicates used by these readers, including nested scopes.
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'AND')
        return (Array.isArray(value) ? value : [value]).every((part: Row) => matches(row, part));
      if (key === 'OR') return value.some((part: Row) => matches(row, part));
      if (key === 'worker')
        return matches(workers.find((w) => w.id === row.workerId) ?? {}, value.is);
      if (key === 'payrollRun') return matches(row.payrollRun, value.is);
      if (value === null || typeof value !== 'object') return row[key] === value;
      if ('in' in value && !value.in.includes(row[key])) return false;
      if ('not' in value && row[key] === value.not) return false;
      if ('gte' in value && !(row[key] != null && row[key] >= value.gte)) return false;
      if ('lte' in value && !(row[key] != null && row[key] <= value.lte)) return false;
      if ('lt' in value && !(row[key] != null && row[key] < value.lt)) return false;
      return true;
    });
  }
  function group(rows: Row[], args: Row) {
    const result = new Map<string, Row>();
    for (const row of rows.filter((r) => matches(r, args.where))) {
      const fields = Object.fromEntries(args.by.map((key: string) => [key, row[key]]));
      const key = JSON.stringify(fields);
      const bucket = result.get(key) ?? { ...fields, _count: 0, _sum: {} };
      bucket._count++;
      for (const field of Object.keys(args._sum ?? {}))
        bucket._sum[field] = (bucket._sum[field] ?? 0) + row[field];
      result.set(key, bucket);
    }
    return [...result.values()];
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    workers = ['org-a', 'org-b'].flatMap((organisationId) =>
      Array.from({ length: 6 }, (_, i) => ({
        id: `${organisationId}-${i}`,
        organisationId,
        userId: i === 0 ? 'actor' : null,
        managerId: i > 0 && i < 5 ? `${organisationId}-0` : null,
        departmentId: null,
        locationId: null,
        category: 'EMPLOYEE',
        employeeNumber: `W${i}`,
        firstName: `Person ${i}`,
        lastName: 'Fixture',
        jobTitle: 'Analyst',
        department: null,
        location: null,
        status: 'ACTIVE',
        startDate: new Date('2026-01-01'),
        endDate: null,
      })),
    );
    attendance = workers.map((w) => ({
      organisationId: w.organisationId,
      workerId: w.id,
      status: 'PRESENT',
      date: new Date('2026-01-15'),
    }));
    leave = workers.map((w) => ({
      organisationId: w.organisationId,
      workerId: w.id,
      leaveTypeId: 'annual',
      leaveType: { name: 'Annual leave', category: 'ANNUAL' },
      status: 'APPROVED',
      days: 2.5,
      startDate: new Date('2026-01-20'),
      endDate: new Date('2026-01-22'),
      startHalfDay: true,
      endHalfDay: false,
    }));
    slips = workers.map((w) => ({
      organisationId: w.organisationId,
      workerId: w.id,
      currency: 'NGN',
      periodEnd: new Date('2026-01-31'),
      grossMinorUnits: 10001,
      netMinorUnits: 9001,
      deductionsMinorUnits: 1000,
      employerCostsMinorUnits: 500,
      payrollRun: {
        organisationId: w.organisationId,
        status: 'PROCESSED',
        reversedAt: null,
        reversalOfRunId: null,
      },
    }));
    tx = {
      worker: {
        findFirst: jest.fn(
          async ({ where }: Row) => workers.find((r) => matches(r, where)) ?? null,
        ),
        count: jest.fn(async ({ where }: Row) => workers.filter((r) => matches(r, where)).length),
        groupBy: jest.fn(async (args: Row) => group(workers, args)),
        findMany: jest.fn(async ({ where, skip = 0, take }: Row) =>
          workers
            .filter((r) => matches(r, where))
            .slice(skip, take === undefined ? undefined : skip + take),
        ),
      },
      department: { findMany: jest.fn(async () => []) },
      location: { findMany: jest.fn(async () => []) },
      organisation: { findFirst: jest.fn(async () => null) },
      holiday: { findMany: jest.fn(async () => []) },
      payslip: { groupBy: jest.fn(async (args: Row) => group(slips, args)) },
      attendanceRecord: {
        groupBy: jest.fn(async (args: Row) => group(attendance, args)),
        findMany: jest.fn(async ({ where }: Row) => attendance.filter((r) => matches(r, where))),
      },
      leaveRequest: {
        groupBy: jest.fn(async (args: Row) => group(leave, args)),
        findMany: jest.fn(async ({ where }: Row) => leave.filter((r) => matches(r, where))),
      },
      auditLog: { create: jest.fn(async ({ data }: Row) => data) },
    };
    const prisma = { withRequestContext: async (fn: (client: Row) => unknown) => fn(tx) };
    const service = new AnalyticsService(
      prisma as never,
      new PeopleAnalyticsReader(),
      new PayrollAnalyticsReader(),
      new TimeLeaveAnalyticsReader(),
      audit as never,
    );
    const module = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: service },
        {
          provide: AnalyticsReportsService,
          useValue: new AnalyticsReportsService(
            prisma as never,
            new PeopleAnalyticsReader(),
            service,
          ),
        },
        StepUpGuard,
        AnalyticsExportGuard,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => 'analytics-test-secret' } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: Row, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'];
      if (role) req.user = { role, sub: 'actor', organisationId: req.headers['x-test-org'] };
      requestContext.run(
        { role, userId: 'actor', organisationId: req.headers['x-test-org'] },
        next,
      );
    });
    app.useGlobalGuards(
      {
        canActivate(context) {
          if (!context.switchToHttp().getRequest().user) throw new UnauthorizedException();
          return true;
        },
      },
      new RbacGuard(new Reflector()),
    );
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterEach(async () => {
    await app?.close();
  });
  function request(
    role?: string,
    org: string | null = 'org-a',
    query = 'from=2026-01-01&to=2026-01-31',
  ) {
    return fetch(`${base}/analytics/overview?${query}`, {
      headers: {
        ...(role ? { 'x-test-role': role } : {}),
        ...(org ? { 'x-test-org': org } : {}),
      },
    });
  }
  async function data(role = 'OWNER', org = 'org-a') {
    const response = await request(role, org);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return ((await response.json()) as Row).data;
  }

  it('requires authentication, analytics permission and tenant context', async () => {
    expect((await request()).status).toBe(401);
    for (const role of ['EMPLOYEE_SELF', 'VOLUNTEER_SELF', 'unknown'])
      expect((await request(role)).status).toBe(403);
    expect((await request('OWNER', null)).status).toBe(403);
  });
  it('returns tenant-scoped workforce, frozen payroll and recorded attendance/leave', async () => {
    const result = await data();
    expect(result.workforce).toMatchObject({ headcount: 6, joiners: 6, exits: 0 });
    expect(result.workforce.statuses).toEqual([{ label: 'ACTIVE', count: 6 }]);
    expect(result.workforce.retention).toEqual({
      suppressed: false,
      eligible: 6,
      retained: 6,
      ratePercent: 100,
    });
    expect(result.workforce.tenure).toEqual({
      suppressed: false,
      averageMonths: 0,
      bands: [
        { label: 'Under 1 year', count: 6 },
        { label: '1 to 3 years', count: 0 },
        { label: '3 to 5 years', count: 0 },
        { label: '5 years or more', count: 0 },
      ],
    });
    expect(result.payroll.months[0]).toMatchObject({
      grossMinorUnits: 60006,
      netMinorUnits: 54006,
      totalCostMinorUnits: 63006,
    });
    expect(result.payroll.distribution).toEqual([
      {
        month: '2026-01',
        currency: 'NGN',
        suppressed: false,
        workerCount: 6,
        bands: [
          { label: 'Below 50% of average', count: 0 },
          { label: '50% to 100% of average', count: 6 },
          { label: 'Above 100% to 150% of average', count: 0 },
          { label: 'Above 150% of average', count: 0 },
        ],
      },
    ]);
    expect(result.attendance).toMatchObject({ records: 6, present: 6 });
    // 22 weekdays minus 2.5 leave days each; one PRESENT record per worker.
    expect(result.attendance.scheduled).toEqual({
      suppressed: false,
      scheduledDays: 117,
      attendedDays: 6,
      ratePercent: 5.1,
    });
    expect(result.leave).toMatchObject({ approvedDays: 15, requests: 6 });
    expect(result.leave.byType).toEqual([
      {
        label: 'Annual leave',
        category: 'ANNUAL',
        requests: 6,
        approvedDays: 15,
        suppressed: false,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/workerId|org-b|reasonEncrypted|accountNumber/);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'analytics',
        newValue: { report: 'payroll_overview', from: '2026-01-01', to: '2026-01-31' },
      }),
    );
  });
  it('computes retention from period boundary snapshots', async () => {
    workers = workers.filter((w) => w.organisationId === 'org-a');
    workers[0]!.endDate = new Date('2026-01-10');
    const result = await data();
    expect(result.workforce.retention).toEqual({
      suppressed: false,
      eligible: 6,
      retained: 5,
      ratePercent: 83.3,
    });
  });
  it('suppresses tenure and retention below the minimum workforce cohort', async () => {
    workers = workers.filter((w) => w.organisationId === 'org-a').slice(0, 4);
    const result = await data();
    expect(result.workforce.retention).toEqual({
      suppressed: true,
      eligible: null,
      retained: null,
      ratePercent: null,
    });
    expect(result.workforce.tenure).toEqual({
      suppressed: true,
      averageMonths: null,
      bands: [],
    });
  });
  it('does not include another organisation even without relying on mocked RLS', async () => {
    workers = workers.filter((w) => w.organisationId !== 'org-b');
    const result = await data('OWNER', 'org-b');
    expect(result.workforce.headcount).toBe(0);
    // Other-tenant rows are still excluded by explicit organisation predicates.
    slips = slips.filter((r) => r.organisationId !== 'org-b');
    attendance = attendance.filter((r) => r.organisationId !== 'org-b');
    leave = leave.filter((r) => r.organisationId !== 'org-b');
    const empty = await data('OWNER', 'org-b');
    expect(empty.payroll.months).toEqual([]);
    expect(empty.payroll.distribution).toEqual([]);
    expect(empty.attendance.records).toBe(0);
    expect(empty.leave.approvedDays).toBe(0);
    expect(empty.leave.byType).toEqual([]);
  });
  it('bounds managers to themselves and direct reports without exposing payroll', async () => {
    // Scope lookup is normally protected by real RLS; constrain its double here.
    tx.worker.findFirst.mockResolvedValue(workers[0]);
    const result = await data('MANAGER');
    expect(result.scope).toBe('team');
    expect(result.workforce.headcount).toBe(5);
    expect(result.attendance.records).toBe(5);
    expect(result.leave.approvedDays).toBe(12.5);
    expect(result.payroll).toBeNull();
    expect(tx.payslip.groupBy).not.toHaveBeenCalled();
  });
  it('fails closed for a manager without a linked worker', async () => {
    tx.worker.findFirst.mockResolvedValue(null);
    const result = await data('MANAGER');
    expect(result.workforce.headcount).toBe(0);
    expect(result.attendance.records).toBe(0);
  });
  it.each(['HR_ADMINISTRATOR', 'VIEWER', 'SUPPORT_READ_ONLY'])(
    'never queries payroll for %s',
    async (role) => {
      expect((await data(role)).payroll).toBeNull();
      expect(tx.payslip.groupBy).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );
  it.each(['PAYROLL_ADMINISTRATOR', 'FINANCE_APPROVER', 'AUDITOR'])(
    'respects existing payroll access for %s',
    async (role) => {
      expect((await data(role)).payroll.months).toHaveLength(1);
    },
  );
  it('does not query attendance or leave where underlying access is absent', async () => {
    const result = await data('PAYROLL_ADMINISTRATOR');
    expect(result.attendance).toBeNull();
    expect(result.leave).toBeNull();
    expect(tx.attendanceRecord.groupBy).not.toHaveBeenCalled();
    expect(tx.leaveRequest.groupBy).not.toHaveBeenCalled();
    expect(tx.leaveRequest.findMany).not.toHaveBeenCalled();
  });
  it('suppresses sensitive aggregates with fewer than five distinct contributors', async () => {
    slips = slips.slice(0, 4);
    attendance = attendance.slice(0, 4);
    leave = leave.slice(0, 4);
    const result = await data();
    expect(result.payroll.months[0]).toMatchObject({ suppressed: true, netMinorUnits: null });
    expect(result.payroll.distribution[0]).toEqual({
      month: '2026-01',
      currency: 'NGN',
      suppressed: true,
      workerCount: null,
      bands: [],
    });
    expect(result.attendance).toMatchObject({ suppressed: true, records: null, absent: null });
    expect(result.leave).toEqual({
      suppressed: true,
      requests: null,
      approvedDays: null,
      byType: [],
    });
  });
  it('computes the scheduled attendance rate from schedule, leave and records only in scope', async () => {
    const result = await data();
    expect(result.attendance.scheduled).toMatchObject({ suppressed: false, ratePercent: 5.1 });
    // Only org-a workers contribute; org-b rows must not leak into the denominator.
    expect(JSON.stringify(result)).not.toMatch(/org-b/);
  });
  it('suppresses the scheduled rate below five workers even when records exist', async () => {
    workers = workers.filter((w) => w.organisationId === 'org-a').slice(0, 4);
    attendance = attendance.filter((r) => r.organisationId === 'org-a').slice(0, 4);
    const result = await data();
    expect(result.attendance.scheduled).toEqual({
      suppressed: true,
      scheduledDays: null,
      attendedDays: null,
      ratePercent: null,
    });
  });
  it('excludes drafts, unprocessed payroll, reversals and reversed originals', async () => {
    workers[0]!.status = 'DRAFT';
    slips[0]!.payrollRun.status = 'APPROVED';
    slips[1]!.payrollRun.reversedAt = new Date();
    slips[2]!.payrollRun.reversalOfRunId = 'original';
    const result = await data();
    expect(result.workforce.headcount).toBe(5);
    expect(result.workforce.joiners).toBe(5);
    expect(result.payroll.months[0]).toMatchObject({ suppressed: true });
  });
  it('uses inclusive period boundaries and never counts pending leave or out-of-period records', async () => {
    attendance.push({ ...attendance[0], date: new Date('2026-02-01') });
    leave.push({ ...leave[0], status: 'PENDING' });
    slips.push({ ...slips[0], periodEnd: new Date('2026-02-01') });
    const result = await data();
    expect(result.attendance.records).toBe(6);
    expect(result.leave.requests).toBe(6);
    expect(result.payroll.months[0].grossMinorUnits).toBe(60006);
  });
  it('counts leavers in historical snapshots but not after their recorded final day', async () => {
    workers[0]!.status = 'TERMINATED';
    workers[0]!.endDate = new Date('2026-02-01');
    workers[1]!.status = 'RESIGNED';
    workers[1]!.endDate = new Date('2026-01-30');
    const result = await data();
    expect(result.workforce.headcount).toBe(5);
    expect(result.workforce.exits).toBe(1);
  });
  it.each([
    'from=2026-02-30&to=2026-03-01',
    'from=2026-02-01&to=2026-01-01',
    'from=2024-01-01&to=2026-01-01',
    'from=2026-01-01T12:00:00Z',
    'from=2026-01-01&organisationId=org-b',
  ])('rejects invalid ranges or client tenant overrides: %s', async (query) => {
    expect((await request('OWNER', 'org-a', query)).status).toBe(400);
    expect(tx.worker.count).not.toHaveBeenCalled();
  });

  function reportRequest(path: string, role = 'OWNER', token?: string, org = 'org-a') {
    return fetch(`${base}/analytics/${path}`, {
      headers: {
        'x-test-role': role,
        'x-test-org': org,
        ...(token ? { 'x-step-up-token': token } : {}),
      },
    });
  }
  function stepUp(sub = 'actor', organisationId = 'org-a', expiresIn = 300) {
    return jwt.sign(
      { sub, organisationId, purpose: 'step_up' },
      { secret: stepUpSecret('analytics-test-secret'), expiresIn },
    );
  }
  const reportDates = 'from=2026-01-01&to=2026-01-31';

  it('lists only reports permitted by the underlying read grants, with Owner-only downloads', async () => {
    const hr = (await (await reportRequest('reports/catalogue', 'HR_ADMINISTRATOR')).json()) as Row;
    expect(hr.canExport).toBe(false);
    expect(hr.data.map((r: Row) => r.type)).toEqual([
      'employee',
      'attendance',
      'leave',
      'department',
      'retention',
      'tenure',
      'leave-types',
    ]);
    const payroll = (await (
      await reportRequest('reports/catalogue', 'PAYROLL_ADMINISTRATOR')
    ).json()) as Row;
    expect(payroll.data.map((r: Row) => r.type)).toEqual([
      'payroll',
      'department',
      'retention',
      'tenure',
      'pay-distribution',
      'workforce-cost',
    ]);
    expect(
      (await reportRequest(`reports?type=payroll&${reportDates}`, 'HR_ADMINISTRATOR')).status,
    ).toBe(403);
    expect(tx.payslip.groupBy).not.toHaveBeenCalled();
  });
  it('paginates the directory and excludes other-tenant and restricted fields', async () => {
    const response = await reportRequest(`reports?type=employee&${reportDates}&page=2&pageSize=2`);
    expect(response.status).toBe(200);
    const { data: report } = (await response.json()) as Row;
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0].employeeNumber).toBe('W2');
    expect(report.meta).toEqual({ page: 2, pageSize: 2, total: 6, totalPages: 3 });
    expect(JSON.stringify(report)).not.toMatch(
      /workerId|organisationId|bank|reasonEncrypted|userId/,
    );
    expect(tx.payslip.groupBy).not.toHaveBeenCalled();
  });
  it('applies team scope to directory preview and hides inaccessible report types', async () => {
    tx.worker.findFirst.mockResolvedValue(workers[0]);
    const { data: report } = (await (
      await reportRequest(`reports?type=employee&${reportDates}`, 'MANAGER')
    ).json()) as Row;
    expect(report.rows).toHaveLength(5);
    expect(report.scope).toBe('team');
    expect(report.canExport).toBe(false);
    expect(
      (await reportRequest(`reports?type=workforce-cost&${reportDates}`, 'MANAGER')).status,
    ).toBe(403);
  });
  it('never lets a client-provided organisation header override report tenant predicates', async () => {
    workers = workers.filter((row) => row.organisationId === 'org-a');
    const { data: report } = (await (
      await reportRequest(`reports?type=employee&${reportDates}`, 'OWNER', undefined, 'org-b')
    ).json()) as Row;
    expect(report.rows).toEqual([]);
    expect(report.meta.total).toBe(0);
    const csv = await reportRequest(
      `reports/export?type=employee&format=csv&${reportDates}`,
      'OWNER',
      undefined,
      'org-b',
    );
    expect(csv.status).toBe(200);
    expect(await csv.text()).not.toContain('Person');
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organisationId: 'org-b',
          newValue: expect.objectContaining({ rowCount: 0 }),
        }),
      }),
    );
  });
  it.each([
    'HR_ADMINISTRATOR',
    'PAYROLL_ADMINISTRATOR',
    'FINANCE_APPROVER',
    'AUDITOR',
    'MANAGER',
    'VIEWER',
    'SUPPORT_READ_ONLY',
  ])('denies analytics downloads for %s without expanding permissions', async (role) => {
    expect(
      (await reportRequest(`reports/export?type=department&format=csv&${reportDates}`, role))
        .status,
    ).toBe(403);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('exports the entire directory rather than only the current preview page, and audits exact row count', async () => {
    const response = await reportRequest(`reports/export?type=employee&format=csv&${reportDates}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toContain(
      'ascenda-employee-2026-01-01-2026-01-31.csv',
    );
    const csv = await response.text();
    expect(csv).toContain('Person 0 Fixture');
    expect(csv).toContain('Person 5 Fixture');
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'EXPORT_CREATED',
          actorId: 'actor',
          newValue: expect.objectContaining({ report: 'employee', format: 'csv', rowCount: 6 }),
        }),
      }),
    );
  });
  it.each([
    { type: 'payroll', marker: '600.06' },
    { type: 'workforce-cost', marker: '630.06' },
    { type: 'pay-distribution', marker: '50% to 100% of average' },
  ])('requires fresh user-and-tenant-bound step-up on $type exports', async ({ type, marker }) => {
    const path = `reports/export?type=${type}&format=csv&${reportDates}`;
    expect((await reportRequest(path)).status).toBe(403);
    for (const token of [
      stepUp('other-user'),
      stepUp('actor', 'org-b'),
      stepUp('actor', 'org-a', -1),
      'invalid',
    ]) {
      expect((await reportRequest(path, 'OWNER', token)).status).toBe(403);
    }
    expect(tx.payslip.groupBy).not.toHaveBeenCalled();
    const response = await reportRequest(path, 'OWNER', stepUp());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(marker);
    const entry = tx.auditLog.create.mock.calls[0][0].data;
    expect(JSON.stringify(entry.newValue)).not.toContain('600.06');
    expect(JSON.stringify(entry.newValue)).not.toContain('630.06');
  });
  it('preserves suppression in report preview, CSV and PDF', async () => {
    slips = slips.slice(0, 4);
    const path = `reports?type=payroll&${reportDates}`;
    const { data: report } = (await (await reportRequest(path)).json()) as Row;
    expect(report.rows[0].grossMinorUnits).toBeNull();
    const csv = await reportRequest(
      `reports/export?type=payroll&format=csv&${reportDates}`,
      'OWNER',
      stepUp(),
    );
    expect(await csv.text()).toContain('Hidden');
    const pdf = await reportRequest(
      `reports/export?type=payroll&format=pdf&${reportDates}`,
      'OWNER',
      stepUp(),
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  });
  it('fails closed instead of returning a download when export auditing fails', async () => {
    tx.auditLog.create.mockRejectedValueOnce(new Error('Synthetic audit failure'));
    const response = await reportRequest(
      `reports/export?type=department&format=csv&${reportDates}`,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('content-disposition')).toBeNull();
  });
  it('rejects oversized synchronous exports without returning partial data', async () => {
    tx.worker.count.mockResolvedValue(5001);
    const response = await reportRequest(`reports/export?type=employee&format=csv&${reportDates}`);
    expect(response.status).toBe(400);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('rejects a changing directory rather than silently exporting an incomplete result', async () => {
    tx.worker.count.mockResolvedValue(7);
    expect(
      (await reportRequest(`reports/export?type=employee&format=csv&${reportDates}`)).status,
    ).toBe(400);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it.each([
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
  ])(
    'previews and exports the %s report through the same source data and constraints',
    async (type) => {
      expect((await reportRequest(`reports?type=${type}&${reportDates}`)).status).toBe(200);
      const response = await reportRequest(
        `reports/export?type=${type}&format=csv&${reportDates}`,
        'OWNER',
        stepUp(),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/csv');
    },
  );
  it.each([
    'type=unknown',
    'type=employee&page=0',
    'type=employee&pageSize=101',
    'type=employee&page=1.5',
    'type=employee&organisationId=org-b',
  ])('validates report selectors, pagination and tenant override attempts: %s', async (query) => {
    expect((await reportRequest(`reports?${query}&${reportDates}`)).status).toBe(400);
  });
  it.each(['format=xlsx', 'format=csv&page=1', 'format=csv&organisationId=org-b'])(
    'rejects unsupported formats and export query overrides: %s',
    async (query) => {
      expect(
        (await reportRequest(`reports/export?type=department&${query}&${reportDates}`)).status,
      ).toBe(400);
    },
  );
});
