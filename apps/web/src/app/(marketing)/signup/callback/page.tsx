'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { CircleCheckBig, CircleX, Loader2, RotateCcw } from 'lucide-react';
import { PaymentProvider } from '@ascenda/types';
import { api } from '@/lib/api';
import shared from '../../../../components/marketing/shared.module.css';
import styles from './callback.module.css';

interface StoredCheckout {
  provider: PaymentProvider;
  reference: string;
}

interface VerifyResponse {
  completed: boolean;
  requiresPayment?: boolean;
  redirectTo?: string;
}

type Status = 'verifying' | 'success' | 'pending' | 'error';

function readStored(): StoredCheckout | null {
  try {
    const raw = window.localStorage.getItem('ascenda_checkout');
    if (!raw) return null;
    return JSON.parse(raw) as StoredCheckout;
  } catch {
    return null;
  }
}

function clearStored() {
  try {
    window.localStorage.removeItem('ascenda_checkout');
    window.sessionStorage.removeItem('ascenda_pending');
  } catch {
    // ignore
  }
}

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status>('verifying');
  const [message, setMessage] = useState('Confirming your payment…');
  const provider = useRef<PaymentProvider | null>(null);
  const reference = useRef<string | null>(null);
  const requestedOnce = useRef(false);

  const runVerify = useCallback(async () => {
    const activeProvider = provider.current;
    const activeReference = reference.current;
    if (!activeProvider || !activeReference) return;

    setStatus('verifying');
    setMessage('Confirming your payment…');
    try {
      const { data } = await api.post<VerifyResponse>('/billing/verify', {
        reference: activeReference,
        provider: activeProvider,
      });
      if (data.completed) {
        clearStored();
        setStatus('success');
        setMessage('Payment confirmed. Opening your workspace…');
        window.setTimeout(
          () => router.replace(data.redirectTo ?? '/dashboard'),
          900,
        );
      } else {
        setStatus('pending');
        setMessage(
          'Your payment is still pending. This can take a moment — press Check again shortly.',
        );
      }
    } catch (err) {
      setStatus('error');
      setMessage(errorMessage(err));
    }
  }, [router]);

  useEffect(() => {
    const stored = readStored();
    const activeProvider =
      (params.get('provider') as PaymentProvider | null) ?? stored?.provider;
    const activeReference =
      params.get('reference') ??
      params.get('trxref') ??
      params.get('tx_ref') ??
      stored?.reference;

    provider.current = activeProvider ?? null;
    reference.current = activeReference ?? null;

    if (!activeProvider || !activeReference) {
      setStatus('error');
      setMessage(
        'We couldn’t find the payment reference. If you were charged, contact support with your receipt.',
      );
      return;
    }

    if (!requestedOnce.current) {
      requestedOnce.current = true;
      void runVerify();
    }
  }, [params, runVerify]);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {status === 'verifying' && (
          <>
            <span className={styles.iconPending} aria-hidden="true">
              <Loader2 className={styles.spin} size={26} strokeWidth={2} />
            </span>
            <h1 className={styles.title}>Finalising your payment</h1>
          </>
        )}
        {status === 'success' && (
          <>
            <span className={styles.iconSuccess} aria-hidden="true">
              <CircleCheckBig size={28} strokeWidth={2} />
            </span>
            <h1 className={styles.title}>You’re all set</h1>
          </>
        )}
        {status === 'pending' && (
          <>
            <span className={styles.iconPending} aria-hidden="true">
              <Loader2 size={26} strokeWidth={2} />
            </span>
            <h1 className={styles.title}>Payment pending</h1>
          </>
        )}
        {status === 'error' && (
          <>
            <span className={styles.iconError} aria-hidden="true">
              <CircleX size={28} strokeWidth={2} />
            </span>
            <h1 className={styles.title}>Payment not completed</h1>
          </>
        )}

        <p className={styles.message} role="status" aria-live="polite">
          {message}
        </p>

        {(status === 'error' || status === 'pending') && (
          <div className={styles.actions}>
            {(status === 'pending' || status === 'error') && (
              <button
                type="button"
                className={`${shared.btn} ${shared.btnPrimary}`}
                onClick={() => void runVerify()}
              >
                <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
                {status === 'pending' ? 'Check again' : 'Try again'}
              </button>
            )}
            {status === 'error' && (
              <Link
                href="/signup"
                className={`${shared.btn} ${shared.btnSecondary}`}
              >
                Back to signup
              </Link>
            )}
            <Link href="/login" className={`${shared.btn} ${shared.btnSecondary}`}>
              Go to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SignupCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) {
      return 'We couldn’t reach the server to confirm your payment. Please check your dashboard or contact support.';
    }
    const message = (err.response.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? 'Something went wrong.';
    if (typeof message === 'string') return message;
  }
  return 'We couldn’t confirm your payment. Please contact support with your receipt.';
}