'use client';

import { useState, FormEvent } from 'react';
import Image from 'next/image';
import styles from './LoginForm.module.css';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

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
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourorg.com"
            autoComplete="email"
            required
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="login-password" className={styles.label}>Password</label>
          <input
            id="login-password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            autoComplete="current-password"
            required
          />
          <a href="/forgot-password" className={styles.forgotLink}>Forgot password?</a>
        </div>

        <button
          id="login-submit"
          type="submit"
          className={styles.submitButton}
          disabled={isLoading || !email || !password}
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
