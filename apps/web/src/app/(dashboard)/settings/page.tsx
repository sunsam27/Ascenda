import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './settings.module.css';

export const metadata: Metadata = { title: 'Settings | Ascenda' };

export default function SettingsPage() {
  return (
    <div className={`${styles.page} cascade`}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageSubtitle}>Organisation configuration</p>
      </div>

      <Link href="/settings/plans" className={`glass ${styles.linkCard}`}>
        <div>
          <p className={styles.comingText}>Plans</p>
          <p className={styles.comingNote}>
            Manage subscription tiers — names, prices and headcount limits.
          </p>
        </div>
        <span className={styles.linkArrow} aria-hidden="true">
          →
        </span>
      </Link>

      <Link href="/settings/signups" className={`glass ${styles.linkCard}`}>
        <div>
          <p className={styles.comingText}>Signups</p>
          <p className={styles.comingNote}>
            Workspaces created through self-serve signup.
          </p>
        </div>
        <span className={styles.linkArrow} aria-hidden="true">
          →
        </span>
      </Link>

      <div className={`glass ${styles.comingSoon}`}>
        <p className={styles.phaseLabel}>Phase 0</p>
        <p className={styles.comingText}>Settings module — Part of Phase 0</p>
        <p className={styles.comingNote}>Organisation setup: country, currency, terminology overrides, user roles and permissions.</p>
      </div>
    </div>
  );
}
