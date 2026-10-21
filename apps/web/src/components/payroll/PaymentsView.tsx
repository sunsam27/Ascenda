'use client';

import { useCurrentUser } from '@/lib/useCurrentUser';
import PaymentsPanel from '@/components/payroll/PaymentsPanel';
import styles from '@/components/payroll/payroll.module.css';

/** Roles that may move a payment through its status lifecycle. */
const PAYMENT_MANAGERS = new Set(['OWNER', 'PAYROLL_ADMINISTRATOR']);
/** Roles permitted by the org-wide `payments:export` grant. */
const PAYMENT_EXPORTERS = new Set(['OWNER', 'FINANCE_APPROVER']);
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
            Worker payments created by processed runs and the bank-upload export
          </p>
        </div>
      </div>

      {loading ? (
        <div className={styles.spinnerRow}>Loading…</div>
      ) : canRead ? (
        <PaymentsPanel
          canManage={PAYMENT_MANAGERS.has(role)}
          canExport={PAYMENT_EXPORTERS.has(role)}
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
