import {
  addDays,
  calendarDateIn,
  compareCalendar,
  daysBetween,
  endOfDay,
  startOfDay,
  startOfMonth,
  startOfNextMonth,
  toIsoDate,
} from './dashboard.time';

const LAGOS = 'Africa/Lagos'; // UTC+1, no DST

describe('calendarDateIn', () => {
  it('resolves the wall-clock date in the given timezone', () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Lagos.
    const instant = new Date('2026-09-30T23:30:00Z');
    expect(calendarDateIn(instant, LAGOS)).toEqual({
      year: 2026,
      month: 10,
      day: 1,
    });
  });

  it('keeps the same day for a UTC midday instant', () => {
    expect(calendarDateIn(new Date('2026-10-14T12:00:00Z'), LAGOS)).toEqual({
      year: 2026,
      month: 10,
      day: 14,
    });
  });
});

describe('startOfDay / endOfDay', () => {
  it('returns the Lagos-local day bounds as UTC instants', () => {
    const cal = { year: 2026, month: 10, day: 1 };
    expect(startOfDay(cal, LAGOS).toISOString()).toBe(
      '2026-09-30T23:00:00.000Z',
    );
    expect(endOfDay(cal, LAGOS).toISOString()).toBe(
      '2026-10-01T22:59:59.999Z',
    );
  });
});

describe('addDays', () => {
  it('rolls over a month boundary', () => {
    expect(addDays({ year: 2026, month: 10, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 11,
      day: 1,
    });
  });

  it('rolls over a year boundary', () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });
});

describe('startOfMonth / startOfNextMonth', () => {
  it('returns the first of the current month', () => {
    expect(startOfMonth({ year: 2026, month: 10, day: 14 })).toEqual({
      year: 2026,
      month: 10,
      day: 1,
    });
  });

  it('rolls December to January of the next year', () => {
    expect(startOfNextMonth({ year: 2026, month: 12, day: 5 })).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });
});

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(
      daysBetween({ year: 2026, month: 10, day: 1 }, { year: 2026, month: 10, day: 31 }),
    ).toBe(30);
  });

  it('is negative when the target is earlier', () => {
    expect(
      daysBetween({ year: 2026, month: 10, day: 31 }, { year: 2026, month: 10, day: 1 }),
    ).toBe(-30);
  });
});

describe('compareCalendar', () => {
  it('orders by year, then month, then day', () => {
    expect(
      compareCalendar(
        { year: 2026, month: 1, day: 1 },
        { year: 2026, month: 1, day: 2 },
      ),
    ).toBeLessThan(0);
    expect(
      compareCalendar(
        { year: 2026, month: 2, day: 1 },
        { year: 2026, month: 1, day: 31 },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareCalendar(
        { year: 2026, month: 1, day: 1 },
        { year: 2026, month: 1, day: 1 },
      ),
    ).toBe(0);
  });
});

describe('toIsoDate', () => {
  it('zero-pads month and day', () => {
    expect(toIsoDate({ year: 2026, month: 3, day: 9 })).toBe('2026-03-09');
  });
});
