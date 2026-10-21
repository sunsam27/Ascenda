// ─────────────────────────────────────────────────────────────────────────────
// Payroll UI helpers shared across the payroll panels — status labels/tones,
// item-type labels, monetary formatting and a NestJS error-message extractor.
// ─────────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import {
  ExpenseClaimStatus,
  PayFrequency,
  PaymentStatus,
  PayrollItemType,
  PayrollRunApprovalStatus,
  PayrollRunStatus,
  type StatutoryItemType,
  type StatutoryRuleKind,
  type StatutoryRuleBase,
  type StatutoryRuleSide,
} from '@ascenda/types';

/** Status → human label for a run. */
export const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  [PayrollRunStatus.DRAFT]: 'Draft',
  [PayrollRunStatus.IN_REVIEW]: 'In review',
  [PayrollRunStatus.PENDING_APPROVAL]: 'Pending approval',
  [PayrollRunStatus.APPROVED]: 'Approved',
  [PayrollRunStatus.PROCESSED]: 'Processed',
  [PayrollRunStatus.LOCKED]: 'Locked',
};

/** Badge class suffix (see payroll.module.css `.badge*`) per run status. */
export const RUN_STATUS_TONE: Record<PayrollRunStatus, string> = {
  [PayrollRunStatus.DRAFT]: 'badge',
  [PayrollRunStatus.IN_REVIEW]: 'badgeWarning',
  [PayrollRunStatus.PENDING_APPROVAL]: 'badgeWarning',
  [PayrollRunStatus.APPROVED]: 'badgeInfo',
  [PayrollRunStatus.PROCESSED]: 'badgeSuccess',
  [PayrollRunStatus.LOCKED]: 'badgeSuccess',
};

export const APPROVAL_STATUS_LABEL: Record<PayrollRunApprovalStatus, string> = {
  [PayrollRunApprovalStatus.PENDING]: 'Pending',
  [PayrollRunApprovalStatus.APPROVED]: 'Approved',
  [PayrollRunApprovalStatus.REJECTED]: 'Rejected',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]: 'Pending',
  [PaymentStatus.PROCESSING]: 'Processing',
  [PaymentStatus.COMPLETED]: 'Completed',
  [PaymentStatus.FAILED]: 'Failed',
  [PaymentStatus.REVERSED]: 'Reversed',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]: 'badge',
  [PaymentStatus.PROCESSING]: 'badgeWarning',
  [PaymentStatus.COMPLETED]: 'badgeSuccess',
  [PaymentStatus.FAILED]: 'badgeDanger',
  [PaymentStatus.REVERSED]: 'badgeWarning',
};

export const ITEM_TYPE_LABEL: Record<PayrollItemType, string> = {
  [PayrollItemType.BASIC_SALARY]: 'Basic salary',
  [PayrollItemType.ALLOWANCE]: 'Allowance',
  [PayrollItemType.BONUS]: 'Bonus',
  [PayrollItemType.DEDUCTION]: 'Deduction',
  [PayrollItemType.EMPLOYER_PENSION]: 'Employer pension',
  [PayrollItemType.EMPLOYEE_PENSION]: 'Employee pension',
  [PayrollItemType.TAX]: 'Tax',
  [PayrollItemType.REIMBURSEMENT]: 'Reimbursement',
  [PayrollItemType.STIPEND]: 'Stipend',
};

export const CLAIM_STATUS_LABEL: Record<ExpenseClaimStatus, string> = {
  [ExpenseClaimStatus.SUBMITTED]: 'Submitted',
  [ExpenseClaimStatus.MANAGER_APPROVED]: 'Manager approved',
  [ExpenseClaimStatus.MANAGER_REJECTED]: 'Manager rejected',
  [ExpenseClaimStatus.FINANCE_APPROVED]: 'Finance approved',
  [ExpenseClaimStatus.FINANCE_REJECTED]: 'Finance rejected',
  [ExpenseClaimStatus.PAID]: 'Paid',
  [ExpenseClaimStatus.CANCELLED]: 'Cancelled',
};

export const CLAIM_STATUS_TONE: Record<ExpenseClaimStatus, string> = {
  [ExpenseClaimStatus.SUBMITTED]: 'badge',
  [ExpenseClaimStatus.MANAGER_APPROVED]: 'badgeInfo',
  [ExpenseClaimStatus.MANAGER_REJECTED]: 'badgeDanger',
  [ExpenseClaimStatus.FINANCE_APPROVED]: 'badgePrimary',
  [ExpenseClaimStatus.FINANCE_REJECTED]: 'badgeDanger',
  [ExpenseClaimStatus.PAID]: 'badgeSuccess',
  [ExpenseClaimStatus.CANCELLED]: 'badge',
};

export const STATUTORY_KIND_LABEL: Record<StatutoryRuleKind, string> = {
  FLAT: 'Flat amount',
  PERCENT_CAPPED: 'Percentage (with cap)',
  PERCENT_BANDS: 'Banded percentage',
};

export const STATUTORY_KIND_OPTIONS: StatutoryRuleKind[] = [
  'PERCENT_BANDS',
  'PERCENT_CAPPED',
  'FLAT',
];

export const STATUTORY_BASE_OPTIONS: StatutoryRuleBase[] = [
  'GROSS',
  'BASIC_SALARY',
  'TAXABLE',
  'PENSIONABLE',
];

export const STATUTORY_SIDE_OPTIONS: StatutoryRuleSide[] = [
  'EMPLOYEE',
  'EMPLOYER',
];

export const STATUTORY_ITEM_TYPE_OPTIONS: StatutoryItemType[] = [
  'TAX',
  'DEDUCTION',
  'EMPLOYEE_PENSION',
  'EMPLOYER_PENSION',
];

/** Human label for a statutory rule side (remittance schedules). */
export const REMITTANCE_SIDE_LABEL: Record<StatutoryRuleSide, string> = {
  EMPLOYEE: 'Employee',
  EMPLOYER: 'Employer',
};

/** Human label for a pay-calendar frequency (PAY-04). */
export const PAY_FREQUENCY_LABEL: Record<PayFrequency, string> = {
  [PayFrequency.WEEKLY]: 'Weekly',
  [PayFrequency.BIWEEKLY]: 'Bi-weekly',
  [PayFrequency.MONTHLY]: 'Monthly',
  [PayFrequency.QUARTERLY]: 'Quarterly',
};

export const PAY_FREQUENCY_OPTIONS: PayFrequency[] = [
  PayFrequency.MONTHLY,
  PayFrequency.QUARTERLY,
  PayFrequency.BIWEEKLY,
  PayFrequency.WEEKLY,
];

/** A calendar uses a day-of-month (MONTHLY/QUARTERLY) or day-of-week, not both. */
export function usesDayOfMonth(frequency: PayFrequency): boolean {
  return (
    frequency === PayFrequency.MONTHLY || frequency === PayFrequency.QUARTERLY
  );
}

/** Extract the first human message from a NestJS / axios error response. */
export function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

/** ISO date (YYYY-MM-DD) for today. */
export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "12 Dec 2026" — compact, locale-stable label for ISO dates. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Inclusive date range, e.g. "1 – 31 Dec 2026" or "28 Dec 2026 – 10 Jan 2027". */
export function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso.slice(0, 10)} – ${endIso.slice(0, 10)}`;
  }
  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth();
  const startLabel = formatDate(startIso);
  if (sameMonth) {
    const month = end.toLocaleDateString('en-GB', {
      month: 'short',
      year: 'numeric',
    });
    return `${start.getDate()} – ${end.getDate()} ${month}`;
  }
  return `${startLabel} – ${formatDate(endIso)}`;
}
