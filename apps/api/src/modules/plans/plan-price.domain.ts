import type { Plan } from '@ascenda/db';
import type { UpdatePlanDto } from './dto/update-plan.dto';

export interface PlanPriceNotice {
  planId: string;
  planName: string;
  oldPriceMinorUnits: number;
  newPriceMinorUnits: number;
  oldCurrency: string;
  newCurrency: string;
  oldBillingPeriod: string;
  newBillingPeriod: string;
  changedAt: string;
}

export function priceNotice(
  plan: Plan,
  dto: UpdatePlanDto,
  now = new Date(),
): PlanPriceNotice | null {
  const price = dto.priceMinorUnits ?? plan.priceMinorUnits;
  const currency = dto.currency ?? plan.currency;
  const period = dto.billingPeriod ?? plan.billingPeriod;
  if (price === plan.priceMinorUnits && currency === plan.currency && period === plan.billingPeriod)
    return null;
  return {
    planId: plan.id,
    planName: dto.name ?? plan.name,
    oldPriceMinorUnits: plan.priceMinorUnits,
    newPriceMinorUnits: price,
    oldCurrency: plan.currency,
    newCurrency: currency,
    oldBillingPeriod: plan.billingPeriod,
    newBillingPeriod: period,
    changedAt: now.toISOString(),
  };
}

export function priceText(amount: number, currency: string, period: string): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid plan price');
  const digits = String(amount).padStart(3, '0');
  return `${currency} ${digits.slice(0, -2)}.${digits.slice(-2)} / ${period === 'MONTHLY' ? 'month' : 'year'}`;
}

export function priceEmailBody(notice: PlanPriceNotice): string {
  return `The price of the ${notice.planName} plan changed on ${notice.changedAt.slice(0, 10)}.\n\nPrevious price: ${priceText(notice.oldPriceMinorUnits, notice.oldCurrency, notice.oldBillingPeriod)}\nNew price: ${priceText(notice.newPriceMinorUnits, notice.newCurrency, notice.newBillingPeriod)}\n\nThe new price applies to future checkouts. Your already-paid period and past payments are unchanged. This notice does not trigger an automatic charge or change your subscription period.`;
}

export function nextPriceEmailAttempt(attempt: number, now = new Date()): Date {
  return new Date(now.getTime() + Math.min(360, 2 ** Math.min(attempt, 10)) * 60_000);
}
