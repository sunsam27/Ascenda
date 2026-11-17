import { BillingPeriod } from '@ascenda/types';
import { DAY_MS, GRACE_DAYS } from '../access/access.domain';

export const REMINDER_DAYS = [14, 7, 1] as const;
export type ReminderKind = 'REMINDER_14' | 'REMINDER_7' | 'REMINDER_1';
export type LifecycleKind = ReminderKind | 'PAST_DUE' | 'GRACE_EXPIRED' | 'RESTORED';

export function reminderKind(days: (typeof REMINDER_DAYS)[number]): ReminderKind {
  return `REMINDER_${days}` as ReminderKind;
}

/** One finite send window per notice; the unique ledger prevents duplicate emails. */
export function reminderDue(now: Date, periodEnd: Date, days: (typeof REMINDER_DAYS)[number]): boolean {
  const target = periodEnd.getTime() - days * DAY_MS;
  return now.getTime() >= target && now.getTime() < target + DAY_MS;
}

export function graceEndsAt(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() + GRACE_DAYS * DAY_MS);
}

export function pastDueReached(now: Date, periodEnd: Date): boolean {
  return now.getTime() >= periodEnd.getTime() && now.getTime() < graceEndsAt(periodEnd).getTime();
}

export function graceExpired(now: Date, periodEnd: Date): boolean {
  return now.getTime() >= graceEndsAt(periodEnd).getTime();
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function addBillingPeriod(date: Date, period: BillingPeriod): Date {
  const source = new Date(date);
  const target = new Date(source);
  if (period === BillingPeriod.ANNUALLY) {
    const year = source.getUTCFullYear() + 1;
    const month = source.getUTCMonth();
    target.setUTCFullYear(year, month, Math.min(source.getUTCDate(), daysInUtcMonth(year, month)));
  } else {
    const year = source.getUTCFullYear();
    const month = source.getUTCMonth() + 1;
    const normalizedYear = new Date(Date.UTC(year, month, 1)).getUTCFullYear();
    const normalizedMonth = new Date(Date.UTC(year, month, 1)).getUTCMonth();
    target.setUTCFullYear(
      normalizedYear,
      normalizedMonth,
      Math.min(source.getUTCDate(), daysInUtcMonth(normalizedYear, normalizedMonth)),
    );
  }
  return target;
}

/** Renewal extends from the later of the stored expiry and now; never shortens access. */
export function nextPeriodEnd(currentEnd: Date | null, period: BillingPeriod, now: Date): Date {
  const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return addBillingPeriod(base, period);
}
