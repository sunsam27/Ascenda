'use client';

import { useEffect, useState, FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { api } from '@/lib/api';
import styles from './LoginForm.module.css';

const MIN_PASSWORD_LENGTH = 12;

type Status = 'checking' | 'ready' | 'invalid' | 'done';
type FieldErrors = Partial<Record<'password' | 'confirm', string>>;

interface Invitation {
  email: string;
  organisationName: string;
  expiresAt: string;
}

export default function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState<Status>('checking');
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    if (!token) {
      setStatus('invalid');
      return;
    }

    api
      .get<Invitation>('/auth/invitation', { params: { token } })
      .then(({ data }) => {
        if (active) {
          setInvitation(data);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) setStatus('invalid');
      });

    return () => {
      active = false;
    };
  }, [token]);

  function passwordError(value: string): string | undefined {
    if (value.length < MIN_PASSWORD_LENGTH) {
      return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return undefined;
  }

  function confirmError(value: string, original: string): string | undefined {
    return value === original ? undefined : 'Passwords do not match.';
  }

  function handleBlur(field: 'password' | 'confirm', value: string) {
    const message =
      field === 'password'
        ? passwordError(value)
        : confirmError(value, password);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  function clearError(field: keyof FieldErrors) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  const isComplete =
    !passwordError(password) && !confirmError(confirm, password);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isComplete) return;
    setError('');
    setIsSubmitting(true);
    try {
      const { data } = await api.post<{ redirectTo?: string }>(
        '/auth/set-password',
        { token, password },
      );
      setStatus('done');
      router.push(data.redirectTo ?? '/dashboard');
      router.refresh();
    } catch (err) {
      setIsSubmitting(false);
      const message =
        axios.isAxiosError(err) && err.response?.data
          ? String((err.response.data as { message?: string }).message ?? '')
          : '';
      if (message) {
        setError(message);
      } else if (axios.isAxiosError(err) && err.response) {
        setError(
          `We could not set your password (server error ${err.response.status}). Please try again in a moment.`,
        );
      } else {
        setError(
          'We could not reach the server. Check your connection and try again.',
        );
      }
    }
  }

  if (status === 'checking') {
    return (
      <div className={styles.card} role="status" aria-live="polite">
        <Header subtitle="Checking your invitation…" />
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className={styles.card}>
        <Header subtitle="Set your password" />
        <p className={styles.errorBanner} role="alert">
          This invitation link is invalid or has expired. If you already set your
          password, sign in instead. Otherwise ask your workspace admin to resend
          your invitation.
        </p>
        <p className={styles.footer}>
          Already set up? <Link href="/login">Sign in</Link>. Need a workspace?{' '}
          <Link href="/signup">Create one</Link>.
        </p>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className={styles.card} role="status" aria-live="polite">
        <Header subtitle="Your account is ready" />
        <p className={styles.footer}>Taking you to your dashboard…</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <Header subtitle={`Set a password for ${invitation?.organisationName}`} />

      <p className={styles.subtitle} style={{ textAlign: 'center' }}>
        Signing in as <strong>{invitation?.email}</strong>
      </p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label htmlFor="sp-password" className={styles.label}>
            New password
          </label>
          <input
            id="sp-password"
            type="password"
            className={`${styles.input}${errors.password ? ` ${styles.inputError}` : ''}`}
            placeholder="At least 12 characters"
            autoComplete="new-password"
            required
            value={password}
            aria-invalid={errors.password ? true : undefined}
            onChange={(e) => {
              setPassword(e.currentTarget.value);
              clearError('password');
            }}
            onBlur={(e) => handleBlur('password', e.currentTarget.value)}
          />
          {errors.password && (
            <p className={styles.errorText} role="alert">
              {errors.password}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="sp-confirm" className={styles.label}>
            Confirm password
          </label>
          <input
            id="sp-confirm"
            type="password"
            className={`${styles.input}${errors.confirm ? ` ${styles.inputError}` : ''}`}
            placeholder="Re-enter your password"
            autoComplete="new-password"
            required
            value={confirm}
            aria-invalid={errors.confirm ? true : undefined}
            onChange={(e) => {
              setConfirm(e.currentTarget.value);
              clearError('confirm');
            }}
            onBlur={(e) => handleBlur('confirm', e.currentTarget.value)}
          />
          {errors.confirm && (
            <p className={styles.errorText} role="alert">
              {errors.confirm}
            </p>
          )}
        </div>

        {error && (
          <p className={styles.errorBanner} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className={styles.submitButton}
          disabled={isSubmitting || !isComplete}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Setting password…
            </>
          ) : (
            'Set password & sign in'
          )}
        </button>
      </form>
    </div>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <>
      <div className={styles.brand}>
        <Image
          src="/ascenda-logo.png"
          alt=""
          width={70}
          height={70}
          className={styles.logoMark}
          aria-hidden="true"
          priority
        />
        <span className={styles.brandName}>Ascenda</span>
      </div>
      <div className={styles.header}>
        <h1 className={styles.title}>Welcome aboard</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
    </>
  );
}
