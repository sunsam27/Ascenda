'use client';

import { useState } from 'react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import RunsPanel from './RunsPanel';
import RulePacksPanel from './RulePacksPanel';
import PayslipsPanel from './PayslipsPanel';
import PaymentsPanel from './PaymentsPanel';
import ClaimsPanel from './ClaimsPanel';
import YearEndPanel from './YearEndPanel';
import PayCalendarsPanel from './PayCalendarsPanel';
import styles from './payroll.module.css';

type Tab =
  | 'runs'
  | 'calendars'
  | 'payslips'
  | 'payments'
  | 'claims'
  | 'rule-packs'
  | 'year-end';

/** Roles that may prepare/edit runs and manage statutory packs (payroll:update). */
const PAYROLL_ADMINS = new Set(['OWNER', 'PAYROLL_ADMINISTRATOR']);
/** Roles that may approve/process/lock/reverse runs and export payments. */
const APPROVERS = new Set(['OWNER', 'FINANCE_APPROVER']);
/** Roles that may move a payment through its status lifecycle. */
const PAYMENT_MANAGERS = new Set(['OWNER', 'PAYROLL_ADMINISTRATOR']);
/** Roles that submit reimbursements (self-service) — plus managers for their team. */
const CLAIM_SUBMITTERS = new Set([
  'OWNER',
  'PAYROLL_ADMINISTRATOR',
  'MANAGER',
  'EMPLOYEE_SELF',
  'VOLUNTEER_SELF',
]);
/** Roles that read the whole tenant's payroll (vs. only their own payslips). */
const ORG_READERS = new Set([
  'OWNER',
  'PAYROLL_ADMINISTRATOR',
  'FINANCE_APPROVER',
  'AUDITOR',
  'SUPPORT_READ_ONLY',
  'VIEWER',
]);
/** Roles that may view the whole-tenant remittance schedule (PAY-16). */
const REMITTANCE_READERS = new Set([
  'OWNER',
  'PAYROLL_ADMINISTRATOR',
  'FINANCE_APPROVER',
  'AUDITOR',
  'SUPPORT_READ_ONLY',
]);

export default function PayrollView() {
  const { user, loading } = useCurrentUser();
  const role = user?.role ?? '';

  const canManageRuns = PAYROLL_ADMINS.has(role);
  const canApprove = APPROVERS.has(role);
  const canManagePacks = PAYROLL_ADMINS.has(role);
  const canManagePayments = PAYMENT_MANAGERS.has(role);
  const canExportPayments = APPROVERS.has(role);
  const canSubmitClaims = CLAIM_SUBMITTERS.has(role);
  const canReadOrg = ORG_READERS.has(role);
  const canReviewClaims = canApprove || role === 'MANAGER';
  const canGenerateYearEnd = PAYROLL_ADMINS.has(role);
  const canSeeRemittance = REMITTANCE_READERS.has(role);

  // Tabs a self-service worker still needs (their own payslips + claims).
  const isSelfService = role === 'EMPLOYEE_SELF' || role === 'VOLUNTEER_SELF';
  const showRuns = canReadOrg;
  const showCalendars = canReadOrg;
  const showPayments = canReadOrg && role !== 'VIEWER';
  const showPacks = canReadOrg;
  const showClaims =
    canSubmitClaims || canReadOrg || role === 'MANAGER';

  const tabs: { id: Tab; label: string }[] = [
    ...(showRuns ? [{ id: 'runs' as Tab, label: 'Pay runs' }] : []),
    ...(showCalendars ? [{ id: 'calendars' as Tab, label: 'Calendars' }] : []),
    { id: 'payslips' as Tab, label: isSelfService ? 'My payslips' : 'Payslips' },
    ...(showPayments ? [{ id: 'payments' as Tab, label: 'Payments' }] : []),
    ...(showClaims ? [{ id: 'claims' as Tab, label: 'Reimbursements' }] : []),
    ...(showPacks ? [{ id: 'rule-packs' as Tab, label: 'Statutory rules' }] : []),
    { id: 'year-end' as Tab, label: isSelfService ? 'My year-end' : 'Year-end' },
  ];

  // Until the user picks a tab, always show the first available one. The role
  // (and therefore the tab list) only resolves once `useCurrentUser` finishes,
  // so we follow `tabs[0]` until there is an explicit selection.
  const [picked, setPicked] = useState<Tab | null>(null);
  const activeTab =
    picked && tabs.some((t) => t.id === picked) ? picked : tabs[0]?.id ?? 'payslips';

  return (
    <div className={`${styles.page} cascade`}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>Payroll</h1>
          <p className={styles.pageSubtitle}>
            {loading
              ? 'Pay runs, payslips and calculations'
              : isSelfService
                ? 'Your payslips and expense reimbursements'
                : 'Pay runs, payslips, statutory rules, payments and reimbursements'}
          </p>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Payroll sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeTab === item.id}
            className={`${styles.tab} ${activeTab === item.id ? styles.tabActive : ''}`}
            onClick={() => setPicked(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {activeTab === 'runs' ? (
        <RunsPanel canManage={canManageRuns} canApprove={canApprove} />
      ) : activeTab === 'calendars' ? (
        <PayCalendarsPanel canManage={canManageRuns} />
      ) : activeTab === 'payslips' ? (
        <PayslipsPanel selfService={isSelfService} />
      ) : activeTab === 'payments' ? (
        <PaymentsPanel
          canManage={canManagePayments}
          canExport={canExportPayments}
        />
      ) : activeTab === 'claims' ? (
        <ClaimsPanel
          canSubmit={canSubmitClaims}
          canReview={canReviewClaims}
          selfService={isSelfService}
        />
      ) : activeTab === 'year-end' ? (
        <YearEndPanel
          canGenerate={canGenerateYearEnd}
          canSeeRemittance={canSeeRemittance}
        />
      ) : (
        <RulePacksPanel canManage={canManagePacks} />
      )}
    </div>
  );
}
