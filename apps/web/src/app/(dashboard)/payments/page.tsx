import type { Metadata } from 'next';
import styles from './payments.module.css';

export const metadata: Metadata = { title: 'Payments | Ascenda' };

export default function PaymentsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Payments</h1>
        <p className={styles.pageSubtitle}>Contractor and reimbursement payments</p>
      </div>
      <div className={`glass ${styles.comingSoon}`}>
        <p className={styles.phaseLabel}>Phase 3</p>
        <p className={styles.comingText}>Payments module — coming in Phase 3</p>
        <p className={styles.comingNote}>Contractor stipends, reimbursements, and audited payment file export.</p>
      </div>
    </div>
  );
}
