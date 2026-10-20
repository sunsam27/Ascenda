// ─────────────────────────────────────────────────────────────────────────────
// PAY CALENDAR MATH (PRD PAY-04)
// Pure functions — no I/O. Periods are half-open UTC date boundaries stored as
// Date objects at midnight UTC (same convention as the time-leave module).
//
// Calendar conventions (product decisions, NOT statutory rules):
//   • MONTHLY    — a calendar month, paid the following month on `dayOfMonth`
//                  (salary in arrears; e.g. February's pay lands on the 28th
//                  of March). Short months clamp the pay day (31 → 28/29/30).
//   • QUARTERLY  — calendar quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec),
//                  paid the month after the quarter ends on `dayOfMonth`.
//   • WEEKLY     — 7-day periods anchored on `dayOfWeek`, paid 7 days after
//                  the period ends.
//   • BIWEEKLY   — 14-day periods anchored on `dayOfWeek`, paid 14 days after
//                  the period ends.
//   • Cut-off    — a day-of-month in the PAY month. Changes made on or before
//                  it still make the period; after it they wait for the next.
//                  Weekly/BIWEEKLY calendars ignore the monthly cut-off.
// ─────────────────────────────────────────────────────────────────────────────

export type PayFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY';

export interface PayCalendarConfig {
  frequency: PayFrequency;
  /** 1–31; required for MONTHLY and QUARTERLY. */
  dayOfMonth?: number | null;
  /** 1–7 (Mon=1 … Sun=7); required for WEEKLY and BIWEEKLY. */
  dayOfWeek?: number | null;
  /** 1–31; changes after this day in the pay month wait for the next period. */
  cutOffDayOfMonth?: number | null;
}

export interface PayPeriod {
  /** Inclusive first day of the period. */
  periodStart: Date;
  /** Inclusive last day of the period. */
  periodEnd: Date;
  /** The day the period is paid on. */
  payDate: Date;
}

/** Validate a calendar configuration; returns human-readable errors. */
export function validateCalendarConfig(config: PayCalendarConfig): string[] {
  const errors: string[] = [];
  const monthly = config.frequency === 'MONTHLY' || config.frequency === 'QUARTERLY';
  const weekly =
    config.frequency === 'WEEKLY' || config.frequency === 'BIWEEKLY';

  if (monthly) {
    if (
      typeof config.dayOfMonth !== 'number' ||
      !Number.isInteger(config.dayOfMonth) ||
      config.dayOfMonth < 1 ||
      config.dayOfMonth > 31
    ) {
      errors.push(`dayOfMonth must be an integer between 1 and 31 for ${config.frequency} calendars`);
    }
  }
  if (weekly) {
    if (
      typeof config.dayOfWeek !== 'number' ||
      !Number.isInteger(config.dayOfWeek) ||
      config.dayOfWeek < 1 ||
      config.dayOfWeek > 7
    ) {
      errors.push(`dayOfWeek must be an integer between 1 (Mon) and 7 (Sun) for ${config.frequency} calendars`);
    }
  }
  if (
    config.cutOffDayOfMonth != null &&
    (!Number.isInteger(config.cutOffDayOfMonth) ||
      config.cutOffDayOfMonth < 1 ||
      config.cutOffDayOfMonth > 31)
  ) {
    errors.push('cutOffDayOfMonth must be an integer between 1 and 31');
  }
  return errors;
}

/** UTC midnight for a calendar date. */
export function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

/** Last day of a UTC month (1-based day number). */
export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Clamp a day-of-month into a possibly-short month (31 → 28 in February). */
export function clampDay(year: number, monthIndex: number, day: number): number {
  return Math.min(day, daysInMonth(year, monthIndex));
}

/** Add whole days to a UTC date (returns a new Date). */
export function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/** Day 1 of the month following the given date, with the pay day clamped. */
function payDayAfter(periodEnd: Date, dayOfMonth: number): Date {
  const year = periodEnd.getUTCFullYear();
  const nextMonth = periodEnd.getUTCMonth() + 1;
  const payYear = nextMonth > 11 ? year + 1 : year;
  const payMonth = nextMonth > 11 ? 0 : nextMonth;
  return utcDate(payYear, payMonth, clampDay(payYear, payMonth, dayOfMonth));
}

/**
 * The first configured weekday on or after `from` (Mon=1 … Sun=7).
 */
function firstWeekdayOnOrAfter(from: Date, dayOfWeek: number): Date {
  // getUTCDay(): Sun=0 … Sat=6 → ISO-style Mon=1 … Sun=7
  const iso = from.getUTCDay() === 0 ? 7 : from.getUTCDay();
  const delta = (dayOfWeek - iso + 7) % 7;
  return addDays(from, delta);
}

/**
 * Every pay period that overlaps `year`, in chronological order.
 * Weekly/BIWEEKLY periods are anchored on the first configured weekday of the
 * year; a period straddling a year boundary is included when its start is in
 * `year`.
 */
export function payPeriodsForYear(
  config: PayCalendarConfig,
  year: number,
): PayPeriod[] {
  switch (config.frequency) {
    case 'MONTHLY':
      return monthlyPeriods(config, year);
    case 'QUARTERLY':
      return quarterlyPeriods(config, year);
    case 'WEEKLY':
      return weeklyPeriods(config, year, 1);
    case 'BIWEEKLY':
      return weeklyPeriods(config, year, 2);
  }
}

function monthlyPeriods(config: PayCalendarConfig, year: number): PayPeriod[] {
  const dayOfMonth = config.dayOfMonth ?? 1;
  const periods: PayPeriod[] = [];
  for (let month = 0; month < 12; month += 1) {
    const periodStart = utcDate(year, month, 1);
    const periodEnd = utcDate(
      year,
      month,
      daysInMonth(year, month),
    );
    periods.push({
      periodStart,
      periodEnd,
      payDate: payDayAfter(periodEnd, dayOfMonth),
    });
  }
  return periods;
}

function quarterlyPeriods(config: PayCalendarConfig, year: number): PayPeriod[] {
  const dayOfMonth = config.dayOfMonth ?? 1;
  const periods: PayPeriod[] = [];
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const startMonth = quarter * 3;
    const endMonth = startMonth + 2;
    const periodStart = utcDate(year, startMonth, 1);
    const periodEnd = utcDate(year, endMonth, daysInMonth(year, endMonth));
    periods.push({
      periodStart,
      periodEnd,
      payDate: payDayAfter(periodEnd, dayOfMonth),
    });
  }
  return periods;
}

function weeklyPeriods(
  config: PayCalendarConfig,
  year: number,
  weeks: number,
): PayPeriod[] {
  const dayOfWeek = config.dayOfWeek ?? 1;
  const periodDays = 7 * weeks;
  let cursor = firstWeekdayOnOrAfter(utcDate(year, 0, 1), dayOfWeek);
  const periods: PayPeriod[] = [];
  while (cursor.getUTCFullYear() === year) {
    const periodEnd = addDays(cursor, periodDays - 1);
    periods.push({
      periodStart: cursor,
      periodEnd,
      // Paid in arrears one full cycle after the period closes.
      payDate: addDays(periodEnd, periodDays),
    });
    cursor = addDays(cursor, periodDays);
  }
  return periods;
}

/**
 * The single pay period containing `date`, or null when the date falls outside
 * every period generated for its year (cannot happen for MONTHLY/QUARTERLY;
 * possible for weekly anchors at a year boundary).
 */
export function currentPeriodForDate(
  config: PayCalendarConfig,
  date: Date,
): PayPeriod | null {
  const year = date.getTime();
  const periods = [
    ...payPeriodsForYear(config, date.getUTCFullYear()),
    ...payPeriodsForYear(config, date.getUTCFullYear() - 1),
    ...payPeriodsForYear(config, date.getUTCFullYear() + 1),
  ];
  return (
    periods.find(
      (p) => p.periodStart.getTime() <= year && year <= p.periodEnd.getTime(),
    ) ?? null
  );
}

/**
 * True when `asOf` is still on time for the period's pay date — i.e. the
 * monthly cut-off in the pay month has not passed. Weekly calendars have no
 * monthly cut-off and are always open.
 */
export function isBeforeCutOff(
  config: PayCalendarConfig,
  period: PayPeriod,
  asOf: Date,
): boolean {
  if (
    config.frequency === 'WEEKLY' ||
    config.frequency === 'BIWEEKLY' ||
    config.cutOffDayOfMonth == null
  ) {
    return true;
  }
  if (asOf.getTime() > period.payDate.getTime()) return false;
  const cutOffThisMonth = clampDay(
    period.payDate.getUTCFullYear(),
    period.payDate.getUTCMonth(),
    config.cutOffDayOfMonth,
  );
  const cutOffDate = utcDate(
    period.payDate.getUTCFullYear(),
    period.payDate.getUTCMonth(),
    cutOffThisMonth,
  );
  return asOf.getTime() <= cutOffDate.getTime();
}
