'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ArrowUpRight, CalendarCheck, Check, Loader2, Plus, Trash2, UserPlus, X } from 'lucide-react';
import {
  LeaveStatus,
  type LeaveRequestSummary,
  type LeaveType,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { fetchAllWorkers, isSelectableWorker } from '@/lib/workers';
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

const STATUS_LABELS: Record<LeaveStatus, string> = {
  [LeaveStatus.DRAFT]: 'Draft',
  [LeaveStatus.PENDING]: 'Pending',
  [LeaveStatus.APPROVED]: 'Approved',
  [LeaveStatus.REJECTED]: 'Rejected',
  [LeaveStatus.CANCELLED]: 'Cancelled',
};

const STATUS_TONE: Record<LeaveStatus, string | undefined> = {
  [LeaveStatus.DRAFT]: undefined,
  [LeaveStatus.PENDING]: styles.badgeWarning,
  [LeaveStatus.APPROVED]: styles.badgeSuccess,
  [LeaveStatus.REJECTED]: styles.badgeDanger,
  [LeaveStatus.CANCELLED]: undefined,
};

const STATUSES = Object.values(LeaveStatus);

/** Roles that may request leave. */
const REQUESTERS = new Set([
  'OWNER',
  'HR_ADMINISTRATOR',
  'MANAGER',
  'EMPLOYEE_SELF',
  'VOLUNTEER_SELF',
]);

/** Roles that may request leave on behalf of anyone in the organisation. */
const ORG_CREATE = new Set(['OWNER', 'HR_ADMINISTRATOR']);

/** Roles that may approve someone else's leave. */
const APPROVERS = new Set(['OWNER', 'HR_ADMINISTRATOR', 'MANAGER']);

const CLOSED: LeaveStatus[] = [LeaveStatus.REJECTED, LeaveStatus.CANCELLED];

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' });
const monthShortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeLabel(record: LeaveRequestSummary): string {
  const start = new Date(`${record.startDate}T00:00:00Z`);
  const end = new Date(`${record.endDate}T00:00:00Z`);
  if (record.startDate === record.endDate) return dateFmt.format(start);
  return `${dateFmt.format(start)} – ${dateFmt.format(end)}`;
}

type Draft = {
  workerId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  reason: string;
  requireHrApproval: boolean;
  /** Hours before the active step escalates; '' keeps the server default. */
  escalateHours: string;
  overrideBlackout: boolean;
};

const newDraft = (): Draft => ({
  workerId: '',
  leaveTypeId: '',
  startDate: isoToday(),
  endDate: isoToday(),
  startHalfDay: false,
  endHalfDay: false,
  reason: '',
  requireHrApproval: false,
  escalateHours: '',
  overrideBlackout: false,
});

/**
 * Escalation windows (LVE-04). The API default is 2 days; an explicit 0 turns
 * auto-escalation off for the request. Sent as whole minutes.
 */
const ESCALATION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Default (2 days)' },
  { value: '12', label: 'After 12 hours' },
  { value: '24', label: 'After 1 day' },
  { value: '48', label: 'After 2 days' },
  { value: '72', label: 'After 3 days' },
  { value: '168', label: 'After 1 week' },
  { value: '0', label: 'Never auto-escalate' },
];

export default function LeaveRequestsPanel() {
  const { user } = useCurrentUser();
  const role = user?.role;
  const canCreate = role ? REQUESTERS.has(role) : false;
  const canCreateForOthers = role ? ORG_CREATE.has(role) : false;
  const canApprove = role ? APPROVERS.has(role) : false;
  const isOrgApprover = role ? ORG_CREATE.has(role) : false;

  const [requests, setRequests] = useState<LeaveRequestSummary[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [selfWorkerId, setSelfWorkerId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [needsMe, setNeedsMe] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [draft, setDraft] = useState<Draft>(newDraft);
  const [action, setAction] = useState<{
    id: string;
    kind: 'approve' | 'reject' | 'delegate';
  } | null>(null);
  const [note, setNote] = useState('');
  const [delegateId, setDelegateId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: LeaveRequestSummary[] }>('/leave-requests', {
        params: {
          pageSize: 200,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(workerFilter ? { workerId: workerFilter } : {}),
          ...(mineOnly ? { mine: true } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      });
      setRequests(res.data.data);
      setError('');
    } catch (err) {
      setError(messageFrom(err, 'Could not load leave requests.'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, workerFilter, mineOnly, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ data: LeaveType[] }>('/leave-types')
      .then((res) => {
        setTypes(res.data.data);
        setDraft((d) =>
          d.leaveTypeId ? d : { ...d, leaveTypeId: res.data.data[0]?.id ?? '' },
        );
      })
      .catch(() => {
        // The leave-type picker simply stays empty.
      });
  }, []);

  useEffect(() => {
    if (!canCreate && !canApprove) return;
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
  }, [canCreate, canApprove]);

  useEffect(() => {
    if (!canCreate) return;
    api
      .get<{ data: LeaveRequestSummary[] }>('/leave-requests', {
        params: { mine: true, pageSize: 1 },
      })
      .then((res) => {
        const first = res.data.data[0];
        if (first) setSelfWorkerId(first.workerId);
      })
      .catch(() => {
        // Without a self probe we simply don't offer self-service actions.
      });
  }, [canCreate]);

  const workerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workers) map.set(w.id, `${w.firstName} ${w.lastName}`.trim());
    return map;
  }, [workers]);

  const activeWorkers = useMemo(() => workers.filter(isSelectableWorker), [workers]);

  const delegates = useMemo(
    () => activeWorkers.filter((w) => w.hasLogin && w.userId && w.userId !== user?.sub),
    [activeWorkers, user?.sub],
  );

  const selectedType = useMemo(
    () => types.find((t) => t.id === draft.leaveTypeId) ?? null,
    [types, draft.leaveTypeId],
  );
  // An approval chain only exists when the leave type requires approval, so the
  // escalation controls are irrelevant otherwise.
  const showEscalationControls = isOrgApprover && (selectedType?.requiresApproval ?? true);

  function currentStep(record: LeaveRequestSummary) {
    return record.steps?.find((s) => s.stepOrder === record.currentStepOrder);
  }

  function canDecide(record: LeaveRequestSummary): boolean {
    if (record.status !== LeaveStatus.PENDING) return false;
    if (isOrgApprover) return true;
    if (!canApprove || !user?.sub) return false;
    const step = currentStep(record);
    if (!step) return false;
    if (step.escalatedAt && step.escalatedToId) {
      return step.escalatedToId === user.sub;
    }
    if (step.delegatedToId) return step.delegatedToId === user.sub;
    return step.approverId === user.sub;
  }

  /**
   * Delegation is limited to the person actually holding the current step
   * (delegate or approver) — unlike deciding, an org-wide approver cannot
   * delegate a step assigned to someone else.
   */
  function canDelegate(record: LeaveRequestSummary): boolean {
    if (record.status !== LeaveStatus.PENDING || !user?.sub) return false;
    const step = currentStep(record);
    if (!step) return false;
    if (step.escalatedAt && step.escalatedToId) {
      return step.escalatedToId === user.sub;
    }
    if (step.delegatedToId) return step.delegatedToId === user.sub;
    return step.approverId === user.sub;
  }

  function canCancel(record: LeaveRequestSummary): boolean {
    if (CLOSED.includes(record.status)) return false;
    return isOrgApprover || (!!selfWorkerId && record.workerId === selfWorkerId);
  }

  function canSubmit(record: LeaveRequestSummary): boolean {
    if (record.status !== LeaveStatus.DRAFT) return false;
    return isOrgApprover || (!!selfWorkerId && record.workerId === selfWorkerId);
  }

  async function create() {
    if (!draft.leaveTypeId || !draft.startDate || !draft.endDate) return;
    setAction(null);
    setBusy(true);
    setError('');
    setNotice('');
    const escalationMinutes =
      draft.escalateHours === '' ? undefined : Math.round(Number(draft.escalateHours) * 60);
    try {
      await api.post('/leave-requests', {
        ...(canCreateForOthers && draft.workerId ? { workerId: draft.workerId } : {}),
        leaveTypeId: draft.leaveTypeId,
        startDate: draft.startDate,
        endDate: draft.endDate,
        ...(draft.startHalfDay ? { startHalfDay: true } : {}),
        ...(draft.endHalfDay ? { endHalfDay: true } : {}),
        ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
        ...(showEscalationControls && draft.requireHrApproval
          ? { requireHrApproval: true }
          : {}),
        ...(showEscalationControls && escalationMinutes !== undefined
          ? { escalateAfterMinutes: escalationMinutes }
          : {}),
        ...(isOrgApprover && draft.overrideBlackout ? { overrideBlackout: true } : {}),
      });
      setDraft((d) => ({ ...newDraft(), workerId: d.workerId, leaveTypeId: d.leaveTypeId }));
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not create the leave request.'));
    } finally {
      setBusy(false);
    }
  }

  async function runEscalations() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.post<{ data: { escalated: number } }>(
        '/leave-requests/escalations/run',
      );
      const count = res.data.data.escalated;
      setNotice(
        count > 0
          ? `Escalated ${count} overdue request${count === 1 ? '' : 's'}.`
          : 'No overdue requests to escalate.',
      );
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not run escalations.'));
    } finally {
      setBusy(false);
    }
  }

  async function decide() {
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/leave-requests/${action.id}/decide`, {
        approve: action.kind === 'approve',
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setAction(null);
      setNote('');
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not record the decision.'));
    } finally {
      setBusy(false);
    }
  }

  async function delegate() {
    if (!action || !delegateId) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/leave-requests/${action.id}/delegate`, {
        toUserId: delegateId,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setAction(null);
      setNote('');
      setDelegateId('');
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not delegate the approval.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest(record: LeaveRequestSummary) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/leave-requests/${record.id}/submit`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not submit the leave request.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(record: LeaveRequestSummary) {
    const ok = window.confirm(
      `Cancel the ${STATUS_LABELS[record.status].toLowerCase()} leave request for ${
        record.workerName ?? 'this worker'
      } (${rangeLabel(record)})?`,
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/leave-requests/${record.id}/cancel`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not cancel the leave request.'));
    } finally {
      setBusy(false);
    }
  }

  const visible = needsMe ? requests.filter((r) => canDecide(r)) : requests;

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

      {isOrgApprover && (
        <div className={styles.toolbar}>
          <span className={styles.formHint}>
            Undecided steps past their deadline can be escalated to HR on demand.
          </span>
          <div className={styles.toolbarActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={runEscalations}
              disabled={busy}
            >
              {busy ? <Loader2 className={styles.spin} size={15} /> : <ArrowUpRight size={16} />}
              Run escalations
            </button>
          </div>
        </div>
      )}

      {canCreate && (
        <div className={`glass ${styles.inlineForm} ${styles.stackedForm}`}>
          <div className={styles.grid}>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="leave-type">
                Leave type
              </label>
              <select
                id="leave-type"
                className={styles.select}
                value={draft.leaveTypeId}
                onChange={(e) => setDraft((d) => ({ ...d, leaveTypeId: e.target.value }))}
              >
                <option value="">Select a leave type…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            {canCreateForOthers && (
              <div className={styles.gridItem}>
                <label className={styles.label} htmlFor="leave-worker">
                  Person
                </label>
                <select
                  id="leave-worker"
                  className={styles.select}
                  value={draft.workerId}
                  onChange={(e) => setDraft((d) => ({ ...d, workerId: e.target.value }))}
                >
                  <option value="">Select a person…</option>
                  {activeWorkers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.firstName} {w.lastName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="leave-start">
                Start date
              </label>
              <input
                id="leave-start"
                type="date"
                className={styles.input}
                value={draft.startDate}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    startDate: e.target.value,
                    endDate: d.endDate < e.target.value ? e.target.value : d.endDate,
                  }))
                }
              />
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="leave-end">
                End date
              </label>
              <input
                id="leave-end"
                type="date"
                className={styles.input}
                min={draft.startDate}
                value={draft.endDate}
                onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
              />
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label}>Half days</label>
              <div className={styles.badges}>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={draft.startHalfDay}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, startHalfDay: e.target.checked }))
                    }
                  />
                  First day
                </label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={draft.endHalfDay}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, endHalfDay: e.target.checked }))
                    }
                  />
                  Last day
                </label>
              </div>
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="leave-reason">
                Reason (optional)
              </label>
              <input
                id="leave-reason"
                className={styles.input}
                value={draft.reason}
                onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
                placeholder="e.g. Family holiday"
              />
            </div>
            {showEscalationControls && (
              <div className={`${styles.gridItem} ${styles.gridFull}`}>
                <label className={styles.label} htmlFor="leave-escalate">
                  Approval routing
                </label>
                <div className={styles.badges}>
                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={draft.requireHrApproval}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, requireHrApproval: e.target.checked }))
                      }
                    />
                    Require an HR approval step
                  </label>
                  <select
                    id="leave-escalate"
                    className={styles.select}
                    aria-label="Auto-escalate after"
                    value={draft.escalateHours}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, escalateHours: e.target.value }))
                    }
                  >
                    {ESCALATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {isOrgApprover && (
              <div className={`${styles.gridItem} ${styles.gridFull}`}>
                <label className={styles.label}>Blackout periods</label>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={draft.overrideBlackout}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, overrideBlackout: e.target.checked }))
                    }
                  />
                  Allow dates that fall inside a blackout period
                </label>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${styles.formAction}`}
            onClick={create}
            disabled={busy || !draft.leaveTypeId || !draft.startDate || !draft.endDate}
          >
            {busy ? <Loader2 className={styles.spin} size={15} /> : <Plus size={16} />}
            Request leave
          </button>
          <p className={styles.formHint}>
            Requests route to the reporting manager (and HR when required). Balances move
            only once the final step approves.
          </p>
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.gridItem}>
          <label className={styles.label} htmlFor="leave-filter-from">
            From
          </label>
          <input
            id="leave-filter-from"
            type="date"
            className={styles.input}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label} htmlFor="leave-filter-to">
            To
          </label>
          <input
            id="leave-filter-to"
            type="date"
            className={styles.input}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label} htmlFor="leave-filter-status">
            Status
          </label>
          <select
            id="leave-filter-status"
            className={styles.select}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {canApprove ? (
          <div className={styles.gridItem}>
            <label className={styles.label} htmlFor="leave-filter-worker">
              Worker
            </label>
            <select
              id="leave-filter-worker"
              className={styles.select}
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
            >
              <option value="">All workers</option>
              {activeWorkers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.firstName} {w.lastName}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className={styles.gridItem}>
            <label className={styles.label}>&nbsp;</label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => setMineOnly(e.target.checked)}
              />
              Only my requests
            </label>
          </div>
        )}
        {canApprove && canCreate && (
          <div className={styles.gridItem}>
            <label className={styles.label}>&nbsp;</label>
            <div className={styles.badges}>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={mineOnly}
                  onChange={(e) => setMineOnly(e.target.checked)}
                />
                Only mine
              </label>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={needsMe}
                  onChange={(e) => setNeedsMe(e.target.checked)}
                />
                Needs my approval
              </label>
            </div>
          </div>
        )}
        {canApprove && !canCreate && (
          <div className={styles.gridItem}>
            <label className={styles.label}>&nbsp;</label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={needsMe}
                onChange={(e) => setNeedsMe(e.target.checked)}
              />
              Needs my approval
            </label>
          </div>
        )}
      </div>

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading leave requests…
        </div>
      ) : visible.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <CalendarCheck size={28} strokeWidth={1.5} aria-hidden="true" />
          <p className={styles.messageTitle}>No leave requests</p>
          <p className={styles.muted}>
            {needsMe
              ? 'Nothing is waiting on your approval.'
              : canCreate
                ? 'Request leave above, or widen the filters.'
                : 'There is nothing to show for these filters.'}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList} role="list">
          {visible.map((record) => {
            const start = new Date(`${record.startDate}T00:00:00Z`);
            const halfDay = record.startHalfDay || record.endHalfDay;
            const step = currentStep(record);
            return (
              <li
                key={record.id}
                className={`glass ${styles.panelItem} ${styles.leaveItem}`}
              >
                <div className={styles.leaveTop}>
                  <div className={styles.panelItemMain}>
                    <div className={styles.dateChip} aria-hidden="true">
                      <span className={styles.dateChipDay}>{dayFmt.format(start)}</span>
                      <span className={styles.dateChipMonth}>
                        {monthShortFmt.format(start)}
                      </span>
                    </div>
                    <div className={styles.panelItemBody}>
                      <span className={styles.panelName}>
                        {record.leaveTypeName ?? 'Leave'}
                      </span>
                      <span className={styles.panelMeta}>
                        {canApprove
                          ? `${record.workerName ?? workerName.get(record.workerId) ?? 'Worker'} · `
                          : ''}
                        {rangeLabel(record)} · {record.days} day
                        {record.days === 1 ? '' : 's'}
                        {halfDay ? ' (half day)' : ''}
                      </span>
                      <div className={styles.badges}>
                        <span
                          className={`${styles.badge} ${STATUS_TONE[record.status] ?? ''}`}
                        >
                          {STATUS_LABELS[record.status]}
                        </span>
                        {record.status === LeaveStatus.PENDING && record.steps?.length ? (
                          <span className={styles.badge}>
                            Step {(record.currentStepOrder ?? 0) + 1} of{' '}
                            {record.steps.length}
                          </span>
                        ) : null}
                        {step?.escalatedAt ? (
                          <span className={`${styles.badge} ${styles.badgeWarning}`}>
                            Escalated
                          </span>
                        ) : null}
                        {record.reason ? (
                          <span className={styles.badge}>{record.reason}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className={styles.panelActions}>
                    {canDecide(record) && (
                      <>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          onClick={() => {
                            setAction({ id: record.id, kind: 'approve' });
                            setNote('');
                            setDelegateId('');
                          }}
                          disabled={busy}
                        >
                          <Check size={15} strokeWidth={2.2} /> Approve
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost}`}
                          onClick={() => {
                            setAction({ id: record.id, kind: 'reject' });
                            setNote('');
                            setDelegateId('');
                          }}
                          disabled={busy}
                        >
                          <X size={15} strokeWidth={2.2} /> Reject
                        </button>
                      </>
                    )}
                    {canDelegate(record) && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost}`}
                        onClick={() => {
                          setAction({ id: record.id, kind: 'delegate' });
                          setNote('');
                          setDelegateId('');
                        }}
                        disabled={busy || delegates.length === 0}
                        title={
                          delegates.length === 0
                            ? 'No other workspace members to delegate to'
                            : 'Delegate this approval'
                        }
                      >
                        <UserPlus size={15} strokeWidth={2.2} /> Delegate
                      </button>
                    )}
                    {canSubmit(record) && (
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => submitRequest(record)}
                        disabled={busy}
                      >
                        <Check size={15} strokeWidth={2.2} /> Submit
                      </button>
                    )}
                    {canCancel(record) && (
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => cancelRequest(record)}
                        disabled={busy}
                        aria-label={`Cancel leave request for ${
                          record.workerName ?? 'worker'
                        }`}
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                </div>

                {action?.id === record.id && (
                  <div className={styles.decideBar}>
                    {action.kind === 'delegate' ? (
                      <>
                        <label
                          className={styles.label}
                          htmlFor={`leave-delegate-${record.id}`}
                        >
                          Delegate to
                        </label>
                        <select
                          id={`leave-delegate-${record.id}`}
                          className={styles.select}
                          value={delegateId}
                          onChange={(e) => setDelegateId(e.target.value)}
                        >
                          <option value="">Select a workspace member…</option>
                          {delegates.map((w) => (
                            <option key={w.id} value={w.userId}>
                              {w.firstName} {w.lastName}
                            </option>
                          ))}
                        </select>
                        <label
                          className={styles.label}
                          htmlFor={`leave-note-${record.id}`}
                        >
                          Note (optional)
                        </label>
                        <textarea
                          id={`leave-note-${record.id}`}
                          className={styles.textarea}
                          rows={2}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="e.g. I'm away next week — please decide"
                        />
                        <div className={styles.decideActions}>
                          <button
                            type="button"
                            className={styles.btn}
                            onClick={() => {
                              setAction(null);
                              setNote('');
                              setDelegateId('');
                            }}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            onClick={delegate}
                            disabled={busy || !delegateId}
                          >
                            {busy ? (
                              <Loader2 className={styles.spin} size={15} />
                            ) : (
                              <UserPlus size={15} strokeWidth={2.2} />
                            )}
                            Delegate request
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <label
                          className={styles.label}
                          htmlFor={`leave-note-${record.id}`}
                        >
                          {action.kind === 'approve'
                            ? 'Approval note (optional)'
                            : 'Reason for rejection (optional)'}
                        </label>
                        <textarea
                          id={`leave-note-${record.id}`}
                          className={styles.textarea}
                          rows={2}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder={
                            action.kind === 'approve'
                              ? 'e.g. Enjoy the break'
                              : 'e.g. Coverage needed that week'
                          }
                        />
                        <div className={styles.decideActions}>
                          <button
                            type="button"
                            className={styles.btn}
                            onClick={() => {
                              setAction(null);
                              setNote('');
                            }}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            onClick={decide}
                            disabled={busy}
                          >
                            {busy ? (
                              <Loader2 className={styles.spin} size={15} />
                            ) : (
                              <Check size={15} strokeWidth={2.2} />
                            )}
                            {action.kind === 'approve'
                              ? 'Approve request'
                              : 'Reject request'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
