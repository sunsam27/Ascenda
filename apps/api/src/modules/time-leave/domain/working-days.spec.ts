import {
  DEFAULT_WORK_SCHEDULE,
  WorkSchedule,
  countLeaveDays,
  eachDay,
  isHoliday,
  isWorkingDay,
  isoWeekday,
  startOfUtcDay,
  type HolidayLike,
} from './working-days';

const utc = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

const holiday = (date: string, isRecurring = false): HolidayLike => ({
  date: utc(date),
  isRecurring,
});

const span = (
  start: string,
  end: string,
  extra: Partial<{
    startHalfDay: boolean;
    endHalfDay: boolean;
    schedule: WorkSchedule;
    holidays: HolidayLike[];
  }> = {},
): number =>
  countLeaveDays({
    start: utc(start),
    end: utc(end),
    schedule: extra.schedule ?? DEFAULT_WORK_SCHEDULE,
    holidays: extra.holidays ?? [],
    startHalfDay: extra.startHalfDay,
    endHalfDay: extra.endHalfDay,
  });

describe('working-days', () => {
  describe('startOfUtcDay / isoWeekday', () => {
    it('normalises to UTC midnight', () => {
      const d = new Date('2026-01-05T23:59:59.999Z');
      expect(startOfUtcDay(d).toISOString()).toBe('2026-01-05T00:00:00.000Z');
    });

    it('maps weekdays to ISO numbers (Mon=1 … Sun=7)', () => {
      expect(isoWeekday(utc('2026-01-05'))).toBe(1); // Mon
      expect(isoWeekday(utc('2026-01-09'))).toBe(5); // Fri
      expect(isoWeekday(utc('2026-01-10'))).toBe(6); // Sat
      expect(isoWeekday(utc('2026-01-11'))).toBe(7); // Sun
    });
  });

  it('enumerates every day in a span inclusively', () => {
    expect(eachDay(utc('2026-01-05'), utc('2026-01-08'))).toHaveLength(4);
    expect(eachDay(utc('2026-01-08'), utc('2026-01-05'))).toHaveLength(0);
  });

  it('treats a single configured working day as 1 day', () => {
    expect(span('2026-01-05', '2026-01-05')).toBe(1);
  });

  it('excludes weekend days', () => {
    // Fri 2 Jan → Mon 5 Jan: only Fri and Mon count.
    expect(span('2026-01-02', '2026-01-05')).toBe(2);
    expect(span('2026-01-03', '2026-01-04')).toBe(0); // Sat → Sun
  });

  it('recognises one-off and recurring holidays', () => {
    expect(isHoliday(utc('2026-01-07'), [holiday('2026-01-07')])).toBe(true);
    expect(isHoliday(utc('2026-01-08'), [holiday('2026-01-07')])).toBe(false);
    // A recurring holiday matches the same month/day in a later year.
    expect(isHoliday(utc('2026-01-01'), [holiday('2020-01-01', true)])).toBe(true);
    // …but not a year before it was introduced.
    expect(isHoliday(utc('2019-01-01'), [holiday('2020-01-01', true)])).toBe(false);
  });

  // PRD 12.2: "Requests overlapping public holidays count working days only."
  it('counts working days only when a span overlaps a public holiday', () => {
    // Mon 5 → Fri 9 Jan with Wed 7 Jan a public holiday → 4 working days.
    expect(
      span('2026-01-05', '2026-01-09', { holidays: [holiday('2026-01-07')] }),
    ).toBe(4);
  });

  it('does not double-exclude a holiday that lands on a weekend', () => {
    // Sat 3 & Sun 4 are weekends; Sat is also a holiday — still 0.
    expect(
      span('2026-01-03', '2026-01-04', { holidays: [holiday('2026-01-03')] }),
    ).toBe(0);
  });

  describe('half days (LVE-03)', () => {
    it('subtracts 0.5 for a half-day start / end', () => {
      expect(span('2026-01-05', '2026-01-09', { startHalfDay: true })).toBe(4.5);
      expect(span('2026-01-05', '2026-01-09', { endHalfDay: true })).toBe(4.5);
      expect(
        span('2026-01-05', '2026-01-09', {
          startHalfDay: true,
          endHalfDay: true,
        }),
      ).toBe(4);
    });

    it('treats a single-day half day as 0.5', () => {
      expect(span('2026-01-05', '2026-01-05', { startHalfDay: true })).toBe(0.5);
      expect(
        span('2026-01-05', '2026-01-05', {
          startHalfDay: true,
          endHalfDay: true,
        }),
      ).toBe(0.5);
    });

    it('ignores a half-day flag on a non-working boundary day', () => {
      // Sat 3 → Mon 5, half-day start: Sat is not working, so no reduction.
      expect(span('2026-01-03', '2026-01-05', { startHalfDay: true })).toBe(1);
    });

    it('combines holidays with half days', () => {
      // Mon 5 → Fri 9, Wed 7 is a holiday, start is a half day → 3.5.
      expect(
        span('2026-01-05', '2026-01-09', {
          startHalfDay: true,
          holidays: [holiday('2026-01-07')],
        }),
      ).toBe(3.5);
    });
  });

  it('honours a custom working week', () => {
    const sundayOnly: WorkSchedule = { ...DEFAULT_WORK_SCHEDULE, workDays: [7] };
    expect(span('2026-01-04', '2026-01-04', { schedule: sundayOnly })).toBe(1);
    expect(span('2026-01-05', '2026-01-05', { schedule: sundayOnly })).toBe(0);
    expect(isoWeekday(utc('2026-01-04'))).toBe(7);
  });

  it('normalises timestamps to the civil day', () => {
    expect(isWorkingDay(utc('2026-01-05'), DEFAULT_WORK_SCHEDULE, [])).toBe(true);
    expect(
      startOfUtcDay(new Date('2026-01-05T23:59:59Z')).getTime(),
    ).toBe(utc('2026-01-05').getTime());
  });
});
