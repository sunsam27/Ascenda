'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import styles from './admin.module.css';
type Event = {
  id: string;
  action: string;
  createdAt: string;
  details: { planName?: string; priceChanged?: boolean };
  organisationCount: number;
  fanoutCursor: number;
  fanoutSkipped: number;
  fanoutCompletedAt: string | null;
};
export default function PlanHistoryPanel() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ data: Event[]; meta: { total: number } } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    api
      .get('/admin/plan-events', { params: { page, pageSize: 25 }, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setData(response.data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Change history is unavailable. Confirm migration 04 is installed, then try again.',
          );
      });
    return () => controller.abort();
  }, [page, attempt]);
  return (
    <div className={styles.page}>
      <header>
        <h1>Catalogue change history</h1>
        <p className={styles.subtitle}>
          Immutable platform audit. Notification progress measures organisation fan-out, not inbox
          delivery.
        </p>
      </header>
      {error ? (
        <section className={styles.card} role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </section>
      ) : !data ? (
        <p role="status">Loading changes…</p>
      ) : (
        <>
          <div className={styles.table}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Action</th>
                  <th scope="col">Price notices</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{event.details.planName ?? 'Plan'}</td>
                    <td>{event.action.replace(/_/g, ' ')}</td>
                    <td>
                      {event.details.priceChanged
                        ? `${event.fanoutCursor} / ${event.organisationCount} organisations prepared; ${event.fanoutSkipped} skipped (inactive or no active Owner)`
                        : 'Not a price change'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.data.length === 0 && <p>No catalogue changes recorded.</p>}
          <div className={styles.pagination}>
            <button type="button" disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
              Previous
            </button>
            <span>
              Page {page} · {data.meta.total} changes
            </span>
            <button
              type="button"
              disabled={page * 25 >= data.meta.total}
              onClick={() => setPage((n) => n + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
