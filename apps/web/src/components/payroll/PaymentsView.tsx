'use client';

import { useCurrentUser } from '@/lib/useCurrentUser';
import EmployerWalletPanel from '@/components/payroll/EmployerWalletPanel';
import styles from '@/components/payroll/payroll.module.css';

/** Roles permitted by the org-wide `payments:approve` grant. */
const PAYMENT_APPROVERS = new Set(['OWNER', 'FINANCE_APPROVER']);
/** Company funding setup uses the existing settings:update grant. */
const FUNDING_SETUP_ADMINS = new Set(['OWNER']);
/** Roles that may read payments (everything else is denied by the API). */
const PAYMENT_READERS = new Set([
  'OWNER',
  'PAYROLL_ADMINISTRATOR',
  'FINANCE_APPROVER',
  'AUDITOR',
  'SUPPORT_READ_ONLY',
]);

export default function PaymentsView() {
  const { user, loading } = useCurrentUser();
  const role = user?.role ?? '';
  const canRead = PAYMENT_READERS.has(role);

  return (
    <div className={`${styles.page} cascade`}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>Payments</h1>
          <p className={styles.pageSubtitle}>
            Fund company payroll, review available funds and pay approved salaries
          </p>
        </div>
      </div>

      {loading ? (
        <div className={styles.spinnerRow}>Loading…</div>
      ) : canRead ? (
        <EmployerWalletPanel
          canApprove={PAYMENT_APPROVERS.has(role)}
          canSetup={FUNDING_SETUP_ADMINS.has(role)}
        />
      ) : (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Payments are restricted</p>
          <p className={styles.muted}>
            Your role does not have permission to view payments.
          </p>
        </div>
      )}
    </div>
  );
}
