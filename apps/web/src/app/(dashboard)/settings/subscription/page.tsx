'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PaymentProvider, type CheckoutSession } from '@ascenda/types';
import axios from 'axios';
import { api } from '@/lib/api';
import { useSubscriptionAccess } from '@/lib/subscription-access';
import styles from '@/components/admin/admin.module.css';

export default function SubscriptionPage() {
  const { access, loading, error } = useSubscriptionAccess();
  const [starting, setStarting] = useState<PaymentProvider | null>(null);
  const [actionError, setActionError] = useState('');

  async function renew(provider: PaymentProvider) {
    setStarting(provider);
    setActionError('');
    try {
      const { data } = await api.post<CheckoutSession>('/billing/renew', { provider });
      window.localStorage.setItem(
        'ascenda_checkout',
        JSON.stringify({ provider, reference: data.reference }),
      );
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      setActionError(
        axios.isAxiosError(err) && err.response?.data?.message
          ? String(err.response.data.message)
          : 'Could not start renewal checkout. Please try again.',
      );
      setStarting(null);
    }
  }

  if (loading) return <p role="status">Loading subscription…</p>;
  if (error || !access) return <p role="alert">Subscription details could not be loaded.</p>;

  const paid = !!access.plan && !access.plan.isFree;

  return (
    <div className={styles.page}>
      <header>
        <h1>Subscription and access</h1>
        <p className={styles.subtitle}>{access.plan?.name ?? 'No subscription'} · {access.state}</p>
      </header>
      <section className={styles.card}>
        <h2>Current access</h2>
        <p>Paid period ends: {access.periodEnd ? new Date(access.periodEnd).toLocaleString() : 'Not applicable'}</p>
        {access.control?.manualUntil && (
          <p>Manual activation expires: {new Date(access.control.manualUntil).toLocaleString()}</p>
        )}
        {access.demoExpiresAt && (
          <p>Temporary feature access expires: {new Date(access.demoExpiresAt).toLocaleString()}</p>
        )}
        {access.state === 'GRACE' && (
          <p>Grace period ends: {new Date(access.graceEndsAt!).toLocaleString()}</p>
        )}
        <p>
          Renewal is manual. A verified payment restores access from the moment it is confirmed;
          no card is charged automatically.
        </p>
        {actionError && <p role="alert">{actionError}</p>}
        {paid ? (
          <div className={styles.actions}>
            <button type="button" disabled={!!starting} onClick={() => void renew(PaymentProvider.PAYSTACK)}>
              {starting === PaymentProvider.PAYSTACK ? 'Starting…' : 'Renew with Paystack'}
            </button>
            <button type="button" disabled={!!starting} onClick={() => void renew(PaymentProvider.FLUTTERWAVE)}>
              {starting === PaymentProvider.FLUTTERWAVE ? 'Starting…' : 'Renew with Flutterwave'}
            </button>
          </div>
        ) : (
          <p>For an upgrade or a temporary feature demo, contact Ascenda support.</p>
        )}
        <p><Link href="/me/payslips">Open historical payslips</Link></p>
      </section>
    </div>
  );
}
