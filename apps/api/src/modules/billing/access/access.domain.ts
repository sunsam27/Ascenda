import { PRODUCT_FEATURES, type ProductFeature, type FeatureAccess, type PlanAccessPolicy, type SubscriptionAccess, type OrganisationAccessControl } from '@ascenda/types';

export const DAY_MS = 86400000;
export const GRACE_DAYS = 7;
export function featureFlags(value: Partial<FeatureAccess> = {}): FeatureAccess {
  return Object.fromEntries(PRODUCT_FEATURES.map(key => [key, value[key] === true])) as FeatureAccess;
}
export function defaultPolicy(planId: string, isFree: boolean): PlanAccessPolicy {
  return { planId, enabledFeatures: featureFlags({ people: true, timeLeave: true, documents: true,
    payroll: !isFree, payments: !isFree, analytics: !isFree }), trialDays: 0,
    trialFeatures: featureFlags(), defaultDemoDays: 14 };
}
export function extendDate(existing: string | Date | null, days: number, now = new Date()): Date {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Days must be between 1 and 3650');
  return new Date(Math.max(existing ? new Date(existing).getTime() : 0, now.getTime()) + days * DAY_MS);
}
export function evaluateAccess(input: { organisationId: string; plan: SubscriptionAccess['plan']; status: string | null;
  periodEnd: string | null; policy: PlanAccessPolicy | null; control: OrganisationAccessControl | null;
  enforcementEnabled: boolean }, now = new Date()): SubscriptionAccess {
  const { plan, control, policy, periodEnd } = input;
  const end = periodEnd ? new Date(periodEnd).getTime() : null;
  let state: SubscriptionAccess['state'] = !plan ? 'NONE' : plan.isFree && input.status==='ACTIVE' ? 'FREE' : 'EXPIRED';
  const manualActive = control?.manualState === 'ACTIVE' && !!control.manualUntil && new Date(control.manualUntil).getTime() > now.getTime();
  if (plan && !plan.isFree && ['ACTIVE','PAST_DUE','CANCELLED'].includes(input.status ?? '')) {
    if (end !== null && end > now.getTime()) state = 'ACTIVE';
    else if (end !== null && end + GRACE_DAYS * DAY_MS > now.getTime()) state = 'GRACE';
  }
  if (plan && manualActive) state = plan.isFree ? 'FREE' : 'ACTIVE';
  if (control?.manualState === 'SUSPENDED') state = 'SUSPENDED';
  const usable = ['FREE','ACTIVE','GRACE'].includes(state);
  const features = featureFlags(usable ? policy?.enabledFeatures ?? {} : {people:policy?.enabledFeatures.people,timeLeave:policy?.enabledFeatures.timeLeave,documents:policy?.enabledFeatures.documents});
  const demoLive = usable && !!control?.demoExpiresAt && new Date(control.demoExpiresAt).getTime() > now.getTime();
  if (demoLive) for (const feature of PRODUCT_FEATURES) {
    if (typeof control!.demoFeatures[feature] === 'boolean') features[feature] = control!.demoFeatures[feature]!;
  }
  return { organisationId: input.organisationId, enforcementEnabled: input.enforcementEnabled, plan, state,
    features: input.enforcementEnabled ? features : featureFlags(Object.fromEntries(PRODUCT_FEATURES.map(k => [k,true]))),
    readOnly: input.enforcementEnabled && !usable, periodEnd,
    graceEndsAt: end !== null && plan && !plan.isFree ? new Date(end + GRACE_DAYS * DAY_MS).toISOString() : null,
    demoExpiresAt: demoLive ? control!.demoExpiresAt : null, control, policy };
}

/** Version-prefix independent path classification; auth, billing and verified webhooks never get subscription-blocked. */
export function routeFeature(path: string): ProductFeature | null {
  if(path==='/dashboard/insights')return 'timeLeave';
  if (/^\/workers\/[^/]+\/compensation(?:\/|$)/.test(path)) return 'payroll';
  const root = path.split('/')[1];
  if (['workers','departments','locations','talent','bank-accounts','service'].includes(root ?? '')) return 'people';
  if (['leave-types','leave-requests','leave-balances','attendance','holidays','blackout-periods'].includes(root ?? '')) return 'timeLeave';
  if (root === 'documents') return 'documents';
  if (root === 'payroll' || root === 'payslips') return 'payroll';
  if (root === 'payments' || root === 'expense-claims') return 'payments';
  if (root === 'analytics') return 'analytics';
  return null;
}
export function isHistoricalRead(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  return /^\/payslips(?:\/|$)/.test(path) || /^\/payroll\/year-end\/statements(?:\/|$)/.test(path) ||
    path === '/payments/export' || path === '/analytics/reports/export';
}
