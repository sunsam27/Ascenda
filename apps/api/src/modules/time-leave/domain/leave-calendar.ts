// ─────────────────────────────────────────────────────────────────────────────
// TEAM LEAVE CALENDAR (PRD LVE-05)
// Pure functions — no I/O, no Prisma. Expands leave spans into per-day buckets
// across a requested range so a team calendar can render who is away each day.
// Days are date-only (UTC midnight) values, matching `working-days.ts`.
// ─────────────────────────────────────────────────────────────────────────────
import {
  HolidayLike,
  WorkSchedule,
  eachDay,
  isWorkingDay,
  startOfUtcDay,
} from './working-days';

/** A leave span as it contributes to the calendar (dates in, nothing out). */
export interface CalendarSpan {
  start: Date;
  end: Date;
}

export interface CalendarDayBucket {
  date: Date;
  /** Working day per the org schedule (weekends + holidays excluded). */
  isWorkingDay: boolean;
  /** Head-count of leave spans covering this day. */
  onLeaveCount: number;
  /** Indexes into the input `entries` array that cover this day. */
  entryIndexes: number[];
}

/** Format a date as its `YYYY-MM-DD` civil date (UTC). */
export function isoDate(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

/**
 * Expand `entries` into one bucket per calendar day in `[from, to]`. A span
 * covers every day from its start to its end inclusive (weekends included, so
 * the calendar can render continuous bars); `isWorkingDay` marks the days that
 * count as working days for the organisation.
 */
export function buildCalendar(
  from: Date,
  to: Date,
  entries: CalendarSpan[],
  schedule: WorkSchedule,
  holidays: HolidayLike[],
): CalendarDayBucket[] {
  const spans = entries.map((entry) => ({
    start: startOfUtcDay(entry.start).getTime(),
    end: startOfUtcDay(entry.end).getTime(),
  }));

  return eachDay(from, to).map((date) => {
    const at = date.getTime();
    const entryIndexes: number[] = [];
    spans.forEach((span, index) => {
      if (at >= span.start && at <= span.end) entryIndexes.push(index);
    });
    return {
      date,
      isWorkingDay: isWorkingDay(date, schedule, holidays),
      onLeaveCount: entryIndexes.length,
      entryIndexes,
    };
  });
}
