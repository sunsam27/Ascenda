'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Check, Download, Loader2, PackagePlus, RefreshCw, X } from 'lucide-react';
import {
  PaymentBatchStatus,
  PaymentStatus,
  type Payment,
  type PaymentBatch,
  type PayrollRun,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { formatMinorUnits } from '@/lib/money';
import {
  PAYMENT_BATCH_STATUS_LABEL,
  PAYMENT_BATCH_STATUS_TONE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  formatRange,
  messageFrom,
} from './payroll-ui';
import StepUpDialog from './StepUpDialog';
import styles from './payroll.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const STATUS_FILTERS: (PaymentStatus | 'ALL')[] = [
  'ALL',
  PaymentStatus.PENDING,
  PaymentStatus.APPROVED,
  PaymentStatus.PROCESSING,
  PaymentStatus.PAID,
  PaymentStatus.CANCELLED,
  PaymentStatus.COMPLETED,
  PaymentStatus.FAILED,
  PaymentStatus.REVERSED,
];

/** Allowed next statuses per current status (mirrors the API matrix). */
const NEXT_STATUSES: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.APPROVED,
    PaymentStatus.PROCESSING,
    PaymentStatus.CANCELLED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.APPROVED]: [
    PaymentStatus.PROCESSING,
    PaymentStatus.PAID,
    PaymentStatus.CANCELLED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.PROCESSING]: [
    PaymentStatus.PAID,
    PaymentStatus.CANCELLED,
    PaymentStatus.FAILED,
    PaymentStatus.REVERSED,
  ],
  [PaymentStatus.PAID]: [PaymentStatus.REVERSED],
  [PaymentStatus.COMPLETED]: [PaymentStatus.REVERSED],
  [PaymentStatus.FAILED]: [
    PaymentStatus.APPROVED,
    PaymentStatus.PROCESSING,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.REVERSED]: [],
};

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function PaymentsPanel({
  canManage,
  canApprove,
  canExport,
}: {
  canManage: boolean;
  canApprove: boolean;
  canExport: boolean;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [runFilter, setRunFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | 'ALL'>('ALL');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [batchBusy, setBatchBusy] = useState('');
  const [exporting, setExporting] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    label: string;
    description: string;
    run: (token: string) => Promise<void>;
  } | null>(null);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const params: Record<string, string | number> = { pageSize: 200 };
      if (runFilter) params['payrollRunId'] = runFilter;
      if (statusFilter !== 'ALL') params['status'] = statusFilter;
      const [paymentsRes, batchesRes] = await Promise.all([
        api.get<{ data: Payment[] }>('/payments', { params }),
        api.get<{ data: PaymentBatch[] }>('/payments/batches', {
          params: {
            pageSize: 100,
            ...(runFilter ? { payrollRunId: runFilter } : {}),
          },
        }),
      ]);
      setPayments(paymentsRes.data.data);
      setBatches(batchesRes.data.data);
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
    if (
      status === PaymentStatus.FAILED ||
      status === PaymentStatus.REVERSED ||
      status === PaymentStatus.CANCELLED
    ) {
      const input = window.prompt(
        `Reason for marking this payment ${status.toLowerCase()}?`,
      );
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

  async function createBatch() {
    if (!runFilter) {
      setError('Select a payroll run first.');
      return;
    }
    setCreatingBatch(true);
    setError('');
    setNotice('');
    try {
      await api.post('/payments/batches', { payrollRunId: runFilter });
      setNotice('Draft payment batch created.');
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not create the payment batch.'));
    } finally {
      setCreatingBatch(false);
    }
  }

  async function approveBatch(batch: PaymentBatch, token: string) {
    setBatchBusy(batch.id);
    setError('');
    try {
      await api.post(`/payments/batches/${batch.id}/approve`, undefined, {
        headers: { 'x-step-up-token': token },
      });
      setNotice(`${batch.reference} approved.`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not approve the payment batch.'));
    } finally {
      setBatchBusy('');
    }
  }

  async function payBatch(batch: PaymentBatch, token: string) {
    setBatchBusy(batch.id);
    setError('');
    try {
      await api.post(`/payments/batches/${batch.id}/pay`, undefined, {
        headers: { 'x-step-up-token': token },
      });
      setNotice(`${batch.reference} marked paid.`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not mark the payment batch paid.'));
    } finally {
      setBatchBusy('');
    }
  }

  async function cancelBatch(batch: PaymentBatch, token: string) {
    const reason = window.prompt(
      `Reason for cancelling ${batch.reference}?`,
    );
    if (!reason) return;
    setBatchBusy(batch.id);
    setError('');
    try {
      await api.post(
        `/payments/batches/${batch.id}/cancel`,
        { reason },
        { headers: { 'x-step-up-token': token } },
      );
      setNotice(`${batch.reference} cancelled.`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not cancel the payment batch.'));
    } finally {
      setBatchBusy('');
    }
  }

  async function exportBatch(batch: PaymentBatch, token: string) {
    setBatchBusy(batch.id);
    setError('');
    try {
      const res = await api.get(`/payments/batches/${batch.id}/export`, {
        headers: { 'x-step-up-token': token },
        responseType: 'blob',
      });
      download(res.data as Blob, `payments-${batch.reference}.csv`);
      setNotice(`${batch.reference} exported.`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not export the payment batch.'));
    } finally {
      setBatchBusy('');
    }
  }

  async function exportCsv(token: string) {
    setExporting(true);
    setError('');
    try {
      const params: Record<string, string> = { format: 'CSV' };
      if (runFilter) params['payrollRunId'] = runFilter;
      if (statusFilter !== 'ALL') params['status'] = statusFilter;
      const res = await api.get('/payments/export', {
        params,
        headers: { 'x-step-up-token': token },
        responseType: 'blob',
      });
      download(
        res.data as Blob,
        `payments-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      setNotice('Payment file exported.');
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
              onChange={(e) =>
                setStatusFilter(e.currentTarget.value as PaymentStatus | 'ALL')
              }
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
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => void load()}
          >
            <RefreshCw size={15} strokeWidth={2} /> Refresh
          </button>
          {canManage && (
            <button
              type="button"
              className={styles.btn}
              onClick={() => void createBatch()}
              disabled={creatingBatch || !runFilter}
              title={!runFilter ? 'Select a payroll run first' : undefined}
            >
              {creatingBatch ? (
                <Loader2 className={styles.spin} size={15} />
              ) : (
                <PackagePlus size={15} strokeWidth={2.2} />
              )}
              Create batch
            </button>
          )}
          {canExport && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() =>
                setPendingAction({
                  label: 'Export payment file',
                  description:
                    'Re-enter your password to export payroll bank details. This is audited.',
                  run: exportCsv,
                })
              }
              disabled={exporting || payments.length === 0}
            >
              {exporting ? (
                <Loader2 className={styles.spin} size={15} />
              ) : (
                <Download size={15} strokeWidth={2.2} />
              )}
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
      ) : (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h3 className={styles.sectionTitle}>Payment batches</h3>
              <p className={styles.muted}>
                Approve a batch, export the bank file, then mark it paid.
              </p>
            </div>
          </div>

          {batches.length === 0 ? (
            <div className={`glass ${styles.message}`}>
              <p className={styles.messageTitle}>No payment batches</p>
              <p className={styles.muted}>
                Select a run and create a batch from its pending payments.
              </p>
            </div>
          ) : (
            <div className={`glass ${styles.tableWrap}`}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Label</th>
                    <th>Status</th>
                    <th className={styles.num}>Payments</th>
                    <th className={styles.num}>Total</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id}>
                      <td>{batch.reference}</td>
                      <td>{batch.label}</td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            styles[
                              PAYMENT_BATCH_STATUS_TONE[batch.status] as keyof typeof styles
                            ] ?? ''
                          }`}
                        >
                          {PAYMENT_BATCH_STATUS_LABEL[batch.status]}
                        </span>
                      </td>
                      <td className={styles.num}>{batch.paymentCount}</td>
                      <td className={`${styles.num} ${styles.numStrong}`}>
                        {formatMinorUnits(batch.totalMinorUnits, batch.currency)}
                      </td>
                      <td className={styles.tableRowActions}>
                        {batch.status === PaymentBatchStatus.DRAFT && canApprove && (
                          <button
                            type="button"
                            className={styles.btn}
                            disabled={batchBusy === batch.id}
                            onClick={() =>
                              setPendingAction({
                                label: `Approve ${batch.reference}`,
                                description:
                                  'Approving a payment batch releases funds for export. This is audited.',
                                run: (token) => approveBatch(batch, token),
                              })
                            }
                          >
                            <Check size={14} strokeWidth={2.2} /> Approve
                          </button>
                        )}
                        {batch.status === PaymentBatchStatus.APPROVED && canExport && (
                          <button
                            type="button"
                            className={styles.btn}
                            disabled={batchBusy === batch.id}
                            onClick={() =>
                              setPendingAction({
                                label: `Export ${batch.reference}`,
                                description:
                                  'Re-enter your password to export full bank account details. This is audited and watermarked.',
                                run: (token) => exportBatch(batch, token),
                              })
                            }
                          >
                            <Download size={14} strokeWidth={2.2} /> Export
                          </button>
                        )}
                        {batch.status === PaymentBatchStatus.APPROVED && canApprove && (
                          <button
                            type="button"
                            className={styles.btn}
                            disabled={batchBusy === batch.id}
                            onClick={() =>
                              setPendingAction({
                                label: `Mark ${batch.reference} paid`,
                                description:
                                  'This marks every payment in the batch as paid. This is audited.',
                                run: (token) => payBatch(batch, token),
                              })
                            }
                          >
                            <Check size={14} strokeWidth={2.2} /> Mark paid
                          </button>
                        )}
                        {(batch.status === PaymentBatchStatus.DRAFT ||
                          batch.status === PaymentBatchStatus.APPROVED) &&
                          canApprove && (
                            <button
                              type="button"
                              className={styles.btn}
                              disabled={batchBusy === batch.id}
                              onClick={() =>
                                setPendingAction({
                                  label: `Cancel ${batch.reference}`,
                                  description:
                                    'Cancelling releases unpaid payments from this batch. This is audited.',
                                  run: (token) => cancelBatch(batch, token),
                                })
                              }
                            >
                              <X size={14} strokeWidth={2.2} /> Cancel
                            </button>
                          )}
                        {batchBusy === batch.id && (
                          <Loader2 className={styles.spin} size={14} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
              <span className={styles.statLabel}>Paid</span>
              <span className={styles.statValue}>
                {
                  payments.filter(
                    (p) =>
                      p.status === PaymentStatus.PAID ||
                      p.status === PaymentStatus.COMPLETED,
                  ).length
                }
              </span>
            </div>
          </div>

          {payments.length === 0 ? (
            <div className={`glass ${styles.message}`}>
              <p className={styles.messageTitle}>No payments</p>
              <p className={styles.muted}>
                Payments are created when an approved run is processed.
              </p>
            </div>
          ) : (
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
                        {formatMinorUnits(
                          payment.amountMinorUnits,
                          payment.currency,
                        )}
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${
                            styles[
                              PAYMENT_STATUS_TONE[payment.status] as keyof typeof styles
                            ] ?? ''
                          }`}
                        >
                          {PAYMENT_STATUS_LABEL[payment.status]}
                        </span>
                      </td>
                      {canManage && (
                        <td className={styles.tableRowActions}>
                          {payment.paymentBatchId ? (
                            <span className={styles.muted}>In batch</span>
                          ) : (
                            NEXT_STATUSES[payment.status].map((next) => (
                              <button
                                key={next}
                                type="button"
                                className={styles.btn}
                                onClick={() => void move(payment, next)}
                                disabled={busyId === payment.id}
                              >
                                {busyId === payment.id ? (
                                  <Loader2
                                    className={styles.spin}
                                    size={14}
                                  />
                                ) : next === PaymentStatus.FAILED ||
                                  next === PaymentStatus.REVERSED ||
                                  next === PaymentStatus.CANCELLED ? (
                                  <X size={14} strokeWidth={2.2} />
                                ) : (
                                  <Check size={14} strokeWidth={2.2} />
                                )}
                                {PAYMENT_STATUS_LABEL[next]}
                              </button>
                            ))
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <StepUpDialog
        open={pendingAction !== null}
        title={pendingAction?.label ?? 'Confirm it is you'}
        description={pendingAction?.description}
        confirmLabel="Confirm"
        onCancel={() => setPendingAction(null)}
        onVerified={async (token) => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) await action.run(token);
        }}
      />
    </div>
  );
}
