'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Check,
  Download,
  Loader2,
  PackagePlus,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import {
  PaymentBatchStatus,
  PaymentStatus,
  PayoutAccountMode,
  PayoutAccountStatus,
  PayoutProvider,
  PayoutStatus,
  type Payment,
  type PaymentBatch,
  type PayoutAccountSummary,
  type PayoutBatchResult,
  type PayoutOption,
  type PayrollRun,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { formatMinorUnits } from '@/lib/money';
import {
  PAYMENT_BATCH_STATUS_LABEL,
  PAYMENT_BATCH_STATUS_TONE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_TONE,
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
  canConfigurePayout = false,
}: {
  canManage: boolean;
  canApprove: boolean;
  canExport: boolean;
  canConfigurePayout?: boolean;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [payoutAccount, setPayoutAccount] =
    useState<PayoutAccountSummary | null>(null);
  const [payoutOptions, setPayoutOptions] = useState<PayoutOption[]>([]);
  const [payoutFormOpen, setPayoutFormOpen] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutView, setPayoutView] = useState<PayoutBatchResult | null>(null);
  const [payoutForm, setPayoutForm] = useState({
    provider: PayoutProvider.PAYSTACK,
    mode: PayoutAccountMode.TEST,
    country: 'NG',
    currency: 'NGN',
    accountName: '',
    secretKey: '',
    webhookSecret: '',
  });
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
      const [paymentsRes, batchesRes, accountRes, optionsRes] =
        await Promise.all([
          api.get<{ data: Payment[] }>('/payments', { params }),
          api.get<{ data: PaymentBatch[] }>('/payments/batches', {
            params: {
              pageSize: 100,
              ...(runFilter ? { payrollRunId: runFilter } : {}),
            },
          }),
          api.get<{ account: PayoutAccountSummary | null }>(
            '/payments/payout-account',
          ),
          api.get<PayoutOption[]>('/payments/payout-options'),
        ]);
      setPayments(paymentsRes.data.data);
      setBatches(batchesRes.data.data);
      setPayoutAccount(accountRes.data.account);
      setPayoutOptions(optionsRes.data);
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
    if (
      !batches.some(
        (batch) => batch.status === PaymentBatchStatus.PROCESSING,
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [batches, load]);

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

  function openPayoutForm() {
    const provider = payoutAccount?.provider ?? PayoutProvider.PAYSTACK;
    const currencies =
      payoutOptions.find((option) => option.provider === provider)
        ?.currencies ?? ['NGN'];
    setPayoutForm({
      provider,
      mode: payoutAccount?.mode ?? PayoutAccountMode.TEST,
      country: payoutAccount?.country ?? 'NG',
      currency: payoutAccount?.currency ?? currencies[0] ?? 'NGN',
      accountName: payoutAccount?.accountName ?? '',
      secretKey: '',
      webhookSecret: '',
    });
    setPayoutFormOpen(true);
  }

  async function savePayoutAccount(token: string) {
    setPayoutBusy(true);
    setError('');
    try {
      const res = await api.put<PayoutAccountSummary>(
        '/payments/payout-account',
        {
          provider: payoutForm.provider,
          mode: payoutForm.mode,
          country: payoutForm.country,
          currency: payoutForm.currency,
          accountName: payoutForm.accountName || undefined,
          secretKey: payoutForm.secretKey,
          webhookSecret: payoutForm.webhookSecret || undefined,
        },
        { headers: { 'x-step-up-token': token } },
      );
      setPayoutAccount(res.data);
      setPayoutFormOpen(false);
      setNotice('Payout account saved and verified.');
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not save the payout account.'));
    } finally {
      setPayoutBusy(false);
    }
  }

  async function refreshPayoutBalance() {
    setPayoutBusy(true);
    setError('');
    try {
      const res = await api.post<PayoutAccountSummary>(
        '/payments/payout-account/balance',
      );
      setPayoutAccount(res.data);
      setNotice('Payout balance refreshed.');
    } catch (err) {
      setError(messageFrom(err, 'Could not refresh the payout balance.'));
    } finally {
      setPayoutBusy(false);
    }
  }

  async function disconnectPayoutAccount(token: string) {
    setPayoutBusy(true);
    setError('');
    try {
      await api.delete('/payments/payout-account', {
        headers: { 'x-step-up-token': token },
      });
      setPayoutAccount(null);
      setPayoutView(null);
      setNotice('Payout account disconnected.');
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not disconnect the payout account.'));
    } finally {
      setPayoutBusy(false);
    }
  }

  async function initiatePayout(batch: PaymentBatch, token: string) {
    setBatchBusy(batch.id);
    setError('');
    try {
      const res = await api.post<PayoutBatchResult>(
        `/payments/batches/${batch.id}/payout`,
        undefined,
        { headers: { 'x-step-up-token': token } },
      );
      setPayoutView(res.data);
      setNotice(res.data.message);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not start the payout.'));
    } finally {
      setBatchBusy('');
    }
  }

  async function viewPayouts(batch: PaymentBatch) {
    setBatchBusy(batch.id);
    setError('');
    try {
      const res = await api.get<PayoutBatchResult>(
        `/payments/batches/${batch.id}/payouts`,
      );
      setPayoutView(res.data);
    } catch (err) {
      setError(messageFrom(err, 'Could not load the batch payouts.'));
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
  const providerLabel = (provider: PayoutProvider) =>
    payoutOptions.find((option) => option.provider === provider)?.label ??
    provider;
  const payoutFormCurrencies =
    payoutOptions.find((option) => option.provider === payoutForm.provider)
      ?.currencies ?? [];
  const canPayWithProvider = (batch: PaymentBatch) =>
    Boolean(
      payoutAccount &&
        payoutAccount.status === PayoutAccountStatus.ACTIVE &&
        payoutAccount.currency === batch.currency &&
        payoutOptions
          .find((option) => option.provider === payoutAccount.provider)
          ?.currencies.includes(batch.currency),
    );

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
              <h3 className={styles.sectionTitle}>Payout account</h3>
              <p className={styles.muted}>
                Pay workers from your organisation&apos;s own Paystack or
                Flutterwave balance. Ascenda never holds the funds.
              </p>
            </div>
            {canConfigurePayout && !payoutFormOpen && (
              <button
                type="button"
                className={styles.btn}
                onClick={openPayoutForm}
                disabled={payoutBusy}
              >
                <Wallet size={15} strokeWidth={2.2} />
                {payoutAccount ? 'Replace account' : 'Connect account'}
              </button>
            )}
          </div>

          {payoutAccount ? (
            <div className={`glass ${styles.panelItem}`}>
              <div className={styles.panelItemBody}>
                <span className={styles.panelName}>
                  {providerLabel(payoutAccount.provider)} ·{' '}
                  {payoutAccount.currency} · {payoutAccount.mode.toLowerCase()}
                </span>
                <span className={styles.panelMeta}>
                  Key ••••{payoutAccount.keyLast4}
                  {payoutAccount.accountName
                    ? ` · ${payoutAccount.accountName}`
                    : ''}
                  {payoutAccount.balanceMinorUnits !== undefined
                    ? ` · Available ${formatMinorUnits(
                        payoutAccount.balanceMinorUnits,
                        payoutAccount.balanceCurrency ??
                          payoutAccount.currency,
                      )}`
                    : ' · Balance not checked'}
                </span>
                {payoutAccount.provider === PayoutProvider.FLUTTERWAVE && (
                  <span className={styles.panelMeta}>
                    Webhook: {payoutAccount.webhookUrl}
                  </span>
                )}
                {payoutAccount.status !== PayoutAccountStatus.ACTIVE && (
                  <span className={styles.panelMeta}>
                    Disconnected. Replace the account to pay again.
                  </span>
                )}
              </div>
              <div className={styles.panelActions}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => void refreshPayoutBalance()}
                  disabled={payoutBusy}
                >
                  <RefreshCw size={14} strokeWidth={2.2} /> Refresh balance
                </button>
                {canConfigurePayout && (
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() =>
                      setPendingAction({
                        label: 'Disconnect payout account',
                        description:
                          'This stops new provider payouts. In-flight payouts must finish first. This is audited.',
                        run: disconnectPayoutAccount,
                      })
                    }
                    disabled={payoutBusy}
                  >
                    <X size={14} strokeWidth={2.2} /> Disconnect
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className={`glass ${styles.message}`}>
              <p className={styles.messageTitle}>No payout account</p>
              <p className={styles.muted}>
                {canConfigurePayout
                  ? 'Connect a provider test key first, then switch to live when you are ready.'
                  : 'Ask the workspace owner to connect a payout account. You can still export a bank file.'}
              </p>
            </div>
          )}

          {payoutFormOpen && canConfigurePayout && (
            <div className={`glass ${styles.payoutForm}`}>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span className={styles.label}>Provider</span>
                  <select
                    className={styles.select}
                    value={payoutForm.provider}
                    onChange={(e) => {
                      const provider = e.currentTarget
                        .value as PayoutProvider;
                      const currencies =
                        payoutOptions.find(
                          (option) => option.provider === provider,
                        )?.currencies ?? [];
                      setPayoutForm((form) => ({
                        ...form,
                        provider,
                        currency: currencies[0] ?? form.currency,
                      }));
                    }}
                  >
                    {payoutOptions.map((option) => (
                      <option key={option.provider} value={option.provider}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Mode</span>
                  <select
                    className={styles.select}
                    value={payoutForm.mode}
                    onChange={(e) =>
                      setPayoutForm((form) => ({
                        ...form,
                        mode: e.currentTarget.value as PayoutAccountMode,
                      }))
                    }
                  >
                    <option value={PayoutAccountMode.TEST}>Test</option>
                    <option value={PayoutAccountMode.LIVE}>Live</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Country</span>
                  <input
                    className={styles.input}
                    value={payoutForm.country}
                    maxLength={2}
                    onChange={(e) =>
                      setPayoutForm((form) => ({
                        ...form,
                        country: e.currentTarget.value.toUpperCase(),
                      }))
                    }
                    placeholder="NG"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Currency</span>
                  <select
                    className={styles.select}
                    value={payoutForm.currency}
                    onChange={(e) =>
                      setPayoutForm((form) => ({
                        ...form,
                        currency: e.currentTarget.value,
                      }))
                    }
                  >
                    {payoutFormCurrencies.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Account label (optional)</span>
                  <input
                    className={styles.input}
                    value={payoutForm.accountName}
                    onChange={(e) =>
                      setPayoutForm((form) => ({
                        ...form,
                        accountName: e.currentTarget.value,
                      }))
                    }
                    placeholder="Main payroll wallet"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>Secret key</span>
                  <input
                    className={styles.input}
                    type="password"
                    autoComplete="off"
                    value={payoutForm.secretKey}
                    onChange={(e) =>
                      setPayoutForm((form) => ({
                        ...form,
                        secretKey: e.currentTarget.value,
                      }))
                    }
                    placeholder={
                      payoutForm.provider === PayoutProvider.PAYSTACK
                        ? 'sk_test_… or sk_live_…'
                        : 'FLWSECK_TEST-… or FLWSECK-…'
                    }
                  />
                </label>
                {payoutForm.provider === PayoutProvider.FLUTTERWAVE && (
                  <label className={`${styles.field} ${styles.fieldFull}`}>
                    <span className={styles.label}>Webhook secret hash</span>
                    <input
                      className={styles.input}
                      type="password"
                      autoComplete="off"
                      value={payoutForm.webhookSecret}
                      onChange={(e) =>
                        setPayoutForm((form) => ({
                          ...form,
                          webhookSecret: e.currentTarget.value,
                        }))
                      }
                      placeholder="Required for Flutterwave"
                    />
                    <span className={styles.formHint}>
                      Keep the existing hash by leaving this blank when
                      replacing the same Flutterwave account.
                    </span>
                  </label>
                )}
              </div>
              <p className={styles.formHint}>
                The key is verified against the provider balance before it is
                saved. Use a test key in test mode; live transfers are real.
              </p>
              <div className={styles.payoutFormActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => setPayoutFormOpen(false)}
                  disabled={payoutBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={payoutBusy || !payoutForm.secretKey}
                  onClick={() =>
                    setPendingAction({
                      label: 'Save payout account',
                      description:
                        'Re-enter your password to store the provider key. This is audited.',
                      run: savePayoutAccount,
                    })
                  }
                >
                  {payoutBusy ? (
                    <Loader2 className={styles.spin} size={15} />
                  ) : (
                    <Check size={15} strokeWidth={2.2} />
                  )}
                  Verify and save
                </button>
              </div>
            </div>
          )}

          <div className={styles.sectionHeader}>
            <div>
              <h3 className={styles.sectionTitle}>Payment batches</h3>
              <p className={styles.muted}>
                Approve a batch, then pay it in-platform or export the bank
                file and mark it paid.
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
                        {batch.status === PaymentBatchStatus.APPROVED &&
                          canApprove &&
                          canPayWithProvider(batch) && (
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.btnPrimary}`}
                              disabled={batchBusy === batch.id}
                              onClick={() =>
                                setPendingAction({
                                  label: `Pay ${batch.reference} in-platform`,
                                  description: `Send ${batch.paymentCount} transfers from your ${providerLabel(
                                    payoutAccount!.provider,
                                  )} balance. This moves real money and is audited.`,
                                  run: (token) => initiatePayout(batch, token),
                                })
                              }
                            >
                              <Wallet size={14} strokeWidth={2.2} /> Pay
                              in-platform
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
                                  'Use this after paying through your bank. It marks every payment in the batch as paid. This is audited.',
                                run: (token) => payBatch(batch, token),
                              })
                            }
                          >
                            <Check size={14} strokeWidth={2.2} /> Mark paid
                          </button>
                        )}
                        {batch.status !== PaymentBatchStatus.DRAFT &&
                          batch.status !== PaymentBatchStatus.CANCELLED && (
                            <button
                              type="button"
                              className={styles.btn}
                              disabled={batchBusy === batch.id}
                              onClick={() => void viewPayouts(batch)}
                            >
                              View payouts
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

          {payoutView && (
            <div className="glass">
              <div className={styles.groupHead}>
                <div>
                  <h3 className={styles.sectionTitle}>
                    Payouts · {payoutView.batch.reference}
                  </h3>
                  <p className={styles.muted}>{payoutView.message}</p>
                </div>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => setPayoutView(null)}
                >
                  <X size={14} strokeWidth={2.2} /> Close
                </button>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Recipient</th>
                      <th className={styles.num}>Amount</th>
                      <th>Status</th>
                      <th>Failure reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutView.payouts.map((payout) => (
                      <tr key={payout.id}>
                        <td>{payout.reference}</td>
                        <td>
                          {payout.recipientName ??
                            payout.accountNumberMasked ??
                            payout.workerId.slice(0, 8)}
                        </td>
                        <td className={`${styles.num} ${styles.numStrong}`}>
                          {formatMinorUnits(
                            payout.amountMinorUnits,
                            payout.currency,
                          )}
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${
                              styles[
                                PAYOUT_STATUS_TONE[
                                  payout.status
                                ] as keyof typeof styles
                              ] ?? ''
                            }`}
                          >
                            {PAYOUT_STATUS_LABEL[payout.status]}
                          </span>
                        </td>
                        <td>{payout.failureReason ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
