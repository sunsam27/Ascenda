'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  PayrollItemType,
  PayrollRunStatus,
  type PayCalendar,
  type PayCalendarPeriod,
  type PayrollItem,
  type PayrollRun,
  type PayrollRunApproval,
  type RunValidationResult,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { formatMinorUnits } from '@/lib/money';
import { fetchAllWorkers, workerDisplayName } from '@/lib/workers';
import {
  APPROVAL_STATUS_LABEL,
  ITEM_TYPE_LABEL,
  MANUAL_DEDUCTION_TYPES,
  MANUAL_ITEM_TYPE_OPTIONS,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  formatRange,
  messageFrom,
} from './payroll-ui';
import styles from './payroll.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

type RunDetail = PayrollRun & { approvals?: PayrollRunApproval[] };

const STATUS_FILTERS: (PayrollRunStatus | 'ALL')[] = [
  'ALL',
  PayrollRunStatus.DRAFT,
  PayrollRunStatus.IN_REVIEW,
  PayrollRunStatus.PENDING_APPROVAL,
  PayrollRunStatus.APPROVED,
  PayrollRunStatus.PROCESSED,
  PayrollRunStatus.LOCKED,
];

export default function RunsPanel({
  canManage,
  canApprove,
}: {
  canManage: boolean;
  canApprove: boolean;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [filter, setFilter] = useState<PayrollRunStatus | 'ALL'>('ALL');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const params: Record<string, string | number> = { pageSize: 100 };
      if (filter !== 'ALL') params['status'] = filter;
      const { data } = await api.get<{ data: PayrollRun[] }>('/payroll/runs', {
        params,
      });
      setRuns(data.data);
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'forbidden'
          : 'error',
      );
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  if (openId) {
    return (
      <RunDetailView
        runId={openId}
        canManage={canManage}
        canApprove={canApprove}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <label className={styles.field}>
            <span className={styles.label}>Status</span>
            <select
              className={styles.select}
              value={filter}
              onChange={(e) =>
                setFilter(e.currentTarget.value as PayrollRunStatus | 'ALL')
              }
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === 'ALL' ? 'All statuses' : RUN_STATUS_LABEL[value]}
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
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setCreating(true)}
            >
              <Plus size={16} strokeWidth={2.2} /> New pay run
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {state === 'loading' ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading pay runs…
        </div>
      ) : state === 'forbidden' ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Payroll is restricted</p>
          <p className={styles.muted}>
            Your role does not have permission to view pay runs.
          </p>
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the pay runs.</p>
        </div>
      ) : runs.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>No pay runs yet</p>
          <p className={styles.muted}>
            {canManage
              ? 'Create a run for a pay-calendar period to get started.'
              : 'No pay runs match this filter.'}
          </p>
        </div>
      ) : (
        <div className={`glass ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th className={styles.num}>Gross</th>
                <th className={styles.num}>Deductions</th>
                <th className={styles.num}>Net</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatRange(run.periodStart, run.periodEnd)}</td>
                  <td>
                    <span
                      className={`${styles.badge} ${
                        styles[RUN_STATUS_TONE[run.status] as keyof typeof styles] ?? ''
                      }`}
                    >
                      {RUN_STATUS_LABEL[run.status]}
                    </span>
                  </td>
                  <td className={styles.num}>
                    {formatMinorUnits(run.totalGrossMinorUnits, run.currency)}
                  </td>
                  <td className={styles.num}>
                    {formatMinorUnits(
                      run.totalDeductionsMinorUnits,
                      run.currency,
                    )}
                  </td>
                  <td className={`${styles.num} ${styles.numStrong}`}>
                    {formatMinorUnits(run.totalNetMinorUnits, run.currency)}
                  </td>
                  <td className={styles.tableRowActions}>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => setOpenId(run.id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateRunDrawer
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── Create run drawer ────────────────────────────────────────────────────────

function CreateRunDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [calendars, setCalendars] = useState<PayCalendar[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [periods, setPeriods] = useState<PayCalendarPeriod[]>([]);
  const [periodKey, setPeriodKey] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadingCalendars, setLoadingCalendars] = useState(true);

  useEffect(() => {
    api
      .get<{ data: PayCalendar[] }>('/payroll/pay-calendars', {
        params: { pageSize: 100 },
      })
      .then((res) => {
        const active = res.data.data.filter((c) => c.isActive);
        setCalendars(active);
        if (active[0]) setCalendarId(active[0].id);
      })
      .catch(() => setError('Could not load pay calendars.'))
      .finally(() => setLoadingCalendars(false));
  }, []);

  useEffect(() => {
    if (!calendarId) return;
    const year = new Date().getFullYear();
    api
      .get<{ data: PayCalendarPeriod[] }>(
        `/payroll/pay-calendars/${calendarId}/periods`,
        { params: { year } },
      )
      .then((res) => {
        setPeriods(res.data.data);
        // Default to the first period whose cut-off has not passed.
        const next = res.data.data.find((p) => !p.beforeCutOff) ?? res.data.data[0];
        setPeriodKey(next ? `${next.periodStart}|${next.periodEnd}` : '');
      })
      .catch(() => setPeriods([]));
  }, [calendarId]);

  const selected = useMemo(
    () => periods.find((p) => `${p.periodStart}|${p.periodEnd}` === periodKey) ?? null,
    [periods, periodKey],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit() {
    if (!calendarId || !selected) {
      setError('Choose a pay calendar and period.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post<{ data: PayrollRun }>('/payroll/runs', {
        payCalendarId: calendarId,
        periodStart: selected.periodStart,
        periodEnd: selected.periodEnd,
        notes: notes.trim() || undefined,
      });
      onCreated(data.data.id);
    } catch (err) {
      setError(messageFrom(err, 'Could not create the pay run.'));
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
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="New pay run">
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>New pay run</p>
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
          {!loadingCalendars && calendars.length === 0 && (
            <p className={styles.notice} role="status">
              No active pay calendars yet. Add one from the <strong>Calendars</strong>{' '}
              tab, then create the run.
            </p>
          )}
          <div className={styles.grid}>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="run-calendar">
                Pay calendar
              </label>
              <select
                id="run-calendar"
                className={styles.select}
                value={calendarId}
                onChange={(e) => setCalendarId(e.currentTarget.value)}
              >
                <option value="">Select a calendar…</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="run-period">
                Period
              </label>
              <select
                id="run-period"
                className={styles.select}
                value={periodKey}
                onChange={(e) => setPeriodKey(e.currentTarget.value)}
                disabled={periods.length === 0}
              >
                <option value="">Select a period…</option>
                {periods.map((p) => (
                  <option
                    key={`${p.periodStart}|${p.periodEnd}`}
                    value={`${p.periodStart}|${p.periodEnd}`}
                  >
                    {formatRange(p.periodStart, p.periodEnd)} · paid{' '}
                    {p.payDate.slice(0, 10)}
                    {p.beforeCutOff ? ' (before cut-off)' : ''}
                  </option>
                ))}
              </select>
              <span className={styles.formHint}>
                Runs must align to a generated period boundary.
              </span>
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="run-notes">
                Notes
              </label>
              <textarea
                id="run-notes"
                className={styles.textarea}
                rows={2}
                placeholder="Optional note for reviewers"
                value={notes}
                onChange={(e) => setNotes(e.currentTarget.value)}
              />
            </div>
          </div>
        </div>
        <div className={styles.drawerActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={submit}
            disabled={busy || !calendarId || !selected}
          >
            {busy ? <Loader2 className={styles.spin} size={16} /> : <Plus size={16} strokeWidth={2.2} />}
            Create draft
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Run detail ───────────────────────────────────────────────────────────────

function RunDetailView({
  runId,
  canManage,
  canApprove,
  onBack,
}: {
  runId: string;
  canManage: boolean;
  canApprove: boolean;
  onBack: () => void;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [run, setRun] = useState<RunDetail | null>(null);
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [validations, setValidations] = useState<RunValidationResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<PayrollItem | null>(null);
  const [addingFor, setAddingFor] = useState<{ id: string; name: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [runRes, itemsRes, workersRes] = await Promise.all([
        api.get<{ data: RunDetail }>(`/payroll/runs/${runId}`),
        api.get<{ data: PayrollItem[] }>(`/payroll/runs/${runId}/items`),
        fetchAllWorkers().catch(() => [] as WorkerSummary[]),
      ]);
      setRun(runRes.data.data);
      setItems(itemsRes.data.data);
      setWorkers(workersRes);
      // Validations may be empty before prepare — tolerate a failure.
      try {
        const val = await api.get<{ data: RunValidationResult }>(
          `/payroll/runs/${runId}/validations`,
        );
        setValidations(val.data.data);
      } catch {
        setValidations(null);
      }
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'forbidden'
          : 'error',
      );
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(label: string, path: string, body?: unknown) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await api.post(`/payroll/runs/${runId}/${path}`, body ?? {});
      setNotice(`${label} succeeded.`);
      await load();
    } catch (err) {
      setError(messageFrom(err, `Could not ${label.toLowerCase()}.`));
    } finally {
      setBusy('');
    }
  }

  const currency = run?.currency ?? 'NGN';
  const status = run?.status;

  if (state === 'loading') {
    return (
      <div className={styles.spinnerRow}>
        <Loader2 className={styles.spin} size={16} /> Loading pay run…
      </div>
    );
  }
  if (state === 'forbidden' || state === 'error' || !run) {
    return (
      <div className={`glass ${styles.message}`} role="alert">
        <p className={styles.messageTitle}>Could not load this run</p>
        <p className={styles.muted}>
          It may have been removed, or your role cannot view it.
        </p>
        <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onBack}>
          <ArrowLeft size={15} /> Back to runs
        </button>
      </div>
    );
  }

  const byWorker = new Map<string, PayrollItem[]>();
  for (const item of items) {
    const list = byWorker.get(item.workerId) ?? [];
    list.push(item);
    byWorker.set(item.workerId, list);
  }

  const errors = validations?.errors ?? [];
  const warnings = validations?.warnings ?? [];
  const needsAck = warnings.length > 0 && !validations?.acknowledgedAt;

  return (
    <div className={styles.panel}>
      <div className={styles.detailHead}>
        <div>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onBack}>
            <ArrowLeft size={15} /> Back
          </button>
          <h2 className={styles.detailTitle} style={{ marginTop: 'var(--space-3)' }}>
            {formatRange(run.periodStart, run.periodEnd)}
          </h2>
          <p className={styles.detailMeta}>
            Prepared {run.preparedById.slice(0, 8)} · {items.length} item lines
            {run.notes ? ` · ${run.notes}` : ''}
          </p>
        </div>
        <span className={`${styles.badge} ${styles[RUN_STATUS_TONE[run.status] as keyof typeof styles] ?? ''}`}>
          {RUN_STATUS_LABEL[run.status]}
        </span>
      </div>

      <div className={styles.summary}>
        <div className={`glass ${styles.stat}`}>
          <span className={styles.statLabel}>Gross</span>
          <span className={styles.statValue}>
            {formatMinorUnits(run.totalGrossMinorUnits, currency)}
          </span>
        </div>
        <div className={`glass ${styles.stat}`}>
          <span className={styles.statLabel}>Deductions</span>
          <span className={`${styles.statValue} ${styles.statValueNeg}`}>
            {formatMinorUnits(run.totalDeductionsMinorUnits, currency)}
          </span>
        </div>
        <div className={`glass ${styles.stat}`}>
          <span className={styles.statLabel}>Net pay</span>
          <span className={`${styles.statValue} ${styles.statValuePos}`}>
            {formatMinorUnits(run.totalNetMinorUnits, currency)}
          </span>
        </div>
        <div className={`glass ${styles.stat}`}>
          <span className={styles.statLabel}>Workers</span>
          <span className={styles.statValue}>{byWorker.size}</span>
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

      {/* Lifecycle actions */}
      <div className={styles.toolbar}>
        <span className={styles.sectionLabel}>Lifecycle</span>
        <div className={styles.toolbarActions}>
          {canManage && status === PayrollRunStatus.DRAFT && (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => action('Prepare', 'prepare')}
                disabled={!!busy}
              >
                {busy === 'Prepare' ? <Loader2 className={styles.spin} size={15} /> : <RefreshCw size={15} />}
                Prepare
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => action('Review', 'review')}
                disabled={!!busy || items.length === 0}
              >
                <ShieldCheck size={15} /> Send to review
              </button>
            </>
          )}
          {canManage && status === PayrollRunStatus.IN_REVIEW && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => action('Submit', 'submit')}
              disabled={!!busy || errors.length > 0}
            >
              <Send size={15} /> Submit for approval
            </button>
          )}
          {canApprove && status === PayrollRunStatus.PENDING_APPROVAL && (
            <>
              {needsAck && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => action('Acknowledge', 'acknowledge')}
                  disabled={!!busy}
                >
                  <AlertTriangle size={15} /> Acknowledge warnings
                </button>
              )}
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => action('Approve', 'approve', {})}
                disabled={!!busy || needsAck}
              >
                <Check size={15} /> Approve
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => {
                  const comment = window.prompt('Reason for rejection?');
                  if (comment) void action('Reject', 'reject', { comment });
                }}
                disabled={!!busy}
              >
                <X size={15} /> Reject
              </button>
            </>
          )}
          {canApprove && status === PayrollRunStatus.APPROVED && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => action('Process', 'process')}
              disabled={!!busy}
            >
              <Check size={15} /> Process (create payments & payslips)
            </button>
          )}
          {canApprove && status === PayrollRunStatus.PROCESSED && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => action('Lock', 'lock')}
              disabled={!!busy}
            >
              <Lock size={15} /> Lock run
            </button>
          )}
          {canApprove &&
            (status === PayrollRunStatus.APPROVED ||
              status === PayrollRunStatus.PROCESSED ||
              status === PayrollRunStatus.LOCKED) && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => {
                  const reason = window.prompt('Reason for reversing this run?');
                  if (reason) void action('Reverse', 'reverse', { reason });
                }}
                disabled={!!busy}
              >
                <RotateCcw size={15} /> Reverse
              </button>
            )}
        </div>
      </div>

      {/* Validations */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Validation</span>
        {errors.length === 0 && warnings.length === 0 ? (
          <p className={styles.muted}>
            No blocking issues{validations ? '' : ' (run not yet prepared)'}.
          </p>
        ) : (
          <ul className={styles.panelList}>
            {errors.map((issue, i) => (
              <li key={`e${i}`} className={`glass ${styles.panelItem}`}>
                <span className={styles.panelItemBody}>
                  <span className={styles.panelName}>{issue.code}</span>
                  <span className={styles.panelMeta}>{issue.message}</span>
                </span>
                <span className={`${styles.badge} ${styles.badgeDanger}`}>Error</span>
              </li>
            ))}
            {warnings.map((issue, i) => (
              <li key={`w${i}`} className={`glass ${styles.panelItem}`}>
                <span className={styles.panelItemBody}>
                  <span className={styles.panelName}>{issue.code}</span>
                  <span className={styles.panelMeta}>{issue.message}</span>
                </span>
                <span className={`${styles.badge} ${styles.badgeWarning}`}>Warning</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Approval chain */}
      {run.approvals && run.approvals.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>Approval chain</span>
          <div className={styles.chain}>
            {run.approvals.map((step) => (
              <div key={step.id} className={styles.chainStep}>
                <span
                  className={`${styles.chainDot} ${
                    step.status === 'APPROVED'
                      ? styles.chainDotApproved
                      : step.status === 'REJECTED'
                        ? styles.chainDotRejected
                        : styles.chainDotPending
                  }`}
                />
                <span className={styles.chainRole}>
                  {step.stepNumber}. {step.role}
                </span>
                <span className={styles.chainMeta}>
                  {APPROVAL_STATUS_LABEL[step.status]}
                  {step.comment ? ` · ${step.comment}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Item lines */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Item lines</span>
        {items.length === 0 ? (
          <p className={styles.muted}>Not prepared yet.</p>
        ) : (
          [...byWorker.entries()].map(([workerId, lines]) => {
            const name =
              lines[0]?.workerName ??
              workerNameOf(workerId) ??
              workerId.slice(0, 8);
            const editable =
              canManage && status === PayrollRunStatus.DRAFT;
            return (
              <div
                key={workerId}
                className={`glass ${styles.tableWrap}`}
                style={{ marginBottom: 'var(--space-3)' }}
              >
                <div className={styles.groupHead}>
                  <span className={styles.groupName}>{name}</span>
                  {canManage &&
                    (status === PayrollRunStatus.DRAFT ||
                      status === PayrollRunStatus.IN_REVIEW) && (
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => setAddingFor({ id: workerId, name })}
                      >
                        <Plus size={14} strokeWidth={2.2} /> Add line
                      </button>
                    )}
                </div>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th className={styles.num}>Amount</th>
                      {editable && (
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td>{ITEM_TYPE_LABEL[line.type]}</td>
                        <td>
                          {line.description}
                          {line.overrideReason ? (
                            <span className={styles.panelMeta}>
                              {' '}
                              · reason: {line.overrideReason}
                            </span>
                          ) : null}
                        </td>
                        <td className={styles.num}>
                          {formatMinorUnits(line.amountMinorUnits, line.currency)}
                        </td>
                        {editable && (
                          <td className={styles.tableRowActions}>
                            <button
                              type="button"
                              className={styles.btn}
                              onClick={() => setEditing(line)}
                            >
                              Override
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </div>

      {editing && (
        <OverrideDrawer
          item={editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          runId={runId}
        />
      )}

      {addingFor && (
        <AddLineDrawer
          runId={runId}
          workerId={addingFor.id}
          workerName={addingFor.name}
          currency={currency}
          onClose={() => setAddingFor(null)}
          onSaved={() => {
            setAddingFor(null);
            void load();
          }}
        />
      )}
    </div>
  );

  function workerNameOf(workerId: string): string | undefined {
    const worker = workers.find((w) => w.id === workerId);
    return worker ? workerDisplayName(worker) : undefined;
  }
}

// ── Override drawer (PAY-09) ─────────────────────────────────────────────────

function OverrideDrawer({
  runId,
  item,
  currency,
  onClose,
  onSaved,
}: {
  runId: string;
  item: PayrollItem;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(item.amountMinorUnits / 100));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minor)) {
      setError('Enter a valid amount.');
      return;
    }
    if (!reason.trim()) {
      setError('An override reason is required (PAY-09).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/payroll/runs/${runId}/items/${item.id}`, {
        amountMinorUnits: minor,
        overrideReason: reason.trim(),
      });
      onSaved();
    } catch (err) {
      setError(messageFrom(err, 'Could not override the line.'));
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
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="Override line">
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>Override line</p>
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
          <p className={styles.muted}>
            {ITEM_TYPE_LABEL[item.type]} · {item.description}
            <br />
            Current: {formatMinorUnits(item.amountMinorUnits, currency)}
          </p>
          <div className={styles.grid}>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="ovr-amount">
                New amount ({currency})
              </label>
              <input
                id="ovr-amount"
                className={styles.input}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.currentTarget.value)}
              />
              <span className={styles.formHint}>
                Use a negative value for a deduction (minor units handled for you).
              </span>
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="ovr-reason">
                Reason (required)
              </label>
              <textarea
                id="ovr-reason"
                className={styles.textarea}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
            </div>
          </div>
        </div>
        <div className={styles.drawerActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={busy}>
            {busy && <Loader2 className={styles.spin} size={15} />}
            Save override
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Add one-off line drawer (PAY-09) ─────────────────────────────────────────

function AddLineDrawer({
  runId,
  workerId,
  workerName,
  currency,
  onClose,
  onSaved,
}: {
  runId: string;
  workerId: string;
  workerName: string;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<PayrollItemType>(PayrollItemType.DEDUCTION);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isDeduction = MANUAL_DEDUCTION_TYPES.has(type);

  async function save() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!description.trim()) {
      setError('A description is required.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required (PAY-09).');
      return;
    }
    // Deductions are stored as negative minor units.
    const minor = Math.round(value * 100) * (isDeduction ? -1 : 1);
    setBusy(true);
    setError('');
    try {
      await api.post(`/payroll/runs/${runId}/items`, {
        workerId,
        type,
        description: description.trim(),
        amountMinorUnits: minor,
        overrideReason: reason.trim(),
      });
      onSaved();
    } catch (err) {
      setError(messageFrom(err, 'Could not add the line.'));
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
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="Add line">
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>Add line · {workerName}</p>
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
          <p className={styles.muted}>
            Add a one-off earning or deduction to this worker&apos;s pay for this
            period. Changes are limited to drafts and in-review runs, and every
            line is audit-logged with its reason.
          </p>
          <div className={styles.grid}>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="add-type">
                Type
              </label>
              <select
                id="add-type"
                className={styles.select}
                value={type}
                onChange={(e) => setType(e.currentTarget.value as PayrollItemType)}
              >
                {MANUAL_ITEM_TYPE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {ITEM_TYPE_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="add-desc">
                Description
              </label>
              <input
                id="add-desc"
                className={styles.input}
                value={description}
                placeholder={
                  isDeduction ? 'e.g. Salary advance repayment' : 'e.g. Q4 spot bonus'
                }
                onChange={(e) => setDescription(e.currentTarget.value)}
              />
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="add-amount">
                Amount ({currency})
              </label>
              <input
                id="add-amount"
                className={styles.input}
                inputMode="decimal"
                value={amount}
                placeholder="0.00"
                onChange={(e) => setAmount(e.currentTarget.value)}
              />
              <span className={styles.formHint}>
                {isDeduction
                  ? 'Enter a positive number — it will be deducted from net pay.'
                  : 'Enter a positive number — it will be added to gross pay.'}
              </span>
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="add-reason">
                Reason (required)
              </label>
              <textarea
                id="add-reason"
                className={styles.textarea}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
            </div>
          </div>
        </div>
        <div className={styles.drawerActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={busy}>
            {busy ? <Loader2 className={styles.spin} size={15} /> : <Plus size={15} strokeWidth={2.2} />}
            Add line
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
