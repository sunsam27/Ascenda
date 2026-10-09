'use client';

import { useState, FormEvent } from 'react';
import Image from 'next/image';
import styles from './LoginForm.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  function emailError(value: string): string | undefined {
    return EMAIL_PATTERN.test(value.trim())
      ? undefined
      : 'Please enter a valid email address.';
  }

  function passwordError(value: string): string | undefined {
    return value.length > 0 ? undefined : 'Please enter your password.';
  }

  function handleBlur(field: 'email' | 'password', value: string) {
    const message =
      field === 'email' ? emailError(value) : passwordError(value);
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

  const isComplete = !emailError(email) && !passwordError(password);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      // TODO: Call auth API
      await new Promise((r) => setTimeout(r, 800));
      // router.push('/dashboard');
    } catch {
      setError('Invalid email or password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      {/* Logo / brand */}
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
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.subtitle}>Sign in to your workspace</p>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert" aria-live="assertive">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="login-email" className={styles.label}>Email address</label>
          <input
            id="login-email"
            type="email"
            className={`${styles.input}${errors.email ? ` ${styles.inputError}` : ''}`}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError('email');
            }}
            onBlur={(e) => handleBlur('email', e.target.value)}
            placeholder="you@yourorg.com"
            autoComplete="email"
            required
            autoFocus
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
          />
          {errors.email && (
            <p id="login-email-error" className={styles.errorText} role="alert">
              {errors.email}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="login-password" className={styles.label}>Password</label>
          <input
            id="login-password"
            type="password"
            className={`${styles.input}${errors.password ? ` ${styles.inputError}` : ''}`}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError('password');
            }}
            onBlur={(e) => handleBlur('password', e.target.value)}
            placeholder="••••••••••••"
            autoComplete="current-password"
            required
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? 'login-password-error' : undefined}
          />
          {errors.password && (
            <p id="login-password-error" className={styles.errorText} role="alert">
              {errors.password}
            </p>
          )}
          <a href="/forgot-password" className={styles.forgotLink}>Forgot password?</a>
        </div>

        <button
          id="login-submit"
          type="submit"
          className={styles.submitButton}
          disabled={isLoading || !isComplete}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>

      <p className={styles.footer}>
        Don&apos;t have an account?{' '}
        <a href="/register">Contact your administrator</a>
      </p>
    </div>
  );
}
