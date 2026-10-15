import { toWorkerSummary } from './workers.service';

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
