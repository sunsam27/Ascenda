import { DEFAULT_WORK_SCHEDULE, HolidayLike } from './working-days';
import { buildCalendar, isoDate } from './leave-calendar';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('team leave calendar (LVE-05)', () => {
  const noHolidays: HolidayLike[] = [];

  it('expands spans into one bucket per day, inclusive of both ends', () => {
    const buckets = buildCalendar(
      d('2026-03-02'),
      d('2026-03-04'),
      [{ start: d('2026-03-02'), end: d('2026-03-03') }],
      DEFAULT_WORK_SCHEDULE,
      noHolidays,
    );

    expect(buckets.map((b) => isoDate(b.date))).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
    expect(buckets.map((b) => b.onLeaveCount)).toEqual([1, 1, 0]);
    expect(buckets[0]!.entryIndexes).toEqual([0]);
    expect(buckets[2]!.entryIndexes).toEqual([]);
  });

  it('counts overlapping workers as head-count per day', () => {
    const buckets = buildCalendar(
      d('2026-03-02'),
      d('2026-03-02'),
      [
        { start: d('2026-03-02'), end: d('2026-03-06') },
        { start: d('2026-03-02'), end: d('2026-03-02') },
      ],
      DEFAULT_WORK_SCHEDULE,
      noHolidays,
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.onLeaveCount).toBe(2);
    expect(buckets[0]!.entryIndexes).toEqual([0, 1]);
  });

  it('marks weekends as non-working while still spanning them', () => {
    // Fri 2026-03-06 → Mon 2026-03-09 spans a Saturday and a Sunday.
    const buckets = buildCalendar(
      d('2026-03-06'),
      d('2026-03-09'),
      [{ start: d('2026-03-06'), end: d('2026-03-09') }],
      DEFAULT_WORK_SCHEDULE,
      noHolidays,
    );

    expect(buckets.map((b) => isoDate(b.date))).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ]);
    expect(buckets.map((b) => b.isWorkingDay)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(buckets.map((b) => b.onLeaveCount)).toEqual([1, 1, 1, 1]);
  });

  it('marks a public holiday as non-working', () => {
    const holidays: HolidayLike[] = [
      { date: d('2026-03-03'), isRecurring: false },
    ];
    const buckets = buildCalendar(
      d('2026-03-02'),
      d('2026-03-03'),
      [{ start: d('2026-03-02'), end: d('2026-03-03') }],
      DEFAULT_WORK_SCHEDULE,
      holidays,
    );

    expect(buckets[0]!.isWorkingDay).toBe(true);
    expect(buckets[1]!.isWorkingDay).toBe(false);
    expect(buckets[1]!.onLeaveCount).toBe(1);
  });

  it('returns an empty calendar when the range is inverted', () => {
    const buckets = buildCalendar(
      d('2026-03-04'),
      d('2026-03-02'),
      [],
      DEFAULT_WORK_SCHEDULE,
      noHolidays,
    );
    expect(buckets).toEqual([]);
  });
});
