import { getHolidaysForMonth } from './ng-holidays';

describe('getHolidaysForMonth', () => {
  it('returns the current month’s holidays for Nigeria', () => {
    expect(getHolidaysForMonth('NG', 2026, 10)).toEqual([
      { date: '2026-10-01', name: 'Independence Day' },
    ]);
  });

  it('returns multiple holidays sorted by date', () => {
    const december = getHolidaysForMonth('NG', 2026, 12);
    expect(december.map((h) => h.name)).toEqual([
      'Christmas Day',
      'Boxing Day',
    ]);
  });

  it('returns January holidays when the month rolls over to January', () => {
    expect(getHolidaysForMonth('NG', 2026, 1)).toEqual([
      { date: '2026-01-01', name: "New Year's Day" },
    ]);
  });

  it('accepts a lowercase country code', () => {
    expect(getHolidaysForMonth('ng', 2026, 5)).toHaveLength(3);
  });

  it('returns an empty list for a country without data', () => {
    expect(getHolidaysForMonth('US', 2026, 10)).toEqual([]);
  });

  it('returns an empty list for a year without data', () => {
    expect(getHolidaysForMonth('NG', 2027, 10)).toEqual([]);
  });

  it('returns an empty list for a month with no holidays', () => {
    expect(getHolidaysForMonth('NG', 2026, 2)).toEqual([]);
  });
});
