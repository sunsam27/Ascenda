import {
  DEFAULT_ATTENDANCE_SCHEDULE,
  clockInStatus,
  computeHoursWorked,
  isLate,
  lateMinutes,
  minutesSinceMidnight,
  parseTimeToMinutes,
  resolveSchedule,
  scheduledMinutes,
} from './attendance';
import { DEFAULT_WORK_SCHEDULE } from './working-days';

/** Build a UTC timestamp for a given date at HH:mm. */
function at(year: number, month: number, day: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hh, mm));
}

describe('parseTimeToMinutes', () => {
  it('parses valid HH:mm values', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('17:05')).toBe(1025);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('rejects malformed values', () => {
    expect(() => parseTimeToMinutes('9:00')).toThrow();
    expect(() => parseTimeToMinutes('24:00')).toThrow();
    expect(() => parseTimeToMinutes('09:60')).toThrow();
    expect(() => parseTimeToMinutes('nonsense')).toThrow();
  });
});

describe('resolveSchedule', () => {
  it('falls back to defaults when nothing is configured', () => {
    expect(resolveSchedule(null, null)).toEqual(DEFAULT_ATTENDANCE_SCHEDULE);
  });

  it('uses organisation defaults when there is no location', () => {
    const schedule = resolveSchedule(
      {
        workDays: [1, 2, 3, 4, 5, 6],
        workDayStart: '08:00',
        workDayEnd: '16:00',
        lateGraceMinutes: 10,
      },
      null,
    );
    expect(schedule).toEqual({
      workDays: [1, 2, 3, 4, 5, 6],
      workDayStart: '08:00',
      workDayEnd: '17:00'.replace('17:00', '16:00'),
      lateGraceMinutes: 10,
    });
    expect(scheduledMinutes(schedule)).toBe(480);
  });

  it('lets a location override individual fields and inherit the rest', () => {
    const schedule = resolveSchedule(
      {
        workDays: [1, 2, 3, 4, 5],
        workDayStart: '09:00',
        workDayEnd: '17:00',
        lateGraceMinutes: 5,
      },
      {
        workDays: [1, 2, 3, 4, 5, 6],
        workDayStart: '08:00',
        workDayEnd: null,
        lateGraceMinutes: null,
      },
    );
    expect(schedule).toEqual({
      workDays: [1, 2, 3, 4, 5, 6],
      workDayStart: '08:00',
      workDayEnd: '17:00',
      lateGraceMinutes: 5,
    });
  });

  it('falls back to defaults when no organisation row exists', () => {
    const schedule = resolveSchedule(null, {
      workDays: [],
      workDayStart: '07:00',
      workDayEnd: null,
      lateGraceMinutes: null,
    });
    expect(schedule.workDayStart).toBe('07:00');
    expect(schedule.workDays).toEqual(DEFAULT_WORK_SCHEDULE.workDays);
    expect(schedule.workDayEnd).toBe(DEFAULT_ATTENDANCE_SCHEDULE.workDayEnd);
  });
});

describe('scheduledMinutes / minutesSinceMidnight', () => {
  it('computes the scheduled day length', () => {
    expect(scheduledMinutes(DEFAULT_ATTENDANCE_SCHEDULE)).toBe(480);
  });

  it('never returns negative for an overnight/invalid window', () => {
    expect(
      scheduledMinutes({ ...DEFAULT_ATTENDANCE_SCHEDULE, workDayEnd: '08:00', workDayStart: '17:00' }),
    ).toBe(0);
  });

  it('reads minutes since midnight in UTC', () => {
    expect(minutesSinceMidnight(at(2026, 1, 5, 9, 15))).toBe(555);
  });
});

describe('isLate / lateMinutes', () => {
  const schedule = { ...DEFAULT_ATTENDANCE_SCHEDULE, lateGraceMinutes: 10 };

  it('treats arrival within the grace period as on time', () => {
    expect(isLate(at(2026, 1, 5, 9, 10), schedule)).toBe(false);
    expect(lateMinutes(at(2026, 1, 5, 9, 10), schedule)).toBe(10);
    expect(isLate(at(2026, 1, 5, 8, 55), schedule)).toBe(false);
    expect(lateMinutes(at(2026, 1, 5, 8, 55), schedule)).toBe(0);
  });

  it('flags an arrival after the grace period as late', () => {
    expect(isLate(at(2026, 1, 5, 9, 11), schedule)).toBe(true);
    expect(lateMinutes(at(2026, 1, 5, 9, 45), schedule)).toBe(45);
  });
});

describe('clockInStatus', () => {
  it('marks a non-working day OFF_DAY', () => {
    expect(
      clockInStatus({
        clockIn: at(2026, 12, 25, 9, 0),
        isWorkingDay: false,
        schedule: DEFAULT_ATTENDANCE_SCHEDULE,
      }),
    ).toBe('OFF_DAY');
  });

  it('marks a late arrival LATE and an on-time one PRESENT', () => {
    const schedule = { ...DEFAULT_WORK_SCHEDULE, lateGraceMinutes: 10 };
    expect(
      clockInStatus({ clockIn: at(2026, 12, 21, 9, 20), isWorkingDay: true, schedule }),
    ).toBe('LATE');
    expect(
      clockInStatus({ clockIn: at(2026, 12, 21, 9, 5), isWorkingDay: true, schedule }),
    ).toBe('PRESENT');
  });
});

describe('computeHoursWorked', () => {
  it('computes and rounds hours to 2dp', () => {
    expect(computeHoursWorked(at(2026, 12, 21, 9, 0), at(2026, 12, 21, 17, 0))).toBe(8);
    expect(computeHoursWorked(at(2026, 12, 21, 9, 0), at(2026, 12, 21, 17, 30))).toBe(8.5);
    expect(computeHoursWorked(at(2026, 12, 21, 9, 0), at(2026, 12, 21, 16, 7))).toBe(7.12);
  });

  it('returns 0 for non-positive spans', () => {
    expect(computeHoursWorked(at(2026, 12, 21, 9, 0), at(2026, 12, 21, 9, 0))).toBe(0);
    expect(computeHoursWorked(at(2026, 12, 21, 10, 0), at(2026, 12, 21, 9, 0))).toBe(0);
  });
});

describe('minutesSinceMidnight', () => {
  it('is zero at UTC midnight', () => {
    expect(minutesSinceMidnight(at(2026, 12, 21, 0, 0))).toBe(0);
  });
});

describe('isLate/lateMinutes defaults', () => {
  it('treats the default schedule as on-time at exactly 09:00', () => {
    expect(isLate(at(2026, 12, 21, 9, 0), DEFAULT_ATTENDANCE_SCHEDULE)).toBe(false);
    expect(lateMinutes(at(2026, 12, 21, 9, 0), DEFAULT_ATTENDANCE_SCHEDULE)).toBe(0);
    expect(scheduledMinutes(DEFAULT_ATTENDANCE_SCHEDULE)).toBe(480);
  });
});
