import type { Metadata } from 'next';
import OrganisationPanel from '@/components/settings/OrganisationPanel';
import styles from '../settings.module.css';

export const metadata: Metadata = { title: 'Organisation | Ascenda' };

export default function OrganisationSettingsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Organisation</h1>
        <p className={styles.pageSubtitle}>
          Country, currency, timezone and terminology overrides.
        </p>
      </div>
      <OrganisationPanel />
    </div>
  );
}
