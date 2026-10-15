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

      <Link href="/settings/organisation" className={`glass ${styles.linkCard}`}>
        <div>
          <p className={styles.comingText}>Organisation</p>
          <p className={styles.comingNote}>
            Country, currency, timezone and organisation-type terminology.
          </p>
        </div>
        <span className={styles.linkArrow} aria-hidden="true">
          →
        </span>
      </Link>

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
        <p className={styles.phaseLabel}>Coming soon</p>
        <p className={styles.comingText}>Users &amp; permissions</p>
        <p className={styles.comingNote}>Invite team members, assign roles and fine-tune access.</p>
      </div>
    </div>
  );
}
