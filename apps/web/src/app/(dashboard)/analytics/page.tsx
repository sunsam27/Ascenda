import type { Metadata } from 'next';
import styles from './analytics.module.css';

export const metadata: Metadata = { title: 'Analytics | Ascenda' };

export default function AnalyticsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Analytics</h1>
        <p className={styles.pageSubtitle}>Workforce and payroll dashboards</p>
      </div>
      <div className={`glass ${styles.comingSoon}`}>
        <p className={styles.phaseLabel}>Phase 5</p>
        <p className={styles.comingText}>Analytics module — coming in Phase 5</p>
        <p className={styles.comingNote}>Workforce, payroll and attendance dashboards with audited exports.</p>
      </div>
    </div>
  );
}
