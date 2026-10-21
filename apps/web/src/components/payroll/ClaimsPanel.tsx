'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Check, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import {
  ExpenseClaimStatus,
  type CreateExpenseClaimDto,
  type ExpenseClaim,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useOrganisation } from '@/lib/useOrganisation';
import { formatMinorUnits, toMinorUnits } from '@/lib/money';
import { fetchAllWorkers, isSelectableWorker, workerDisplayName } from '@/lib/workers';
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE, formatDate, messageFrom } from './payroll-ui';
import styles from './payroll.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const STATUS_FILTERS: (ExpenseClaimStatus | 'ALL')[] = [
  'ALL',
  ExpenseClaimStatus.SUBMITTED,
  ExpenseClaimStatus.MANAGER_APPROVED,
  ExpenseClaimStatus.FINANCE_APPROVED,
  ExpenseClaimStatus.PAID,
  ExpenseClaimStatus.MANAGER_REJECTED,
  ExpenseClaimStatus.FINANCE_REJECTED,
  ExpenseClaimStatus.CANCELLED,
];

export default function ClaimsPanel({
  canSubmit,
  canReview,
  selfService,
}: {
  canSubmit: boolean;
  canReview: boolean;
  selfService: boolean;
}) {
  const { user } = useCurrentUser();
  const { organisation } = useOrganisation();
  const currency = organisation?.currency ?? 'NGN';

  const [state, setState] = useState<LoadState>('loading');
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<ExpenseClaimStatus | 'ALL'>('ALL');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [creating, setCreating] = useState(false);

  const role = user?.role ?? '';
  const isOrgReviewer = role === 'OWNER' || role === 'PAYROLL_ADMINISTRATOR' || role === 'FINANCE_APPROVER';
  const isManagerReviewer = role === 'MANAGER';

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const params: Record<string, string | number> = { pageSize: 200 };
      if (statusFilter !== 'ALL') params['status'] = statusFilter;
      const { data } = await api.get<{ data: ExpenseClaim[] }>('/expense-claims', {
        params,
      });
      setClaims(data.data);
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'forbidden'
          : 'error',
      );
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetchAllWorkers()
      .then((rows) => setWorkers(rows))
      .catch(() => setWorkers([]));
  }, []);

  const workerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers) map.set(w.id, workerDisplayName(w));
    return map;
  }, [workers]);

  const selfWorker = useMemo(
    () => workers.find((w) => w.userId === user?.sub) ?? null,
    [workers, user?.sub],
  );

  async function decide(
    claim: ExpenseClaim,
    step: 'manager' | 'finance',
    decision: 'APPROVE' | 'REJECT',
  ) {
    const comment =
      decision === 'REJECT'
        ? window.prompt('Reason for rejection?') ?? undefined
        : undefined;
    if (decision === 'REJECT' && !comment) return;
    setBusyId(claim.id);
    setError('');
    setNotice('');
    try {
      await api.post(`/expense-claims/${claim.id}/${step}-decision`, {
        decision,
        comment,
      });
      setNotice(`Claim ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not record the decision.'));
    } finally {
      setBusyId('');
    }
  }

  async function cancel(claim: ExpenseClaim) {
    if (!window.confirm('Cancel this reimbursement claim?')) return;
    setBusyId(claim.id);
    setError('');
    try {
      await api.post(`/expense-claims/${claim.id}/cancel`, {});
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not cancel the claim.'));
    } finally {
      setBusyId('');
    }
  }

  function canManagerDecide(claim: ExpenseClaim): boolean {
    return (
      claim.status === ExpenseClaimStatus.SUBMITTED &&
      canReview &&
      (isOrgReviewer || (isManagerReviewer && claim.workerId !== selfWorker?.id))
    );
  }

  function canFinanceDecide(claim: ExpenseClaim): boolean {
    return (
      claim.status === ExpenseClaimStatus.MANAGER_APPROVED &&
      (isOrgReviewer || role === 'FINANCE_APPROVER')
    );
  }

  function canCancel(claim: ExpenseClaim): boolean {
    const open = [
      ExpenseClaimStatus.SUBMITTED,
      ExpenseClaimStatus.MANAGER_APPROVED,
      ExpenseClaimStatus.FINANCE_APPROVED,
    ].includes(claim.status);
    return open && (isOrgReviewer || claim.workerId === selfWorker?.id);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <label className={styles.field}>
            <span className={styles.label}>Status</span>
            <select
              className={styles.select}
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.currentTarget.value as ExpenseClaimStatus | 'ALL')
              }
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === 'ALL' ? 'All statuses' : CLAIM_STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => void load()}>
            <RefreshCw size={15} strokeWidth={2} /> Refresh
          </button>
          {canSubmit && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setCreating(true)}
            >
              <Plus size={16} strokeWidth={2.2} /> New claim
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
          <Loader2 className={styles.spin} size={16} /> Loading reimbursements…
        </div>
      ) : state === 'forbidden' ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Reimbursements are restricted</p>
          <p className={styles.muted}>Your role cannot view expense claims.</p>
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the reimbursements.</p>
        </div>
      ) : claims.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>No reimbursements</p>
          <p className={styles.muted}>
            {canSubmit
              ? 'Submit an expense claim to get reimbursed in the next run.'
              : 'No expense claims match this filter.'}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList}>
          {claims.map((claim) => (
            <li key={claim.id} className={`glass ${styles.panelItem}`}>
              <span className={styles.panelItemBody}>
                <span className={styles.panelName}>
                  {formatMinorUnits(claim.amountMinorUnits, claim.currency)} · {claim.type}
                </span>
                <span className={styles.panelMeta}>
                  {workerName.get(claim.workerId) ?? claim.workerId.slice(0, 8)} ·{' '}
                  {claim.description}
                </span>
                <span className={styles.badges}>
                  <span
                    className={`${styles.badge} ${
                      styles[CLAIM_STATUS_TONE[claim.status] as keyof typeof styles] ?? ''
                    }`}
                  >
                    {CLAIM_STATUS_LABEL[claim.status]}
                  </span>
                  <span className={styles.muted}>raised {formatDate(claim.createdAt)}</span>
                </span>
              </span>
              <span className={styles.panelActions}>
                {canManagerDecide(claim) && (
                  <>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => void decide(claim, 'manager', 'APPROVE')}
                      disabled={busyId === claim.id}
                    >
                      {busyId === claim.id ? <Loader2 className={styles.spin} size={14} /> : <Check size={14} />}
                      Manager approve
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger}`}
                      onClick={() => void decide(claim, 'manager', 'REJECT')}
                      disabled={busyId === claim.id}
                    >
                      <X size={14} /> Reject
                    </button>
                  </>
                )}
                {canFinanceDecide(claim) && (
                  <>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => void decide(claim, 'finance', 'APPROVE')}
                      disabled={busyId === claim.id}
                    >
                      {busyId === claim.id ? <Loader2 className={styles.spin} size={14} /> : <Check size={14} />}
                      Finance approve
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger}`}
                      onClick={() => void decide(claim, 'finance', 'REJECT')}
                      disabled={busyId === claim.id}
                    >
                      <X size={14} /> Reject
                    </button>
                  </>
                )}
                {canCancel(claim) && (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={() => void cancel(claim)}
                    disabled={busyId === claim.id}
                  >
                    Cancel
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <ClaimDrawer
          currency={currency}
          workers={workers.filter(isSelectableWorker)}
          selfWorkerId={selfWorker?.id ?? null}
          selfService={selfService}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── New claim drawer ─────────────────────────────────────────────────────────

function ClaimDrawer({
  currency,
  workers,
  selfWorkerId,
  selfService,
  onClose,
  onSaved,
}: {
  currency: string;
  workers: WorkerSummary[];
  selfWorkerId: string | null;
  selfService: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [workerId, setWorkerId] = useState(selfService ? selfWorkerId ?? '' : '');
  const [type, setType] = useState('Travel');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    const targetWorker = selfService ? selfWorkerId ?? '' : workerId;
    if (!targetWorker) {
      setError('Choose who this reimbursement is for.');
      return;
    }
    if (!type.trim() || !description.trim()) {
      setError('A category and description are required.');
      return;
    }
    const minor = toMinorUnits(amount);
    if (minor === null || minor <= 0) {
      setError('Enter a valid positive amount, e.g. 45000 or 45000.50');
      return;
    }
    const payload: CreateExpenseClaimDto = {
      workerId: targetWorker,
      type: type.trim(),
      description: description.trim(),
      amountMinorUnits: minor,
      receiptUrl: receiptUrl.trim() || null,
    };
    setBusy(true);
    setError('');
    try {
      await api.post('/expense-claims', payload);
      onSaved();
    } catch (err) {
      setError(messageFrom(err, 'Could not submit the claim.'));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="New reimbursement">
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>New reimbursement</p>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.drawerBody}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.grid}>
            {!selfService && (
              <div className={`${styles.gridItem} ${styles.gridFull}`}>
                <label className={styles.label} htmlFor="claim-worker">
                  Who is this for
                </label>
                <select
                  id="claim-worker"
                  className={styles.select}
                  value={workerId}
                  onChange={(e) => setWorkerId(e.currentTarget.value)}
                >
                  <option value="">Select a person…</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {workerDisplayName(w)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="claim-type">
                Category
              </label>
              <input
                id="claim-type"
                className={styles.input}
                placeholder="Travel"
                value={type}
                onChange={(e) => setType(e.currentTarget.value)}
              />
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="claim-amount">
                Amount ({currency})
              </label>
              <input
                id="claim-amount"
                className={styles.input}
                inputMode="decimal"
                placeholder="45000.00"
                value={amount}
                onChange={(e) => setAmount(e.currentTarget.value)}
              />
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="claim-desc">
                Description
              </label>
              <textarea
                id="claim-desc"
                className={styles.textarea}
                rows={2}
                placeholder="Client visit — taxi and lunch"
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
              />
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="claim-receipt">
                Receipt URL (optional)
              </label>
              <input
                id="claim-receipt"
                className={styles.input}
                placeholder="https://…"
                value={receiptUrl}
                onChange={(e) => setReceiptUrl(e.currentTarget.value)}
              />
            </div>
          </div>
        </div>
        <div className={styles.drawerActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit} disabled={busy}>
            {busy ? <Loader2 className={styles.spin} size={16} /> : <Plus size={16} strokeWidth={2.2} />}
            Submit claim
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
