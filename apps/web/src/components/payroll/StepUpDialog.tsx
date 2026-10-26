'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { messageFrom } from './payroll-ui';
import styles from './payroll.module.css';

export default function StepUpDialog({
  open,
  title = 'Confirm it is you',
  description = 'Re-enter your password to continue. This action is audited.',
  confirmLabel = 'Continue',
  onCancel,
  onVerified,
}: {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onVerified: (token: string) => void | Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setMfaCode('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post<{ token: string; expiresIn: number }>(
        '/auth/step-up',
        { password, mfaCode: mfaCode.trim() || undefined },
      );
      await onVerified(data.token);
    } catch (err) {
      setError(messageFrom(err, 'Re-authentication failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>
            <ShieldCheck size={16} strokeWidth={2} /> {title}
          </p>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onCancel}
            aria-label="Close"
            disabled={busy}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.drawerBody}>
          <p className={styles.muted}>{description}</p>
          <label className={styles.field}>
            <span className={styles.label}>Password</span>
            <input
              type="password"
              className={styles.input}
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              autoFocus
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>MFA code (if enabled)</span>
            <input
              className={styles.input}
              value={mfaCode}
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
              onChange={(e) => setMfaCode(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className={styles.drawerActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy && <Loader2 className={styles.spin} size={15} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
