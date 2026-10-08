import type { Metadata } from 'next';
import styles from './people.module.css';

export const metadata: Metadata = { title: 'People | Ascenda' };

export default function PeoplePage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>People</h1>
        <p className={styles.pageSubtitle}>Worker directory and profiles</p>
      </div>
      <div className={`glass ${styles.comingSoon}`}>
        <p className={styles.phaseLabel}>Phase 1</p>
        <p className={styles.comingText}>People module — coming in Phase 1</p>
        <p className={styles.comingNote}>Worker profiles, CSV import, departments, and directory search.</p>
      </div>
    </div>
  );
}
