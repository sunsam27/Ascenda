import {
  clampDay,
  currentPeriodForDate,
  daysInMonth,
  isBeforeCutOff,
  payPeriodsForYear,
  utcDate,
  validateCalendarConfig,
} from './pay-calendar';

const MONTHLY = {
  frequency: 'MONTHLY' as const,
  dayOfMonth: 28,
  cutOffDayOfMonth: 25,
};
const WEEKLY = { frequency: 'WEEKLY' as const, dayOfWeek: 1 };
const BIWEEKLY = { frequency: 'BIWEEKLY' as const, dayOfWeek: 5 };
const QUARTERLY = { frequency: 'QUARTERLY' as const, dayOfMonth: 15 };

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('validateCalendarConfig', () => {
  it('accepts the standard configurations', () => {
    expect(validateCalendarConfig(MONTHLY)).toEqual([]);
    expect(validateCalendarConfig(WEEKLY)).toEqual([]);
    expect(validateCalendarConfig(QUARTERLY)).toEqual([]);
  });

  it('requires dayOfMonth for monthly and quarterly calendars', () => {
    expect(
      validateCalendarConfig({ frequency: 'MONTHLY' })[0],
    ).toContain('dayOfMonth');
    expect(
      validateCalendarConfig({ frequency: 'QUARTERLY', dayOfWeek: 1 })[0],
    ).toContain('dayOfMonth');
  });

  it('requires dayOfWeek for weekly and bi-weekly calendars', () => {
    expect(validateCalendarConfig({ frequency: 'WEEKLY' })[0]).toContain(
      'dayOfWeek',
    );
    expect(
      validateCalendarConfig({ frequency: 'BIWEEKLY', dayOfMonth: 5 })[0],
    ).toContain('dayOfWeek');
  });

  it('rejects out-of-range cut-off days', () => {
    expect(
      validateCalendarConfig({ ...MONTHLY, cutOffDayOfMonth: 0 })[0],
    ).toContain('cutOffDayOfMonth');
  });
});

describe('date helpers', () => {
  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
    expect(clampDay(2026, 1, 31)).toBe(28);
    expect(clampDay(2028, 1, 31)).toBe(29);
  });
});

describe('payPeriodsForYear — MONTHLY (PAY-04)', () => {
  const periods = payPeriodsForYear(MONTHLY, 2026);

  it('produces one period per calendar month', () => {
    expect(periods).toHaveLength(12);
    expect(iso(periods[0]!.periodStart)).toBe('2026-01-01');
    expect(iso(periods[0]!.periodEnd)).toBe('2026-01-31');
  });

  it('pays each period on the 28th of the following month', () => {
    expect(iso(periods[0]!.payDate)).toBe('2026-02-28');
    expect(iso(periods[1]!.periodStart)).toBe('2026-02-01');
    expect(iso(periods[1]!.periodEnd)).toBe('2026-02-28');
    expect(iso(periods[1]!.payDate)).toBe('2026-03-28');
  });

  it('rolls the December pay date into the next year', () => {
    expect(iso(periods[11]!.periodEnd)).toBe('2026-12-31');
    expect(iso(periods[11]!.payDate)).toBe('2027-01-28');
  });
});

describe('payPeriodsForYear — clamped pay days', () => {
  it('clamps a day-31 pay day to the end of short months', () => {
    const periods = payPeriodsForYear(
      { frequency: 'MONTHLY', dayOfMonth: 31 },
      2026,
    );
    // January is paid in February: day 31 clamps to the 28th.
    expect(iso(periods[0]!.payDate)).toBe('2026-02-28');
    // February is paid in March: 31 is a valid March day, no clamp.
    expect(iso(periods[1]!.payDate)).toBe('2026-03-31');
    // March is paid in April: 31 clamps to the 30th.
    expect(iso(periods[2]!.payDate)).toBe('2026-04-30');
    // Leap-year February: paid on the 29th of March 2028? No — January 2028
    // is paid in February 2028, where day 31 clamps to the 29th.
    const leap = payPeriodsForYear(
      { frequency: 'MONTHLY', dayOfMonth: 31 },
      2028,
    );
    expect(iso(leap[0]!.payDate)).toBe('2028-02-29');
  });
});

describe('payPeriodsForYear — QUARTERLY', () => {
  const periods = payPeriodsForYear(QUARTERLY, 2026);

  it('produces four calendar quarters paid the month after they close', () => {
    expect(periods).toHaveLength(4);
    expect(iso(periods[0]!.periodStart)).toBe('2026-01-01');
    expect(iso(periods[0]!.periodEnd)).toBe('2026-03-31');
    expect(iso(periods[0]!.payDate)).toBe('2026-04-15');
    expect(iso(periods[3]!.periodStart)).toBe('2026-10-01');
    expect(iso(periods[3]!.periodEnd)).toBe('2026-12-31');
    expect(iso(periods[3]!.payDate)).toBe('2027-01-15');
  });
});

describe('payPeriodsForYear — WEEKLY / BIWEEKLY', () => {
  it('anchors weekly periods on the first Monday of the year', () => {
    const periods = payPeriodsForYear(WEEKLY, 2026);
    expect(iso(periods[0]!.periodStart)).toBe('2026-01-05'); // 2026-01-01 is a Thursday
    expect(iso(periods[0]!.periodEnd)).toBe('2026-01-11');
    expect(iso(periods[0]!.payDate)).toBe('2026-01-18'); // paid a week after close
    expect(periods).toHaveLength(52);
    expect(iso(periods[51]!.periodStart)).toBe('2026-12-28');
  });

  it('anchors bi-weekly periods on the configured weekday', () => {
    const periods = payPeriodsForYear(BIWEEKLY, 2026);
    // 2026-01-01 is a Thursday; the first Friday is 2026-01-02.
    expect(iso(periods[0]!.periodStart)).toBe('2026-01-02');
    expect(iso(periods[0]!.periodEnd)).toBe('2026-01-15');
    expect(iso(periods[0]!.payDate)).toBe('2026-01-29');
    expect(periods).toHaveLength(26);
  });
});

describe('currentPeriodForDate', () => {
  it('finds the calendar month containing the date', () => {
    const period = currentPeriodForDate(MONTHLY, utcDate(2026, 5, 15));
    expect(iso(period!.periodStart)).toBe('2026-06-01');
    expect(iso(period!.periodEnd)).toBe('2026-06-30');
  });

  it('finds the week containing the date', () => {
    const period = currentPeriodForDate(WEEKLY, utcDate(2026, 0, 7)); // Wednesday
    expect(iso(period!.periodStart)).toBe('2026-01-05');
    expect(iso(period!.periodEnd)).toBe('2026-01-11');
  });

  it('finds the quarter containing the date', () => {
    const period = currentPeriodForDate(QUARTERLY, utcDate(2026, 7, 1));
    expect(iso(period!.periodStart)).toBe('2026-07-01');
    expect(iso(period!.periodEnd)).toBe('2026-09-30');
  });
});

describe('isBeforeCutOff', () => {
  const january = payPeriodsForYear(MONTHLY, 2026)[0]!; // paid 2026-02-28, cut-off 25

  it('is open on the cut-off day and closed the day after', () => {
    expect(isBeforeCutOff(MONTHLY, january, utcDate(2026, 1, 25))).toBe(true);
    expect(isBeforeCutOff(MONTHLY, january, utcDate(2026, 1, 26))).toBe(false);
  });

  it('is closed from the day after the cut-off through the pay date', () => {
    expect(isBeforeCutOff(MONTHLY, january, utcDate(2026, 1, 28))).toBe(false);
    expect(isBeforeCutOff(MONTHLY, january, utcDate(2026, 2, 1))).toBe(false);
  });

  it('is always open when no cut-off is configured', () => {
    const noCutOff = { frequency: 'MONTHLY' as const, dayOfMonth: 28 };
    expect(isBeforeCutOff(noCutOff, january, utcDate(2026, 5, 1))).toBe(true);
  });

  it('is always open for weekly calendars', () => {
    const week = payPeriodsForYear(WEEKLY, 2026)[0]!;
    expect(isBeforeCutOff(WEEKLY, week, utcDate(2026, 5, 1))).toBe(true);
  });
});
