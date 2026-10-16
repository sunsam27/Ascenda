// ─────────────────────────────────────────────────────────────────────────────
// BLACKOUT PERIODS (PRD LVE-05)
// Pure matching — no I/O. A blackout is a date window (optionally recurring
// annually) during which leave may not normally be taken. Recurring windows are
// matched by month/day; windows that wrap across the new year are unsupported
// (validated at creation).
// ─────────────────────────────────────────────────────────────────────────────
import { startOfUtcDay } from './working-days';

export interface BlackoutWindow {
  startDate: Date;
  endDate: Date;
  isRecurring: boolean;
}

/** True when a blackout window overlaps the inclusive `[rangeStart, rangeEnd]`. */
export function blackoutApplies(
  window: BlackoutWindow,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  const rs = startOfUtcDay(rangeStart).getTime();
  const re = startOfUtcDay(rangeEnd).getTime();

  if (!window.isRecurring) {
    const ws = startOfUtcDay(window.startDate).getTime();
    const we = startOfUtcDay(window.endDate).getTime();
    return ws <= re && we >= rs;
  }

  const startMonth = window.startDate.getUTCMonth();
  const startDay = window.startDate.getUTCDate();
  const endMonth = window.endDate.getUTCMonth();
  const endDay = window.endDate.getUTCDate();

  const firstYear = startOfUtcDay(rangeStart).getUTCFullYear();
  const lastYear = startOfUtcDay(rangeEnd).getUTCFullYear();
  for (let year = firstYear; year <= lastYear; year += 1) {
    const ws = Date.UTC(year, startMonth, startDay);
    const we = Date.UTC(year, endMonth, endDay);
    if (we < ws) continue;
    if (ws <= re && we >= rs) return true;
  }
  return false;
}

/** True when a recurring window's month/day range wraps across the new year. */
export function isWrappingWindow(startDate: Date, endDate: Date): boolean {
  const start = startOfUtcDay(startDate);
  const end = startOfUtcDay(endDate);
  return (
    end.getUTCMonth() < start.getUTCMonth() ||
    (end.getUTCMonth() === start.getUTCMonth() &&
      end.getUTCDate() < start.getUTCDate())
  );
}
