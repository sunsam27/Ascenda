'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Check, Download, Loader2, RefreshCw, X } from 'lucide-react';
import {
  PaymentStatus,
  type Payment,
  type PayrollRun,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { formatMinorUnits } from '@/lib/money';
import {
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  formatRange,
  messageFrom,
} from './payroll-ui';
import styles from './payroll.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const STATUS_FILTERS: (PaymentStatus | 'ALL')[] = [
  'ALL',
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
  PaymentStatus.COMPLETED,
  PaymentStatus.FAILED,
  PaymentStatus.REVERSED,
];

/** Allowed next statuses per current status (mirrors the API matrix). */
const NEXT_STATUSES: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING],
  [PaymentStatus.PROCESSING]: [
    PaymentStatus.COMPLETED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.COMPLETED]: [PaymentStatus.REVERSED],
  [PaymentStatus.FAILED]: [PaymentStatus.PROCESSING],
  [PaymentStatus.REVERSED]: [],
};

export default function PaymentsPanel({
  canManage,
  canExport,
}: {
  canManage: boolean;
  canExport: boolean;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [runFilter, setRunFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'ALL'>('ALL');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const params: Record<string, string | number> = { pageSize: 200 };
      if (runFilter) params['payrollRunId'] = runFilter;
      if (statusFilter !== 'ALL') params['status'] = statusFilter;
      const { data } = await api.get<{ data: Payment[] }>('/payments', { params });
      setPayments(data.data);
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'forbidden'
          : 'error',
      );
    }
  }, [runFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ data: PayrollRun[] }>('/payroll/runs', { params: { pageSize: 100 } })
      .then((res) => setRuns(res.data.data))
      .catch(() => setRuns([]));
  }, []);

  async function move(payment: Payment, status: PaymentStatus) {
    let reason: string | undefined;
    if (status === PaymentStatus.FAILED || status === PaymentStatus.REVERSED) {
      const input = window.prompt(`Reason for marking this payment ${status.toLowerCase()}?`);
      if (!input) return;
      reason = input;
    }
    setBusyId(payment.id);
    setError('');
    setNotice('');
    try {
      await api.patch(`/payments/${payment.id}/status`, { status, reason });
      setNotice(`Payment moved to ${PAYMENT_STATUS_LABEL[status]}.`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the payment.'));
    } finally {
      setBusyId('');
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError('');
    try {
      const params: Record<string, string> = { format: 'CSV' };
      if (runFilter) params['payrollRunId'] = runFilter;
      if (statusFilter !== 'ALL') params['status'] = statusFilter;
      const res = await api.get('/payments/export', {
        params,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(messageFrom(err, 'Could not export the payment file.'));
    } finally {
      setExporting(false);
    }
  }

  const total = payments.reduce((sum, p) => sum + p.amountMinorUnits, 0);
  const currency = payments[0]?.currency ?? 'NGN';

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <label className={styles.field}>
            <span className={styles.label}>Run</span>
            <select
              className={styles.select}
              value={runFilter}
              onChange={(e) => setRunFilter(e.currentTarget.value)}
            >
              <option value="">All runs</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {formatRange(run.periodStart, run.periodEnd)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Status</span>
            <select
              className={styles.select}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.currentTarget.value as PaymentStatus | 'ALL')}
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === 'ALL' ? 'All statuses' : PAYMENT_STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => void load()}>
            <RefreshCw size={15} strokeWidth={2} /> Refresh
          </button>
          {canExport && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void exportCsv()}
              disabled={exporting || payments.length === 0}
            >
              {exporting ? <Loader2 className={styles.spin} size={15} /> : <Download size={15} strokeWidth={2.2} />}
              Export bank file
            </button>
          )}
        </div>
      </div>

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

      {state === 'loading' ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading payments…
        </div>
      ) : state === 'forbidden' ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Payments are restricted</p>
          <p className={styles.muted}>Your role cannot view payments.</p>
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the payments.</p>
        </div>
      ) : payments.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>No payments</p>
          <p className={styles.muted}>
            Payments are created when an approved run is processed.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.summary}>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Payments</span>
              <span className={styles.statValue}>{payments.length}</span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Total value</span>
              <span className={styles.statValue}>
                {formatMinorUnits(total, currency)}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Pending</span>
              <span className={styles.statValue}>
                {payments.filter((p) => p.status === PaymentStatus.PENDING).length}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Completed</span>
              <span className={styles.statValue}>
                {payments.filter((p) => p.status === PaymentStatus.COMPLETED).length}
              </span>
            </div>
          </div>

          <div className={`glass ${styles.tableWrap}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Worker</th>
                  <th className={styles.num}>Amount</th>
                  <th>Status</th>
                  {canManage && (
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.reference}</td>
                    <td>{payment.workerId.slice(0, 8)}</td>
                    <td className={`${styles.num} ${styles.numStrong}`}>
                      {formatMinorUnits(payment.amountMinorUnits, payment.currency)}
                    </td>
                    <td>
                      <span
                        className={`${styles.badge} ${
                          styles[PAYMENT_STATUS_TONE[payment.status] as keyof typeof styles] ?? ''
                        }`}
                      >
                        {PAYMENT_STATUS_LABEL[payment.status]}
                      </span>
                    </td>
                    {canManage && (
                      <td className={styles.tableRowActions}>
                        {NEXT_STATUSES[payment.status].map((next) => (
                          <button
                            key={next}
                            type="button"
                            className={styles.btn}
                            onClick={() => void move(payment, next)}
                            disabled={busyId === payment.id}
                          >
                            {busyId === payment.id ? (
                              <Loader2 className={styles.spin} size={14} />
                            ) : next === PaymentStatus.FAILED ||
                              next === PaymentStatus.REVERSED ? (
                              <X size={14} strokeWidth={2.2} />
                            ) : (
                              <Check size={14} strokeWidth={2.2} />
                            )}
                            {PAYMENT_STATUS_LABEL[next]}
                          </button>
                        ))}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
