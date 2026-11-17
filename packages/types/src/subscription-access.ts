export const PRODUCT_FEATURES = ['people', 'timeLeave', 'documents', 'payroll', 'payments', 'analytics'] as const;
export type ProductFeature = typeof PRODUCT_FEATURES[number];
export type FeatureAccess = Record<ProductFeature, boolean>;
export interface PlanAccessPolicy {
  planId: string;
  enabledFeatures: FeatureAccess;
  trialDays: number;
  trialFeatures: FeatureAccess;
  defaultDemoDays: number;
}
export interface OrganisationAccessControl {
  organisationId: string;
  manualState: 'AUTO' | 'ACTIVE' | 'SUSPENDED';
  manualUntil: string | null;
  demoFeatures: Partial<FeatureAccess>;
  demoExpiresAt: string | null;
  trialStartedAt: string | null;
}
export interface SubscriptionAccess {
  enforcementEnabled: boolean;
  organisationId: string;
  plan: { id: string; name: string; isFree: boolean } | null;
  state: 'FREE' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'SUSPENDED' | 'NONE';
  features: FeatureAccess;
  readOnly: boolean;
  periodEnd: string | null;
  graceEndsAt: string | null;
  demoExpiresAt: string | null;
  control: OrganisationAccessControl | null;
  policy: PlanAccessPolicy | null;
}
export interface AdminOrganisationSubscription {
  organisationId: string;
  organisationName: string;
  planId: string | null;
  planName: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
}
