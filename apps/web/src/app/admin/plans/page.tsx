import type { Metadata } from 'next';
import PlansPanel from '@/components/settings/PlansPanel';
import PlanAccessPanel from '@/components/admin/PlanAccessPanel';
import styles from '@/components/admin/admin.module.css';
export const metadata: Metadata = { title: 'Plans and pricing' };
export default function AdminPlansPage() {
  return (
    <div className={styles.page}>
      <header>
        <h1>Plans and pricing</h1>
        <p className={styles.subtitle}>
          Catalogue changes require password confirmation and are audited. Price changes queue
          notices for affected organisations.
        </p>
      </header>
      <PlansPanel />
      <PlanAccessPanel />
    </div>
  );
}
