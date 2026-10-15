'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  PayFrequency,
  type CompensationRecord,
  type CreateCompensationDto,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { formatMinorUnits, toMinorUnits } from '@/lib/money';
import styles from './people.module.css';

const FREQUENCY_LABEL: Record<PayFrequency, string> = {
  [PayFrequency.WEEKLY]: 'Weekly',
  [PayFrequency.BIWEEKLY]: 'Every 2 weeks',
  [PayFrequency.MONTHLY]: 'Monthly',
  [PayFrequency.QUARTERLY]: 'Quarterly',
};

type LoadState = 'loading' | 'ready' | 'restricted' | 'error';

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/** True when the half-open period [validFrom, validTo) contains `date`. */
function isInForce(record: CompensationRecord, date: Date): boolean {
  if (new Date(record.validFrom).getTime() > date.getTime()) return false;
  if (!record.validTo) return true;
  return new Date(record.validTo).getTime() > date.getTime();
}

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function money(minor: number, currency: string): string {
  return formatMinorUnits(minor, currency);
}

export default function CompensationPanel({
  worker,
  currency,
}: {
  worker: WorkerSummary | null;
  /** Organisation default currency for new records. */
  currency: string;
}) {
  const { user } = useCurrentUser();
  const canManage =
    user?.role === 'OWNER' || user?.role === 'PAYROLL_ADMINISTRATOR';

  const [state, setState] = useState<LoadState>('loading');
  const [records, setRecords] = useState<CompensationRecord[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [payFrequency, setPayFrequency] = useState<PayFrequency>(
    PayFrequency.MONTHLY,
  );
  const [validFrom, setValidFrom] = useState(todayInput());
  const [notes, setNotes] = useState('');

  const workerId = worker?.id;

  const load = useCallback(async () => {
    if (!workerId) return;
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{ data: CompensationRecord[] }>(
        `/workers/${workerId}/compensation`,
      );
      setRecords(data.data);
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

  async function add() {
    if (!workerId) return;
    const minor = toMinorUnits(amount);
    if (minor === null) {
      setError('Enter a valid amount, e.g. 250000 or 250000.50');
      return;
    }
    if (!validFrom) {
      setError('An effective date is required.');
      return;
    }
    const payload: CreateCompensationDto = {
      grossAmountMinorUnits: minor,
      currency,
      payFrequency,
      validFrom,
      notes: notes.trim() || undefined,
    };
    setBusy(true);
    setError('');
    try {
      await api.post(`/workers/${workerId}/compensation`, payload);
      setAdding(false);
      setAmount('');
      setNotes('');
      await load();
    } catch (err) {
      setError(
        messageFrom(err, 'Could not add the compensation record. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(record: CompensationRecord) {
    if (!workerId) return;
    const ok = window.confirm('Delete this compensation record?');
    if (!ok) return;
    setBusyId(record.id);
    setError('');
    try {
      await api.delete(`/workers/${workerId}/compensation/${record.id}`);
      await load();
    } catch (err) {
      setError(
        messageFrom(err, 'Could not delete the compensation record.'),
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!workerId) return null;

  if (state === 'loading') {
    return (
      <div className={styles.compEmpty}>
        <Loader2 className={styles.spin} size={14} /> Loading pay history…
      </div>
    );
  }

  if (state === 'restricted') {
    return <p className={styles.muted}>Compensation is restricted for your role.</p>;
  }

  if (state === 'error') {
    return (
      <p className={styles.error} role="alert">
        Could not load pay history.
      </p>
    );
  }

  const now = new Date();
  const current = records.find((r) => isInForce(r, now)) ?? null;

  return (
    <div className={styles.compPanel}>
      <div className={styles.compHeader}>
        <div className={styles.compCurrent}>
          {current ? (
            <>
              <span className={styles.compAmount}>
                {money(current.grossAmountMinorUnits, current.currency)}
              </span>
              <span className={styles.compCadence}>
                {FREQUENCY_LABEL[current.payFrequency]} · from{' '}
                {current.validFrom.slice(0, 10)}
              </span>
            </>
          ) : (
            <span className={styles.compCadence}>No pay rate on file</span>
          )}
        </div>
        {canManage && !adding && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => {
              setAdding(true);
              setError('');
            }}
          >
            <Plus size={15} strokeWidth={2.2} /> Add
          </button>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {adding && (
        <div className={styles.compForm}>
          <label className={styles.field}>
            <span className={styles.label}>Gross amount ({currency})</span>
            <input
              className={styles.input}
              inputMode="decimal"
              placeholder="250000.00"
              value={amount}
              onChange={(e) => setAmount(e.currentTarget.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Frequency</span>
            <select
              className={styles.input}
              value={payFrequency}
              onChange={(e) =>
                setPayFrequency(e.currentTarget.value as PayFrequency)
              }
            >
              {Object.values(PayFrequency).map((value) => (
                <option key={value} value={value}>
                  {FREQUENCY_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Effective from</span>
            <input
              type="date"
              className={styles.input}
              value={validFrom}
              onChange={(e) => setValidFrom(e.currentTarget.value)}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.label}>Notes</span>
            <input
              className={styles.input}
              placeholder="e.g. annual review"
              value={notes}
              onChange={(e) => setNotes(e.currentTarget.value)}
            />
          </label>
          <div className={`${styles.compFormActions} ${styles.fieldFull}`}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => {
                setAdding(false);
                setError('');
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
              Save rate
            </button>
          </div>
        </div>
      )}

      {records.length === 0 ? (
        !adding && (
          <p className={styles.muted}>No compensation recorded yet.</p>
        )
      ) : (
        <ul className={styles.compList}>
          {records.map((record) => {
            const inForce = isInForce(record, now);
            return (
              <li key={record.id} className={styles.compRow}>
                <span className={styles.compRowMain}>
                  <span className={styles.compRowAmount}>
                    {money(record.grossAmountMinorUnits, record.currency)}
                    <span className={styles.compRowCadence}>
                      {FREQUENCY_LABEL[record.payFrequency]}
                    </span>
                  </span>
                  <span className={styles.compRowMeta}>
                    {record.validFrom.slice(0, 10)} —{' '}
                    {record.validTo ? record.validTo.slice(0, 10) : 'present'}
                    {record.notes ? ` · ${record.notes}` : ''}
                  </span>
                </span>
                {inForce && (
                  <span className={`${styles.status} ${styles.statusActive}`}>
                    Current
                  </span>
                )}
                {canManage && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => remove(record)}
                    disabled={busyId === record.id}
                    aria-label="Delete compensation record"
                    title="Delete"
                  >
                    {busyId === record.id ? (
                      <Loader2 className={styles.spin} size={15} />
                    ) : (
                      <Trash2 size={15} strokeWidth={2} />
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
