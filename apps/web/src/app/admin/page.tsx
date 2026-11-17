import Link from 'next/link';
import styles from '@/components/admin/admin.module.css';
export default function AdminOverviewPage() {
  return (
    <div className={styles.page}>
      <header>
        <h1>Platform overview</h1>
        <p className={styles.subtitle}>
          Ascenda product administration, separate from customer organisation settings.
        </p>
      </header>
      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Plans and pricing</h2>
          <p>Manage subscription prices, limits and public plan descriptions.</p>
          <Link href="/admin/plans">Manage plans</Link>
        </section>
        <section className={styles.card}>
          <h2>Workspace signups</h2>
          <p>Review workspaces created through self-service registration.</p>
          <Link href="/admin/signups">View signups</Link>
        </section>
      </div>
      <section className={styles.card}>
        <h2>Price-change policy</h2>
        <p>
          New prices apply to future checkouts. Paid periods and past payments remain unchanged;
          saving a price does not trigger an automatic charge.
        </p>
        <p>
          Active Owners of organisations subscribed to the affected plan are automatically notified.
          Email intents are saved durably and retried after SMTP failures. Delivery requires
          migration 04, configured SMTP and the scheduler.
        </p>
        <Link href="/admin/history">View catalogue change history</Link>
      </section>
    </div>
  );
}
