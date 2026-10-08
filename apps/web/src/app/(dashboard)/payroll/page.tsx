import type { Metadata } from 'next';
import styles from './payroll.module.css';

export const metadata: Metadata = { title: 'Payroll | Ascenda' };

export default function PayrollPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Payroll</h1>
        <p className={styles.pageSubtitle}>Pay runs, payslips and calculations</p>
      </div>
      <div className={`glass ${styles.comingSoon}`}>
        <p className={styles.phaseLabel}>Phase 3</p>
        <p className={styles.comingText}>Payroll module — coming in Phase 3</p>
        <p className={styles.comingNote}>Pay structures, payroll engine, approval flow, payslips and payment file export.</p>
      </div>
    </div>
  );
}
