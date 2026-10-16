// ─────────────────────────────────────────────────────────────────────────────
// WORKING-DAY MATH (PRD LVE-03)
// Pure functions — no I/O, no Prisma. Dates are treated as date-only values
// (UTC midnight), which is how `@db.Date` columns and `YYYY-MM-DD` inputs
// arrive. Weekend days and public holidays are never counted as leave.
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkSchedule {
  /** ISO weekdays Mon=1 … Sun=7 */
  workDays: number[];
  /** "HH:mm" in the organisation timezone */
  workDayStart: string;
  workDayEnd: string;
}

export const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  workDays: [1, 2, 3, 4, 5],
  workDayStart: '09:00',
  workDayEnd: '17:00',
};

/** A holiday as stored: a concrete date plus whether it recurs annually. */
export interface HolidayLike {
  date: Date;
  isRecurring: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Normalise any Date to its UTC midnight civil date. */
export function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

/** ISO weekday (Mon=1 … Sun=7) for a date. */
export function isoWeekday(value: Date): number {
  const day = startOfUtcDay(value).getUTCDay(); // 0=Sun … 6=Sat
  return day === 0 ? 7 : day;
}

function sameMonthDay(a: Date, b: Date): boolean {
  return (
    a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
  );
}

/** True when the day is a public holiday (anniversary-aware for recurring). */
export function isHoliday(day: Date, holidays: HolidayLike[]): boolean {
  const target = startOfUtcDay(day);
  return holidays.some((holiday) => {
    const hd = startOfUtcDay(holiday.date);
    return holiday.isRecurring
      ? sameMonthDay(target, hd) && target.getUTCFullYear() >= hd.getUTCFullYear()
      : target.getTime() === hd.getTime();
  });
}

/** True when the day is a configured working day and not a public holiday. */
export function isWorkingDay(
  day: Date,
  schedule: WorkSchedule,
  holidays: HolidayLike[],
): boolean {
  const target = startOfUtcDay(day);
  if (!schedule.workDays.includes(isoWeekday(target))) return false;
  return !isHoliday(target, holidays);
}

/** Every date (UTC midnight) from `start` to `end` inclusive. */
export function eachDay(start: Date, end: Date): Date[] {
  const from = startOfUtcDay(start).getTime();
  const to = startOfUtcDay(end).getTime();
  if (to < from) return [];
  const days: Date[] = [];
  for (let t = from; t <= to; t += MS_PER_DAY) days.push(new Date(t));
  return days;
}

export interface LeaveSpanInput {
  start: Date;
  end: Date;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
  schedule: WorkSchedule;
  holidays: HolidayLike[];
}

/** Round to the nearest 0.5 (defensive against float drift). */
export function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * Working days in a leave span (PRD LVE-03). Weekends and public holidays are
 * excluded; a half-day flag removes 0.5 from the first and/or last day. The
 * result is always a multiple of 0.5.
 */
export function countLeaveDays(input: LeaveSpanInput): number {
  const { schedule, holidays } = input;
  const days = eachDay(input.start, input.end);
  if (days.length === 0) return 0;

  const working = days.filter((d) => isWorkingDay(d, schedule, holidays));
  if (working.length === 0) return 0;

  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return 0;

  if (first.getTime() === last.getTime()) {
    return input.startHalfDay || input.endHalfDay ? 0.5 : 1;
  }

  let total = working.length;
  if (input.startHalfDay && isWorkingDay(first, schedule, holidays)) total -= 0.5;
  if (input.endHalfDay && isWorkingDay(last, schedule, holidays)) total -= 0.5;
  return roundHalf(total);
}
