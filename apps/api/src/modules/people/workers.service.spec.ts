import { requestContext } from '../../common/context/request-context';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { toWorkerSummary, WorkersService } from './workers.service';

const base = {
  id: 'w1',
  organisationId: 'org1',
  userId: null,
  employeeNumber: 'EMP-001',
  firstName: 'Ada',
  lastName: 'Okafor',
  preferredName: null,
  email: 'ada@example.com',
  phone: null,
  category: 'EMPLOYEE',
  employmentType: 'FULL_TIME',
  status: 'ACTIVE',
  jobTitle: 'Pastor',
  departmentId: null,
  locationId: null,
  managerId: null,
  startDate: new Date('2026-01-05T00:00:00.000Z'),
  endDate: null,
  createdAt: new Date('2026-01-01T08:00:00.000Z'),
  updatedAt: new Date('2026-02-01T08:00:00.000Z'),
  createdBy: 'u1',
  department: null,
  location: null,
  workerIdentity: null,
};

describe('toWorkerSummary', () => {
  it('maps a bare worker with nulls flattened to undefined', () => {
    const summary = toWorkerSummary(base as never);
    expect(summary).toMatchObject({
      id: 'w1',
      employeeNumber: 'EMP-001',
      category: 'EMPLOYEE',
      status: 'ACTIVE',
      startDate: '2026-01-05T00:00:00.000Z',
    });
    expect(summary.departmentName).toBeUndefined();
    expect(summary.locationName).toBeUndefined();
    expect(summary.dateOfBirth).toBeUndefined();
    expect(summary.gender).toBeUndefined();
    expect(summary.endDate).toBeUndefined();
  });

  it('resolves department/location names and identity fields', () => {
    const summary = toWorkerSummary({
      ...base,
      departmentId: 'd1',
      locationId: 'l1',
      department: { name: 'Ministry' },
      location: { name: 'Lagos HQ' },
      workerIdentity: {
        dateOfBirth: new Date('1990-06-15T00:00:00.000Z'),
        gender: 'FEMALE',
      },
    } as never);

    expect(summary.departmentName).toBe('Ministry');
    expect(summary.locationName).toBe('Lagos HQ');
    expect(summary.dateOfBirth).toBe('1990-06-15T00:00:00.000Z');
    expect(summary.gender).toBe('FEMALE');
  });

  it('serialises endDate when a worker has left', () => {
    const summary = toWorkerSummary({
      ...base,
      status: 'TERMINATED',
      endDate: new Date('2026-09-30T00:00:00.000Z'),
    } as never);
    expect(summary.endDate).toBe('2026-09-30T00:00:00.000Z');
  });
});

/** Minimal Prisma transaction double for the import path. */
function fakeTx() {
  return {
    department: { findMany: async () => [] },
    location: { findMany: async () => [] },
    worker: {
      findMany: async () => [],
      createMany: async ({ data }: { data: unknown[] }) => ({
        count: data.length,
      }),
    },
    workerIdentity: { createMany: async () => ({ count: 0 }) },
  };
}

const CSV = [
  'Employee Number,First Name,Last Name,Email,Job Title,Start Date',
  'IMP-1,Ada,Okafor,ada@example.com,Pastor,2026-01-05',
].join('\n');

describe('commitImport', () => {
  it('audits a summary (never the raw CSV) when rows are created', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      withRequestContext: (fn: (tx: unknown) => Promise<unknown>) =>
        fn(fakeTx()),
    } as unknown as PrismaService;
    const service = new WorkersService(
      prisma,
      { record } as unknown as AuditService,
    );

    const result = await requestContext.run(
      { organisationId: 'org1', userId: 'u1' },
      () => service.commitImport(CSV),
    );

    expect(result).toMatchObject({ created: 1, skipped: 0, total: 1 });
    expect(record).toHaveBeenCalledTimes(1);

    const entry = record.mock.calls[0]![0] as {
      action: string;
      newValue: Record<string, unknown>;
    };
    expect(entry.action).toBe('WORKER_CREATED');
    expect(entry.newValue).toMatchObject({
      source: 'csv_import',
      total: 1,
      created: 1,
      skipped: 0,
    });
    // The CSV payload / PII must never land in the audit value.
    expect(JSON.stringify(entry.newValue)).not.toContain('ada@example.com');
  });
});
