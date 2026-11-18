import { TimeLeaveAnalyticsReader } from './time-leave-analytics.reader';

type Row = Record<string, any>;

/** The reader's Prisma calls, doubled with the minimal data needed for ANA-03. */
describe('TimeLeaveAnalyticsReader.scheduledAttendance', () => {
  const workers: Row[] = [
    {
      id: 'weekend-worker',
      startDate: new Date('2025-01-01'),
      endDate: null,
      locationId: 'weekend-location',
    },
    { id: 'default-worker', startDate: new Date('2025-01-01'), endDate: null, locationId: null },
  ];

  function tx() {
    return {
      worker: { findMany: jest.fn(async () => workers) },
      organisation: {
        findFirst: jest.fn(async () => ({
          workDays: [1, 2, 3, 4, 5],
          workDayStart: '09:00',
          workDayEnd: '17:00',
          lateGraceMinutes: 0,
        })),
      },
      location: {
        findMany: jest.fn(async () => [
          {
            id: 'weekend-location',
            workDays: [6, 7],
            workDayStart: null,
            workDayEnd: null,
            lateGraceMinutes: null,
          },
        ]),
      },
      holiday: {
        findMany: jest.fn(async () => [
          { date: new Date('2025-01-01'), isRecurring: true, locationId: null },
        ]),
      },
      attendanceRecord: {
        findMany: jest.fn(async () => [
          { workerId: 'weekend-worker', date: new Date('2026-01-03'), status: 'PRESENT' },
          { workerId: 'default-worker', date: new Date('2026-01-05'), status: 'LATE' },
        ]),
      },
      leaveRequest: {
        findMany: jest.fn(async () => [
          {
            workerId: 'default-worker',
            startDate: new Date('2026-01-06'),
            endDate: new Date('2026-01-07'),
            startHalfDay: false,
            endHalfDay: false,
          },
        ]),
      },
    };
  }

  it('applies per-location schedules, recurring holidays and approved leave', async () => {
    const client = tx();
    const result = await new TimeLeaveAnalyticsReader().scheduledAttendance(
      client as never,
      'org-a',
      {},
      new Date('2026-01-01'),
      new Date('2026-01-11'),
    );
    const byWorker = new Map(result.map((row) => [row.workerId, row]));
    // Weekend override: Sat 3, Sun 4 and Sat 10. The recurring 1 Jan holiday is a Thursday.
    expect(byWorker.get('weekend-worker')).toEqual({
      workerId: 'weekend-worker',
      scheduledDays: 3,
      attendedDays: 1,
    });
    // Org weekdays 1–10 minus the 1 Jan holiday minus two days of approved leave.
    expect(byWorker.get('default-worker')).toEqual({
      workerId: 'default-worker',
      scheduledDays: 4,
      attendedDays: 1,
    });
  });

  it('returns no rows when the caller scope has no workers', async () => {
    const client = tx();
    client.worker.findMany.mockResolvedValueOnce([]);
    await expect(
      new TimeLeaveAnalyticsReader().scheduledAttendance(
        client as never,
        'org-a',
        {},
        new Date('2026-01-01'),
        new Date('2026-01-11'),
      ),
    ).resolves.toEqual([]);
  });
});
