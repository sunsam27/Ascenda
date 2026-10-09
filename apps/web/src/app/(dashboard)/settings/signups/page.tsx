import type { Metadata } from 'next';
import SignupsPanel from '@/components/settings/SignupsPanel';
import styles from '../settings.module.css';

export const metadata: Metadata = { title: 'Signups | Ascenda' };

export default function SignupsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Signups</h1>
        <p className={styles.pageSubtitle}>
          Workspaces created through self-serve signup.
        </p>
      </div>
      <SignupsPanel />
    </div>
  );
}
