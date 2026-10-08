import type { Metadata } from 'next';
import styles from './settings.module.css';

export const metadata: Metadata = { title: 'Settings | Ascenda' };

export default function SettingsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageSubtitle}>Organisation configuration</p>
      </div>
      <div className={`glass ${styles.comingSoon}`}>
        <p className={styles.phaseLabel}>Phase 0</p>
        <p className={styles.comingText}>Settings module — Part of Phase 0</p>
        <p className={styles.comingNote}>Organisation setup: country, currency, terminology overrides, user roles and permissions.</p>
      </div>
    </div>
  );
}
