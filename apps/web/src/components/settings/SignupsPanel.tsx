'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import { api } from '@/lib/api';
import {
  RegistrationStatus,
  type RegistrationSummary,
} from '@ascenda/types';
import styles from './SignupsPanel.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING: 'Awaiting code',
  VERIFIED: 'Verified',
  COMPLETED: 'Workspace created',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export default function SignupsPanel() {
  const [state, setState] = useState<LoadState>('loading');
  const [signups, setSignups] = useState<RegistrationSummary[]>([]);

  useEffect(() => {
    let active = true;
    api
      .get<{ data: RegistrationSummary[] }>('/signups')
      .then(({ data }) => {
        if (!active) return;
        setSignups(data.data);
        setState('ready');
      })
      .catch((err) => {
        if (!active) return;
        setState(
          axios.isAxiosError(err) && err.response?.status === 403
            ? 'forbidden'
            : 'error',
        );
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === 'loading') {
    return <p className={styles.muted}>Loading signups…</p>;
  }

  if (state === 'forbidden') {
    return (
      <div className={`glass ${styles.message}`}>
        <p className={styles.messageTitle}>Platform administrators only</p>
        <p className={styles.muted}>
          Your account does not have permission to view workspace signups.
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={`glass ${styles.message}`}>
        <p className={styles.messageTitle}>Something went wrong</p>
        <p className={styles.muted}>We could not load signups.</p>
      </div>
    );
  }

  const completed = signups.filter(
    (s) => s.status === RegistrationStatus.COMPLETED,
  ).length;

  return (
    <div className={styles.wrapper}>
      <div className={styles.summaryRow}>
        <span className={styles.summaryCount}>{signups.length}</span>
        <span className={styles.muted}>
          signup{signups.length === 1 ? '' : 's'} · {completed} activated
        </span>
      </div>

      {signups.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.muted}>No signups yet.</p>
        </div>
      ) : (
        <ul className={styles.list} role="list">
          {signups.map((s) => (
            <li key={s.id} className={`glass ${styles.item}`}>
              <div className={styles.itemMain}>
                <div className={styles.itemHeader}>
                  <span className={styles.orgName}>{s.organisationName}</span>
                  <span
                    className={`${styles.badge} ${styles[s.status.toLowerCase() as Lowercase<RegistrationStatus>]}`}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                <p className={styles.meta}>
                  {s.firstName} {s.lastName} · {s.email}
                </p>
                <p className={styles.meta}>
                  {s.organisationType} · team size {s.teamSize} · plan{' '}
                  {s.planCode} · {formatDate(s.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
