import type { Metadata } from 'next';
import styles from './documents.module.css';

export const metadata: Metadata = { title: 'Documents | Ascenda' };

export default function DocumentsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Documents</h1>
        <p className={styles.pageSubtitle}>Worker documents and contracts</p>
      </div>
      <div className={`glass ${styles.comingSoon}`}>
        <p className={styles.phaseLabel}>Phase 4</p>
        <p className={styles.comingText}>Documents module — coming in Phase 4</p>
        <p className={styles.comingNote}>Secure document storage, signed URLs, and access control.</p>
      </div>
    </div>
  );
}
