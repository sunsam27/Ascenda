// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD TIME HELPERS
//
// Calendar maths for the dashboard must be evaluated in the organisation's
// timezone (e.g. Africa/Lagos), not the server's. These helpers convert between
// IANA wall-clock calendar dates and UTC instants without pulling in a date
// library.
// ─────────────────────────────────────────────────────────────────────────────

export interface CalendarDate {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

/** The wall-clock calendar date in `timeZone` at the given instant. */
export function calendarDateIn(date: Date, timeZone: string): CalendarDate {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // "YYYY-MM-DD"
  const [year, month, day] = iso.split('-');
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const value: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') value[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    value.year ?? 0,
    (value.month ?? 1) - 1,
    value.day ?? 1,
    (value.hour ?? 0) % 24,
    value.minute ?? 0,
    value.second ?? 0,
  );
  const instantToSecond = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - instantToSecond;
}

/** The UTC instant at `hour:00` local time on the given calendar date. */
function utcInstantAt(
  cal: CalendarDate,
  hour: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(cal.year, cal.month - 1, cal.day, hour, 0, 0, 0);
  return new Date(guess - offsetMs(new Date(guess), timeZone));
}

/** First instant of the given calendar day (00:00:00.000 local). */
export function startOfDay(cal: CalendarDate, timeZone: string): Date {
  return utcInstantAt(cal, 0, timeZone);
}

/** Last instant of the given calendar day (23:59:59.999 local). */
export function endOfDay(cal: CalendarDate, timeZone: string): Date {
  return new Date(utcInstantAt(cal, 24, timeZone).getTime() - 1);
}

/** Adds `days` to a calendar date. */
export function addDays(cal: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(cal.year, cal.month - 1, cal.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** First day of the calendar month containing `cal`. */
export function startOfMonth(cal: CalendarDate): CalendarDate {
  return { year: cal.year, month: cal.month, day: 1 };
}

/** First day of the month after the one containing `cal`. */
export function startOfNextMonth(cal: CalendarDate): CalendarDate {
  return cal.month === 12
    ? { year: cal.year + 1, month: 1, day: 1 }
    : { year: cal.year, month: cal.month + 1, day: 1 };
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}

/** ISO 8601 date string, "YYYY-MM-DD". */
export function toIsoDate(cal: CalendarDate): string {
  const mm = String(cal.month).padStart(2, '0');
  const dd = String(cal.day).padStart(2, '0');
  return `${cal.year}-${mm}-${dd}`;
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareCalendar(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}
