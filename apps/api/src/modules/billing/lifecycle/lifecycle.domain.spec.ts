import { BillingPeriod } from '@ascenda/types';
import {
  addBillingPeriod,
  graceExpired,
  nextPeriodEnd,
  pastDueReached,
  reminderDue,
  reminderKind,
} from './lifecycle.domain';

const end = new Date('2026-12-01T12:00:00Z');

describe('subscription lifecycle domain', () => {
  it('fires each reminder once in its own one-day window', () => {
    expect(reminderKind(14)).toBe('REMINDER_14');
    expect(reminderDue(new Date('2026-11-17T11:59:59Z'), end, 14)).toBe(false);
    expect(reminderDue(new Date('2026-11-17T12:00:00Z'), end, 14)).toBe(true);
    expect(reminderDue(new Date('2026-11-18T11:59:59Z'), end, 14)).toBe(true);
    expect(reminderDue(new Date('2026-11-18T12:00:00Z'), end, 14)).toBe(false);
    expect(reminderDue(new Date('2026-11-27T12:00:00Z'), end, 7)).toBe(false);
    expect(reminderDue(new Date('2026-11-24T12:00:00Z'), end, 7)).toBe(true);
    expect(reminderDue(new Date('2026-11-30T12:00:00Z'), end, 1)).toBe(true);
  });

  it('allows seven full days of grace before restricting access', () => {
    expect(pastDueReached(new Date('2026-12-01T12:00:00Z'), end)).toBe(true);
    expect(graceExpired(new Date('2026-12-08T11:59:59Z'), end)).toBe(false);
    expect(graceExpired(new Date('2026-12-08T12:00:00Z'), end)).toBe(true);
    expect(pastDueReached(new Date('2026-12-08T12:00:00Z'), end)).toBe(false);
  });

  it('extends paid periods without shortening them and clamps month ends', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    expect(nextPeriodEnd(new Date('2026-12-01T12:00:00Z'), BillingPeriod.MONTHLY, now).toISOString()).toBe(
      '2027-01-01T12:00:00.000Z',
    );
    expect(nextPeriodEnd(new Date('2026-10-01T12:00:00Z'), BillingPeriod.MONTHLY, now).toISOString()).toBe(
      '2026-12-17T12:00:00.000Z',
    );
    expect(addBillingPeriod(new Date('2026-01-31T12:00:00Z'), BillingPeriod.MONTHLY).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(addBillingPeriod(new Date('2024-02-29T12:00:00Z'), BillingPeriod.ANNUALLY).toISOString()).toBe(
      '2025-02-28T12:00:00.000Z',
    );
  });
});
