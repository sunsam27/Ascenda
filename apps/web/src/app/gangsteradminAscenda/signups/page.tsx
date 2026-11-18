import type { Metadata } from 'next';
import SignupsPanel from '@/components/settings/SignupsPanel';
import styles from '@/components/admin/admin.module.css';
export const metadata: Metadata = { title: 'Signups' };
export default function AdminSignupsPage() {
  return (
    <div className={styles.page}>
      <header>
        <h1>Workspace signups</h1>
        <p className={styles.subtitle}>Platform-only registration oversight.</p>
      </header>
      <SignupsPanel />
    </div>
  );
}
