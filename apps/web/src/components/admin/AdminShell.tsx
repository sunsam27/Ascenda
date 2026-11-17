'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import SessionRefresher from '@/components/auth/SessionRefresher';
import styles from './admin.module.css';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    api
      .get('/admin/session', { signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) setState('ready');
      })
      .catch((error: { response?: { status?: number } }) => {
        if (!controller.signal.aborted)
          setState(error.response?.status === 403 ? 'forbidden' : 'error');
      });
    return () => controller.abort();
  }, [attempt]);
  async function logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      window.location.assign('/login');
    }
  }
  return (
    <div className={`app-bg ${styles.shell}`}>
      <SessionRefresher />
      <header className={`glass-nav ${styles.header}`}>
        <Link href="/admin" className={styles.brand}>
          <ShieldCheck size={24} aria-hidden="true" /> Ascenda Admin
        </Link>
        <div className={styles.actions}>
          <Link href="/dashboard">Customer workspace</Link>
          <button type="button" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      {state === 'ready' && (
        <nav className={styles.nav} aria-label="Platform administration">
          {[
            ['/admin', 'Overview'],
            ['/admin/plans', 'Plans and pricing'],
            ['/admin/subscriptions', 'Subscriptions and demos'],
            ['/admin/signups', 'Signups'],
            ['/admin/history', 'Change history'],
          ].map(([href, label]) => (
            <Link key={href} href={href!} aria-current={pathname === href ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      )}
      <main className={styles.main}>
        {state === 'loading' ? (
          <p role="status">Checking platform administrator access…</p>
        ) : state === 'forbidden' ? (
          <section className={styles.card}>
            <h1>Platform administrators only</h1>
            <p>Organisation ownership does not grant access to the Ascenda Admin Console.</p>
            <Link href="/dashboard">Return to your workspace</Link>
          </section>
        ) : state === 'error' ? (
          <section className={styles.card}>
            <h1>Admin Console unavailable</h1>
            <p>We could not verify your access.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </section>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
