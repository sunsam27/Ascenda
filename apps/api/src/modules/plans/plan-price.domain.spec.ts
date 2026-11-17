import { nextPriceEmailAttempt, priceEmailBody, priceNotice, priceText } from './plan-price.domain';
import type { Plan } from '@ascenda/db';

const plan = {
  id: 'plan',
  name: 'Growth',
  priceMinorUnits: 10001,
  currency: 'NGN',
  billingPeriod: 'ANNUALLY',
} as Plan;
describe('Admin plan pricing policy', () => {
  it('notifies only on actual price/currency/billing-period changes', () => {
    expect(priceNotice(plan, { name: 'Growth plus', features: ['Support'] })).toBeNull();
    expect(priceNotice(plan, { priceMinorUnits: 10001 })).toBeNull();
    expect(priceNotice(plan, { priceMinorUnits: 20001 })).toMatchObject({
      oldPriceMinorUnits: 10001,
      newPriceMinorUnits: 20001,
    });
    expect(priceNotice(plan, { currency: 'USD' })).not.toBeNull();
    expect(priceNotice(plan, { billingPeriod: 'MONTHLY' as never })).not.toBeNull();
  });
  it('formats exact minor units without inventing charges or renewal rules', () => {
    expect(priceText(10001, 'NGN', 'ANNUALLY')).toBe('NGN 100.01 / year');
    expect(priceText(1, 'USD', 'MONTHLY')).toBe('USD 0.01 / month');
    expect(() => priceText(1.5, 'NGN', 'MONTHLY')).toThrow();
    const notice = priceNotice(plan, { priceMinorUnits: 20001 })!;
    expect(priceEmailBody(notice)).toContain('future checkouts');
    expect(priceEmailBody(notice)).toContain('does not trigger an automatic charge');
  });
  it('backs off failed SMTP attempts without dropping the notice', () => {
    const now = new Date('2026-11-16T00:00:00Z');
    expect(nextPriceEmailAttempt(1, now).toISOString()).toBe('2026-11-16T00:02:00.000Z');
    expect(nextPriceEmailAttempt(100, now).toISOString()).toBe('2026-11-16T06:00:00.000Z');
  });
});
