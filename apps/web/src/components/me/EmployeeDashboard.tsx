'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import {
  BadgeCheck,
  CalendarClock,
  FileText,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  Phone,
} from 'lucide-react';
import type { SelfWorkerProfile } from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser, displayNameOf } from '@/lib/useCurrentUser';
import { useOrganisation } from '@/lib/useOrganisation';
import BankAccountsPanel from '@/components/people/BankAccountsPanel';
import PayslipsPanel from '@/components/payroll/PayslipsPanel';
import styles from './me.module.css';

type LoadState = 'loading' | 'ready' | 'error';

function initials(worker: SelfWorkerProfile['worker'] | undefined): string {
  const first = worker?.firstName?.trim().charAt(0) ?? '';
  const last = worker?.lastName?.trim().charAt(0) ?? '';
  return `${first}${last}`.toUpperCase() || '?';
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function EmployeeDashboard() {
  const { user } = useCurrentUser();
  const { organisation } = useOrganisation();
  const [profile, setProfile] = useState<SelfWorkerProfile | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  // null = bank list not yet loaded; a number = known live count.
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [bankGateDismissed, setBankGateDismissed] = useState(false);

  useEffect(() => {
    if (typeof accountCount === 'number' && accountCount > 0) {
      setBankGateDismissed(true);
    }
  }, [accountCount]);

  useEffect(() => {
    let active = true;
    api
      .get<{ data: SelfWorkerProfile }>('/workers/me')
      .then(({ data }) => {
        if (!active) return;
        setProfile(data.data);
        setState('ready');
      })
      .catch((err) => {
        if (!active) return;
        setState('error');
        setError(
          axios.isAxiosError(err) && err.response?.status === 404
            ? 'Your employee record could not be found. Please contact your administrator.'
            : 'We could not load your profile.',
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const worker = profile?.worker;
  const workerId = worker?.id;
  const gateActive =
    state === 'ready' &&
    !!workerId &&
    accountCount === 0 &&
    !bankGateDismissed;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            Hello{worker ? `, ${worker.firstName}` : user ? `, ${displayNameOf(user)}` : ''}
          </h1>
          <p className={styles.subtitle}>
            Your personal workspace at {organisation?.name ?? 'your organisation'}.
          </p>
        </div>
      </header>

      {state === 'loading' ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading your details…
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>{error}</p>
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.mainColumn}>
            <div className={styles.grid}>
                <section className={`glass ${styles.card}`} aria-labelledby="me-profile">
                  <div className={styles.identity}>
                    <span className={styles.identityAvatar} aria-hidden="true">
                      {initials(worker)}
                    </span>
                    <div className={styles.identityText}>
                      <h2 id="me-profile" className={styles.identityName}>
                        {worker
                          ? `${worker.firstName} ${worker.lastName}`.trim()
                          : displayNameOf(user)}
                      </h2>
                      <p className={styles.identityRole}>
                        {worker?.jobTitle ?? 'Team member'}
                      </p>
                      <div className={styles.identityChips}>
                        {worker?.employeeNumber && (
                          <span className={styles.chip}>
                            #{worker.employeeNumber}
                          </span>
                        )}
                        {worker?.departmentName && (
                          <span className={styles.chip}>{worker.departmentName}</span>
                        )}
                        {worker?.locationName && (
                          <span className={styles.chip}>{worker.locationName}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <dl className={styles.facts}>
                    <div className={styles.fact}>
                      <dt className={styles.factLabel}>
                        <Mail size={14} strokeWidth={2} aria-hidden /> Email
                      </dt>
                      <dd className={styles.factValue}>
                        {worker?.email ?? user?.email ?? '—'}
                      </dd>
                    </div>
                    <div className={styles.fact}>
                      <dt className={styles.factLabel}>
                        <Phone size={14} strokeWidth={2} aria-hidden /> Phone
                      </dt>
                      <dd className={styles.factValue}>{worker?.phone ?? '—'}</dd>
                    </div>
                    <div className={styles.fact}>
                      <dt className={styles.factLabel}>
                        <CalendarClock size={14} strokeWidth={2} aria-hidden /> Start date
                      </dt>
                      <dd className={styles.factValue}>
                        {formatDate(worker?.startDate)}
                      </dd>
                    </div>
                  </dl>

                  <p className={styles.readonlyNote}>
                    <BadgeCheck size={14} strokeWidth={2} aria-hidden /> Managed by{' '}
                    {organisation?.name ?? 'your organisation'}. Contact your
                    administrator to make changes.
                  </p>
                </section>

                <section className={`glass ${styles.card}`} aria-labelledby="me-bank">
                  <div className={styles.cardHead}>
                    <h2 id="me-bank" className={styles.cardTitle}>
                      Bank details
                    </h2>
                  </div>
                  <p className={styles.muted}>
                    Where your pay is sent. You can update it any time.
                  </p>
                  {!gateActive && (
                    <BankAccountsPanel
                      workerId={workerId}
                      canManage
                      compact
                      flush
                      onAccountsChange={setAccountCount}
                    />
                  )}
                </section>
            </div>

            <div className={styles.quickLinks}>
              <Link href="/time-leave" className={`glass ${styles.quickLink}`}>
                <CalendarClock size={20} strokeWidth={1.75} aria-hidden />
                <span>
                  <span className={styles.quickLinkTitle}>Time &amp; Leave</span>
                  <span className={styles.quickLinkSub}>Request and track leave</span>
                </span>
              </Link>
              <Link href="/documents" className={`glass ${styles.quickLink}`}>
                <FileText size={20} strokeWidth={1.75} aria-hidden />
                <span>
                  <span className={styles.quickLinkTitle}>Documents</span>
                  <span className={styles.quickLinkSub}>Your files and contracts</span>
                </span>
              </Link>
              {worker?.locationName && (
                <span className={`glass ${styles.quickLink} ${styles.quickLinkStatic}`}>
                  <MapPin size={20} strokeWidth={1.75} aria-hidden />
                  <span>
                    <span className={styles.quickLinkTitle}>{worker.locationName}</span>
                    <span className={styles.quickLinkSub}>Work location</span>
                  </span>
                </span>
              )}
            </div>

            <section className={styles.payslips} aria-labelledby="me-payslips">
              <h2 id="me-payslips" className={styles.sectionTitle}>
                My payslips
              </h2>
              <PayslipsPanel selfService />
            </section>
          </div>
        </div>
      )}

      {gateActive && (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="me-onboarding-title"
        >
          <div className={`glass ${styles.modal}`}>
            <span className={styles.modalIcon} aria-hidden="true">
              <Landmark size={24} strokeWidth={1.9} />
            </span>
            <h2 id="me-onboarding-title" className={styles.modalTitle}>
              Add your bank details
            </h2>
            <p className={styles.modalText}>
              We need an account to send your pay to. This only takes a moment —
              enter your 10-digit account number and we&apos;ll detect your bank
              automatically.
            </p>
            <BankAccountsPanel
              workerId={workerId}
              canManage
              autoOpenAdd
              onAccountsChange={setAccountCount}
            />
            <p className={styles.modalNote}>
              Entered the wrong details? You can update or add accounts any time
              from your dashboard. Contact your administrator if you believe this
              is a mistake.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
