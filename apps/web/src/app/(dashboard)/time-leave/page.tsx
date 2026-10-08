import type { Metadata } from 'next';
import styles from './time-leave.module.css';

export const metadata: Metadata = { title: 'Time & Leave | Ascenda' };

export default function TimeLeavePage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Time &amp; Leave</h1>
        <p className={styles.pageSubtitle}>Attendance and leave management</p>
      </div>
      <div className={`glass ${styles.comingSoon}`}>
        <p className={styles.phaseLabel}>Phase 2</p>
        <p className={styles.comingText}>Time &amp; Leave module — coming in Phase 2</p>
        <p className={styles.comingNote}>Attendance tracking, leave types, balances, and approval workflow.</p>
      </div>
    </div>
  );
}
