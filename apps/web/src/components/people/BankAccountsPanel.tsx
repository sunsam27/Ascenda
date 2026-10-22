'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Check, Landmark, Loader2, Plus, ShieldCheck, Star, Trash2 } from 'lucide-react';
import type {
  BankAccount,
  CreateBankAccountDto,
  DetectedBank,
} from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './people.module.css';
import bank from './bank-accounts.module.css';

type LoadState = 'loading' | 'ready' | 'restricted' | 'error';

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

interface Draft {
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
  isPrimary: boolean;
}

function emptyDraft(): Draft {
  return {
    accountNumber: '',
    accountName: '',
    bankCode: '',
    bankName: '',
    isPrimary: true,
  };
}

/**
 * The bank-account editor for a single worker. Used by the org's worker editor
 * (any worker) and by the employee's own dashboard (their own record only). The
 * server narrows the scope; this component only reflects what the API allows.
 */
export default function BankAccountsPanel({
  workerId,
  canManage = true,
  compact = false,
  flush = false,
  autoOpenAdd = false,
  onAccountsChange,
}: {
  workerId: string | undefined;
  /** When false the panel renders read-only (no add/edit/delete). */
  canManage?: boolean;
  /** Tighter layout for the employee dashboard. */
  compact?: boolean;
  /** Blend into an enclosing card (no inner border/background/padding). */
  flush?: boolean;
  /** Start with the add form already open (used by the onboarding modal). */
  autoOpenAdd?: boolean;
  /** Notifies the parent of the live account count (0 → none on file). */
  onAccountsChange?: (count: number) => void;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [banks, setBanks] = useState<DetectedBank[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(autoOpenAdd);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [detected, setDetected] = useState<DetectedBank | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [manualBank, setManualBank] = useState(false);

  const load = useCallback(async () => {
    if (!workerId) return;
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{ data: BankAccount[] }>(
        `/workers/${workerId}/bank-accounts`,
      );
      setAccounts(data.data);
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'restricted'
          : 'error',
      );
    }
  }, [workerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the parent (e.g. the onboarding modal) informed of the live count.
  // Only report once the list has actually loaded, so the gate never flashes
  // while the account list is still in flight.
  useEffect(() => {
    if (state === 'ready') onAccountsChange?.(accounts.length);
    else if (state === 'error' || state === 'restricted') onAccountsChange?.(-1);
  }, [state, accounts.length, onAccountsChange]);

  // The dropdown list is static reference data — fetch once, tolerate failure.
  useEffect(() => {
    api
      .get<{ data: DetectedBank[] }>('/bank-accounts/banks')
      .then(({ data }) => setBanks(data.data))
      .catch(() => setBanks([]));
  }, []);

  // Auto-detect the bank from the account number as the user types.
  useEffect(() => {
    const digits = draft.accountNumber.replace(/\s+/g, '');
    if (digits.length !== 10) {
      setDetected(null);
      return;
    }
    let active = true;
    setDetecting(true);
    api
      .post<{ data: DetectedBank | null }>('/bank-accounts/detect', {
        accountNumber: digits,
      })
      .then(({ data }) => {
        if (!active) return;
        setDetected(data.data);
        if (data.data) {
          setDraft((prev) => ({
            ...prev,
            bankCode: data.data!.bankCode,
            bankName: data.data!.bankName,
          }));
          setManualBank(false);
        } else {
          setManualBank(true);
        }
      })
      .catch(() => {
        if (active) setDetected(null);
      })
      .finally(() => {
        if (active) setDetecting(false);
      });
    return () => {
      active = false;
    };
  }, [draft.accountNumber]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setDraft(emptyDraft());
    setDetected(null);
    setManualBank(false);
    setError('');
  }

  async function add() {
    if (!workerId) return;
    const digits = draft.accountNumber.replace(/\s+/g, '');
    if (!/^\d{10}$/.test(digits)) {
      setError('Enter a valid 10-digit account number.');
      return;
    }
    if (!draft.accountName.trim()) {
      setError('Enter the account name.');
      return;
    }
    // If detection failed, a bank must be explicitly chosen.
    if (!detected && !draft.bankCode && !draft.bankName) {
      setError('Select the bank for this account number.');
      return;
    }

    const payload: CreateBankAccountDto = {
      accountNumber: digits,
      accountName: draft.accountName.trim(),
      isPrimary: draft.isPrimary,
      ...(draft.bankName ? { bankName: draft.bankName } : {}),
      ...(draft.bankCode ? { bankCode: draft.bankCode } : {}),
    };

    setBusy(true);
    setError('');
    try {
      await api.post(`/workers/${workerId}/bank-accounts`, payload);
      setAdding(false);
      resetForm();
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not save the bank account. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(account: BankAccount) {
    if (!workerId) return;
    setBusyId(account.id);
    setError('');
    try {
      await api.patch(`/workers/${workerId}/bank-accounts/${account.id}`, {
        isPrimary: true,
      });
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the bank account.'));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(account: BankAccount) {
    if (!workerId) return;
    const ok = window.confirm('Remove this bank account?');
    if (!ok) return;
    setBusyId(account.id);
    setError('');
    try {
      await api.delete(`/workers/${workerId}/bank-accounts/${account.id}`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not remove the bank account.'));
    } finally {
      setBusyId(null);
    }
  }

  if (!workerId) return null;

  if (state === 'loading') {
    return (
      <div className={styles.compEmpty}>
        <Loader2 className={styles.spin} size={14} /> Loading bank details…
      </div>
    );
  }

  if (state === 'restricted') {
    return <p className={styles.muted}>Bank details are restricted for your role.</p>;
  }

  if (state === 'error') {
    return (
      <p className={styles.error} role="alert">
        Could not load bank details.
      </p>
    );
  }

  return (
    <div
      className={`${styles.compPanel} ${compact ? bank.compact : ''}${
        flush ? ` ${bank.flush}` : ''
      }`}
    >
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {accounts.length === 0 ? (
        !adding && (
          <div className={bank.emptyState}>
            <span className={bank.emptyIcon} aria-hidden="true">
              <Landmark size={20} strokeWidth={1.9} />
            </span>
            <span className={bank.emptyText}>
              <span className={bank.emptyTitle}>No bank account yet</span>
              <span className={bank.emptySub}>
                Add one so future pay can be transferred to you.
              </span>
            </span>
          </div>
        )
      ) : (
        <ul className={bank.list}>
          {accounts.map((account) => (
            <li key={account.id} className={bank.row}>
              <span className={bank.rowIcon} aria-hidden="true">
                <Landmark size={18} strokeWidth={1.9} />
              </span>
              <span className={bank.rowBody}>
                <span className={bank.rowTop}>
                  <span className={bank.rowBank}>
                    {account.bankName || 'Bank account'}
                  </span>
                  <span className={bank.rowMask}>
                    {account.accountNumberMasked}
                  </span>
                </span>
                <span className={bank.rowMeta}>
                  {account.accountName}
                  {account.isVerified && (
                    <span className={bank.rowVerified}>
                      <ShieldCheck size={12} strokeWidth={2.2} /> Verified
                    </span>
                  )}
                </span>
              </span>
              <span className={bank.rowActions}>
                {account.isPrimary && (
                  <span className={bank.primary}>
                    <Star size={12} strokeWidth={2.4} /> Primary
                  </span>
                )}
                {canManage && !account.isPrimary && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => makePrimary(account)}
                    disabled={busyId === account.id}
                    aria-label="Make primary"
                    title="Make primary"
                  >
                    {busyId === account.id ? (
                      <Loader2 className={styles.spin} size={15} />
                    ) : (
                      <Star size={15} strokeWidth={2} />
                    )}
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => remove(account)}
                    disabled={busyId === account.id}
                    aria-label="Remove bank account"
                    title="Remove"
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && !adding && (
        <div className={bank.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => {
              setAdding(true);
              resetForm();
            }}
          >
            <Plus size={15} strokeWidth={2.2} /> Add bank account
          </button>
        </div>
      )}

      {adding && (
        <div className={styles.compForm}>
          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.label}>Account number</span>
            <input
              className={styles.input}
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit NUBAN"
              value={draft.accountNumber}
              onChange={(e) =>
                set(
                  'accountNumber',
                  e.currentTarget.value.replace(/[^\d]/g, '').slice(0, 10),
                )
              }
            />
          </label>

          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.label}>Account name</span>
            <input
              className={styles.input}
              placeholder="As it appears at the bank"
              value={draft.accountName}
              onChange={(e) => set('accountName', e.currentTarget.value)}
            />
          </label>

          {/* Bank: auto-detected, or a dropdown when detection fails. */}
          {draft.accountNumber.length === 10 && (
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>Bank</span>
              {detected && !manualBank ? (
                <span className={bank.detected}>
                  <Check size={15} strokeWidth={2.6} />
                  {detected.bankName}
                  <button
                    type="button"
                    className={bank.changeLink}
                    onClick={() => setManualBank(true)}
                  >
                    Change
                  </button>
                </span>
              ) : detecting ? (
                <span className={styles.muted}>
                  <Loader2 className={styles.spin} size={14} /> Detecting bank…
                </span>
              ) : (
                <>
                  <select
                    className={styles.input}
                    value={draft.bankCode}
                    onChange={(e) => {
                      const code = e.currentTarget.value;
                      const bank = banks.find((b) => b.bankCode === code);
                      setDraft((prev) => ({
                        ...prev,
                        bankCode: code,
                        bankName: bank?.bankName ?? '',
                      }));
                    }}
                  >
                    <option value="">Select a bank…</option>
                    {banks.map((b) => (
                      <option key={b.bankCode} value={b.bankCode}>
                        {b.bankName}
                      </option>
                    ))}
                  </select>
                  <span className={bank.hint}>
                    We couldn’t detect the bank from this number — please pick one.
                  </span>
                </>
              )}
            </div>
          )}

          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span className={bank.checkbox}>
              <input
                type="checkbox"
                checked={draft.isPrimary}
                onChange={(e) => set('isPrimary', e.currentTarget.checked)}
              />
              Use as my primary account for pay
            </span>
          </label>

          <div className={`${styles.compFormActions} ${styles.fieldFull}`}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={add}
              disabled={busy}
            >
              {busy && <Loader2 className={styles.spin} size={15} />}
              Save account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
