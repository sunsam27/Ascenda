'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Coins, Loader2 } from 'lucide-react';
import {
  type LeaveBalanceSummary,
  type LeaveType,
  type PaginationMeta,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { fetchAllWorkers } from '@/lib/workers';
import styles from './time-leave.module.css';

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function fmtDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type AdjustDraft = { accrued: string; balance: string; note: string };

const BALANCE_PAGE_SIZE = 200;

export default function LeaveBalancesPanel({
  canAdjust,
  canSeeOthers,
}: {
  canAdjust: boolean;
  canSeeOthers: boolean;
}) {
  const [balances, setBalances] = useState<LeaveBalanceSummary[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [mine, setMine] = useState(true);
  const [workerFilter, setWorkerFilter] = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdjustDraft>({
    accrued: '',
    balance: '',
    note: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        year,
        pageSize: 200,
      };
      if (!canSeeOthers || mine) params.mine = true;
      if (canSeeOthers && !mine && workerFilter) params.workerId = workerFilter;
      if (leaveTypeFilter) params.leaveTypeId = leaveTypeFilter;
      const res = await api.get<{
        data: LeaveBalanceSummary[];
        meta: unknown;
      }>('/leave-balances', { params });
      setBalances(res.data.data);
      setError('');
    } catch (err) {
      setError(messageFrom(err, 'Could not load leave balances.'));
    } finally {
      setLoading(false);
    }
  }, [year, mine, workerFilter, leaveTypeFilter, canSeeOthers]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ data: LeaveType[] }>('/leave-types')
      .then((res) => setLeaveTypes(res.data.data))
      .catch(() => {
        // The leave-type filter/labels simply fall back to ids.
      });
  }, []);

  useEffect(() => {
    if (!canSeeOthers) return;
    let active = true;
    fetchAllWorkers()
      .then((rows) => {
        if (active) setWorkers(rows);
      })
      .catch(() => {
        // The worker picker simply stays empty.
      });
    return () => {
      active = false;
    };
  }, [canSeeOthers]);

  const workerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers) map.set(w.id, `${w.firstName} ${w.lastName}`.trim());
    return map;
  }, [workers]);

  const leaveTypeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of leaveTypes) map.set(t.id, t.name);
    return map;
  }, [leaveTypes]);

  function beginAdjust(balance: LeaveBalanceSummary) {
    setError('');
    setNotice('');
    setAdjustingId(balance.id);
    setDraft({
      accrued: String(balance.accrued),
      balance: String(balance.balance),
      note: '',
    });
  }

  function cancelAdjust() {
    setAdjustingId(null);
    setDraft({ accrued: '', balance: '', note: '' });
  }

  async function saveAdjust(balance: LeaveBalanceSummary) {
    const accrued =
      draft.accrued.trim() === '' ? undefined : Number(draft.accrued);
    const remaining =
      draft.balance.trim() === '' ? undefined : Number(draft.balance);
    const payload: Record<string, unknown> = {
      workerId: balance.workerId,
      leaveTypeId: balance.leaveTypeId,
      year,
    };
    if (accrued !== undefined && accrued !== balance.accrued) {
      payload.accrued = accrued;
    }
    if (remaining !== undefined && remaining !== balance.balance) {
      payload.balance = remaining;
    }
    if (payload.accrued === undefined && payload.balance === undefined) {
      setError('Enter a new entitlement or remaining balance.');
      return;
    }
    if (draft.note.trim()) payload.note = draft.note.trim();

    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/leave-balances/adjust', payload);
      cancelAdjust();
      await load();
      setNotice('Balance updated.');
    } catch (err) {
      setError(messageFrom(err, 'Could not update the balance.'));
    } finally {
      setBusy(false);
    }
  }

  async function runAccrual() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.post<{ data: { year: number; updated: number } }>(
        '/leave-balances/accrual/run',
        { year },
      );
      await load();
      setNotice(
        `Accrual run complete for ${res.data.data.year}: ${res.data.data.updated} balance(s) updated.`,
      );
    } catch (err) {
      setError(messageFrom(err, 'Could not run the accrual.'));
    } finally {
      setBusy(false);
    }
  }

  const showPersonColumn = canSeeOthers && !mine;

  return (
    <div className={styles.panel}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <div className={styles.toolbar}>
        <div className={styles.yearNav}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setYear((y) => y - 1)}
            aria-label="Previous year"
          >
            <ChevronLeft size={16} />
          </button>
          <span className={styles.yearLabel}>{year}</span>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setYear((y) => y + 1)}
            aria-label="Next year"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className={styles.toolbarActions}>
          {canSeeOthers && (
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => setMine(e.target.checked)}
              />
              Only mine
            </label>
          )}
          {showPersonColumn && (
            <select
              className={styles.select}
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
              aria-label="Filter by person"
            >
              <option value="">All people</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.firstName} {w.lastName}
                </option>
              ))}
            </select>
          )}
          <select
            className={styles.select}
            value={leaveTypeFilter}
            onChange={(e) => setLeaveTypeFilter(e.target.value)}
            aria-label="Filter by leave type"
          >
            <option value="">All leave types</option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {canAdjust && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={runAccrual}
              disabled={busy}
            >
              {busy ? <Loader2 className={styles.spin} size={15} /> : null}
              Run accrual
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading balances…
        </div>
      ) : balances.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <Coins size={28} strokeWidth={1.5} aria-hidden="true" />
          <p className={styles.messageTitle}>No leave balances</p>
          <p className={styles.muted}>
            Balances appear once a leave type is assigned, a request is approved,
            or an accrual is run for this year.
          </p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {showPersonColumn && <th scope="col">Person</th>}
                <th scope="col">Leave type</th>
                <th className={styles.num} scope="col">
                  Entitlement
                </th>
                <th className={styles.num} scope="col">
                  Used
                </th>
                <th className={styles.num} scope="col">
                  Remaining
                </th>
                {canAdjust && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {balances.map((balance) => (
                <tr key={balance.id}>
                  {showPersonColumn && (
                    <td>
                      {balance.workerName ??
                        workerName.get(balance.workerId) ??
                        '—'}
                    </td>
                  )}
                  <td>
                    {balance.leaveTypeName ??
                      leaveTypeName.get(balance.leaveTypeId) ??
                      'Leave'}
                  </td>
                  <td className={styles.num}>{fmtDays(balance.accrued)}</td>
                  <td className={styles.num}>{fmtDays(balance.used)}</td>
                  <td className={`${styles.num} ${styles.numStrong}`}>
                    {fmtDays(balance.balance)}
                  </td>
                  {canAdjust && (
                    <td>
                      <div className={styles.tableRowActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => beginAdjust(balance)}
                          disabled={busy}
                          aria-label={`Adjust ${balance.leaveTypeName} for ${
                            balance.workerName ?? 'worker'
                          }`}
                        >
                          <Coins size={15} strokeWidth={2} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adjustingId &&
        (() => {
          const balance = balances.find((b) => b.id === adjustingId);
          if (!balance) return null;
          return (
            <div className={`glass ${styles.inlineForm} ${styles.stackedForm}`}>
              <div className={styles.editForm}>
                <p className={styles.messageTitle}>
                  Adjust {balance.leaveTypeName ?? 'balance'}
                  {balance.workerName ? ` · ${balance.workerName}` : ''}
                </p>
                <div className={styles.grid}>
                  <div className={styles.gridItem}>
                    <label className={styles.label} htmlFor="balance-accrued">
                      Entitlement (days)
                    </label>
                    <input
                      id="balance-accrued"
                      className={styles.input}
                      type="number"
                      min={0}
                      step={0.5}
                      value={draft.accrued}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, accrued: e.target.value }))
                      }
                    />
                  </div>
                  <div className={styles.gridItem}>
                    <label className={styles.label} htmlFor="balance-remaining">
                      Remaining (days)
                    </label>
                    <input
                      id="balance-remaining"
                      className={styles.input}
                      type="number"
                      min={0}
                      step={0.5}
                      value={draft.balance}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, balance: e.target.value }))
                      }
                    />
                  </div>
                  <div className={`${styles.gridItem} ${styles.gridFull}`}>
                    <label className={styles.label} htmlFor="balance-note">
                      Note
                    </label>
                    <input
                      id="balance-note"
                      className={styles.input}
                      value={draft.note}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, note: e.target.value }))
                      }
                      placeholder="Reason for the adjustment (optional)"
                    />
                  </div>
                </div>
                <div className={styles.editActions}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={cancelAdjust}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={() => saveAdjust(balance)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 className={styles.spin} size={15} />
                    ) : (
                      <Coins size={15} />
                    )}
                    Save
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
