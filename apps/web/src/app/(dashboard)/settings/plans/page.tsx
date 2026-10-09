import type { Metadata } from 'next';
import PlansPanel from '@/components/settings/PlansPanel';
import styles from '../settings.module.css';

export const metadata: Metadata = { title: 'Plans | Ascenda' };

export default function PlansPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Plans</h1>
        <p className={styles.pageSubtitle}>
          Manage subscription tiers — names, prices and headcount limits.
        </p>
      </div>
      <PlansPanel />
    </div>
  );
}
