import { DEFAULT_WORK_SCHEDULE } from './working-days';
import {
  scheduledAttendanceForWorker,
  type ScheduledAttendanceWorkerInput,
} from './scheduled-attendance';

const rangeStart = new Date('2026-01-01');
const rangeEnd = new Date('2026-01-31');

function worker(overrides: Partial<ScheduledAttendanceWorkerInput> = {}): ScheduledAttendanceWorkerInput {
  return {
    workerId: 'w1',
    startDate: new Date('2025-01-01'),
    endDate: null,
    schedule: DEFAULT_WORK_SCHEDULE,
    holidays: [],
    attendance: [],
    leave: [],
    ...overrides,
  };
}

function count(input: ScheduledAttendanceWorkerInput) {
  return scheduledAttendanceForWorker(input, rangeStart, rangeEnd);
}

describe('scheduled attendance domain (ANA-03)', () => {
  it('counts weekdays only and excludes public holidays', () => {
    // January 2026 has 22 weekdays; 1 Jan is a holiday.
    const result = count(
      worker({
        holidays: [{ date: new Date('2026-01-01'), isRecurring: false }],
      }),
    );
    expect(result.scheduledDays).toBe(21);
    expect(result.attendedDays).toBe(0);
  });

  it('honours recurring holidays and per-worker schedule overrides', () => {
    const result = count(
      worker({
        startDate: new Date('2026-01-01'),
        schedule: { ...DEFAULT_WORK_SCHEDULE, workDays: [1] },
        holidays: [{ date: new Date('2025-01-01'), isRecurring: true }],
      }),
    );
    // Four Mondays in January; the recurring 1 Jan holiday falls on a Thursday.
    expect(result.scheduledDays).toBe(4);
  });

  it('prorates joiners and leavers by their recorded employment dates', () => {
    expect(
      count(worker({ startDate: new Date('2026-01-15') })).scheduledDays,
    ).toBe(12); // 15–31 Jan weekdays
    expect(
      count(worker({ endDate: new Date('2026-01-15') })).scheduledDays,
    ).toBe(11); // 1–15 Jan weekdays
  });

  it('counts PRESENT, LATE, REMOTE and HALF_DAY but not other statuses', () => {
    const input = worker({
      attendance: [
        { date: new Date('2026-01-02'), status: 'PRESENT' },
        { date: new Date('2026-01-05'), status: 'LATE' },
        { date: new Date('2026-01-06'), status: 'REMOTE' },
        { date: new Date('2026-01-07'), status: 'HALF_DAY' },
        { date: new Date('2026-01-08'), status: 'ABSENT' },
        { date: new Date('2026-01-09'), status: 'ON_LEAVE' },
        { date: new Date('2026-01-12'), status: 'OFF_DAY' },
      ],
    });
    expect(count(input)).toMatchObject({
      scheduledDays: 22,
      attendedDays: 3.5,
      unapprovedAbsenceDays: 1,
      months: [
        {
          month: '2026-01',
          scheduledDays: 22,
          attendedDays: 3.5,
          unapprovedAbsenceDays: 1,
          lateArrivals: 0,
          clockIns: 0,
        },
      ],
    });
  });

  it('removes approved leave from the denominator, including half days', () => {
    const result = count(
      worker({
        leave: [
          {
            startDate: new Date('2026-01-02'),
            endDate: new Date('2026-01-05'),
            startHalfDay: true,
            endHalfDay: false,
          },
        ],
      }),
    );
    // 2 Jan half removed, 5 Jan fully removed: 22 - 1.5 = 20.5.
    expect(result.scheduledDays).toBe(20.5);
  });

  it('combines complementary half-day leave requests into one full day', () => {
    const result = count(
      worker({
        leave: [
          {
            startDate: new Date('2026-01-02'),
            endDate: new Date('2026-01-02'),
            startHalfDay: true,
            endHalfDay: false,
          },
          {
            startDate: new Date('2026-01-02'),
            endDate: new Date('2026-01-02'),
            startHalfDay: false,
            endHalfDay: true,
          },
        ],
      }),
    );
    // Morning + afternoon leave remove the whole working day: 22 - 1 = 21.
    expect(result.scheduledDays).toBe(21);
    expect(result.attendedDays).toBe(0);
  });

  it('clips leave and attendance to the selected range and caps overlapping leave', () => {
    const result = count(
      worker({
        attendance: [
          { date: new Date('2025-12-31'), status: 'PRESENT' },
          { date: new Date('2026-01-02'), status: 'PRESENT' },
        ],
        leave: [
          {
            startDate: new Date('2025-12-31'),
            endDate: new Date('2026-01-02'),
            startHalfDay: false,
            endHalfDay: false,
          },
          {
            startDate: new Date('2026-01-02'),
            endDate: new Date('2026-01-02'),
            startHalfDay: true,
            endHalfDay: true,
          },
        ],
      }),
    );
    // 1 and 2 Jan are both in range and fully covered by leave; the PRESENT
    // record on 2 Jan cannot be credited above the remaining availability.
    expect(result).toMatchObject({ workerId: 'w1', scheduledDays: 20, attendedDays: 0 });
  });

  it('returns zero for a range with no scheduled working days', () => {
    const result = scheduledAttendanceForWorker(
      worker({ schedule: { ...DEFAULT_WORK_SCHEDULE, workDays: [] } }),
      rangeStart,
      rangeEnd,
    );
    expect(result).toMatchObject({ workerId: 'w1', scheduledDays: 0, attendedDays: 0 });
  });
});
