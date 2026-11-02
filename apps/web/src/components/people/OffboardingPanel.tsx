'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  RotateCcw,
  SkipForward,
  XCircle,
} from 'lucide-react';
import type {
  ChecklistTaskSummary,
  OffboardingCaseSummary,
  WorkerSummary,
} from '@ascenda/types';
import {
  ChecklistTaskStatus,
  ExitReason,
  OffboardingStatus,
} from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './people.module.css';

const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  [ExitReason.RESIGNATION]: 'Resignation',
  [ExitReason.DISMISSAL]: 'Dismissal',
  [ExitReason.CONTRACT_END]: 'Contract end',
  [ExitReason.RETIREMENT]: 'Retirement',
  [ExitReason.REDUNDANCY]: 'Redundancy',
  [ExitReason.OTHER]: 'Other',
};

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function today(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export default function OffboardingPanel({
  t,
}: {
  t: (term: string) => string;
}) {
  const [rows, setRows] = useState<OffboardingCaseSummary[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | OffboardingStatus>('all');

  const [workerId, setWorkerId] = useState('');
  const [exitReason, setExitReason] = useState<ExitReason>(ExitReason.RESIGNATION);
  const [reasonDetail, setReasonDetail] = useState('');
  const [lastWorkingDate, setLastWorkingDate] = useState(today());
  const [noticeDate, setNoticeDate] = useState('');

  const loadWorkers = useCallback(async () => {
    try {
      const response = await api.get<{ data: WorkerSummary[] }>('/workers', {
        params: { pageSize: 100 },
      });
      setWorkers(response.data.data);
    } catch (err) {
      setError(messageFrom(err, 'Could not load workers.'));
    }
  }, []);

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<{ data: OffboardingCaseSummary[] }>(
        '/talent/offboarding',
        { params: { pageSize: 100 } },
      );
      setRows(response.data.data);
    } catch (err) {
      setError(messageFrom(err, 'Could not load offboarding cases.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadCases(), loadWorkers()]);
  }, [loadCases, loadWorkers]);

  const eligibleWorkers = useMemo(
    () =>
      workers.filter(
        (worker) =>
          worker.status !== 'RESIGNED' && worker.status !== 'TERMINATED',
      ),
    [workers],
  );

  useEffect(() => {
    if (!workerId && eligibleWorkers.length > 0) {
      setWorkerId(eligibleWorkers[0]!.id);
    }
  }, [eligibleWorkers, workerId]);

  const visible = useMemo(
    () =>
      filter === 'all'
        ? rows
        : rows.filter((row) => row.status === filter),
    [filter, rows],
  );

  const inProgress = rows.filter(
    (row) => row.status === OffboardingStatus.IN_PROGRESS,
  ).length;
  const completed = rows.filter(
    (row) => row.status === OffboardingStatus.COMPLETED,
  ).length;

  async function startCase() {
    if (!workerId || !lastWorkingDate) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.post<{ data: OffboardingCaseSummary }>(
        '/talent/offboarding',
        {
          workerId,
          exitReason,
          reasonDetail: reasonDetail.trim() || undefined,
          lastWorkingDate,
          noticeDate: noticeDate || undefined,
        },
      );
      setRows((current) => [response.data.data, ...current]);
      setFormOpen(false);
      setReasonDetail('');
      setNoticeDate('');
      setLastWorkingDate(today());
      setWorkerId('');
      await loadWorkers();
    } catch (err) {
      setError(messageFrom(err, 'Could not start offboarding.'));
    } finally {
      setBusy(false);
    }
  }

  async function setTaskStatus(
    row: OffboardingCaseSummary,
    task: ChecklistTaskSummary,
    status: ChecklistTaskStatus,
  ) {
    setBusyTask(task.id);
    setError('');
    try {
      const response = await api.patch<{ data: OffboardingCaseSummary }>(
        `/talent/offboarding/tasks/${task.id}`,
        { status },
      );
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? response.data.data : item,
        ),
      );
    } catch (err) {
      setError(messageFrom(err, 'Could not update the exit task.'));
    } finally {
      setBusyTask(null);
    }
  }

  async function completeCase(row: OffboardingCaseSummary) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post<{ data: OffboardingCaseSummary }>(
        `/talent/offboarding/${row.id}/complete`,
      );
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? response.data.data : item,
        ),
      );
      await loadWorkers();
    } catch (err) {
      setError(messageFrom(err, 'Could not complete offboarding.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelCase(row: OffboardingCaseSummary) {
    const ok = window.confirm(
      `Cancel offboarding for ${row.workerName}? Their worker status will not change.`,
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.post<{ data: OffboardingCaseSummary }>(
        `/talent/offboarding/${row.id}/cancel`,
      );
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? response.data.data : item,
        ),
      );
    } catch (err) {
      setError(messageFrom(err, 'Could not cancel offboarding.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.lifecyclePanel}>
      <div className={styles.lifecycleSummary}>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{rows.length}</span>
          <span className={styles.statLabel}>Exit cases</span>
        </div>
        <div className={`${styles.statChip} ${styles.statDuplicate}`}>
          <span className={styles.statValue}>{inProgress}</span>
          <span className={styles.statLabel}>In progress</span>
        </div>
        <div className={`${styles.statChip} ${styles.statValid}`}>
          <span className={styles.statValue}>{completed}</span>
          <span className={styles.statLabel}>Completed</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Offboarding filter">
          {(
            [
              ['all', 'All'],
              [OffboardingStatus.IN_PROGRESS, 'In progress'],
              [OffboardingStatus.COMPLETED, 'Completed'],
              [OffboardingStatus.CANCELLED, 'Cancelled'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={`${styles.tab} ${filter === value ? styles.tabActive : ''}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => void loadCases()}
            disabled={loading}
          >
            {loading ? <Loader2 className={styles.spin} size={15} /> : <RotateCcw size={15} />}
            Refresh
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setFormOpen((open) => !open)}
            disabled={eligibleWorkers.length === 0}
          >
            <Plus size={16} /> Start offboarding
          </button>
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {formOpen && (
        <div className={`glass ${styles.inlineForm} ${styles.offboardingForm}`}>
          <div className={styles.inlineField}>
            <label className={styles.label} htmlFor="offboarding-worker">
              {t('Employee')}
            </label>
            <select
              id="offboarding-worker"
              className={styles.input}
              value={workerId}
              onChange={(e) => setWorkerId(e.currentTarget.value)}
            >
              {eligibleWorkers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.preferredName || `${worker.firstName} ${worker.lastName}`} ·{' '}
                  {worker.employeeNumber}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.inlineField}>
            <label className={styles.label} htmlFor="offboarding-reason">
              Exit reason
            </label>
            <select
              id="offboarding-reason"
              className={styles.input}
              value={exitReason}
              onChange={(e) => setExitReason(e.currentTarget.value as ExitReason)}
            >
              {Object.entries(EXIT_REASON_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.inlineField}>
            <label className={styles.label} htmlFor="offboarding-last-day">
              Last working date
            </label>
            <input
              id="offboarding-last-day"
              type="date"
              className={styles.input}
              value={lastWorkingDate}
              onChange={(e) => setLastWorkingDate(e.currentTarget.value)}
            />
          </div>
          <div className={styles.inlineField}>
            <label className={styles.label} htmlFor="offboarding-notice">
              Notice date (optional)
            </label>
            <input
              id="offboarding-notice"
              type="date"
              className={styles.input}
              value={noticeDate}
              onChange={(e) => setNoticeDate(e.currentTarget.value)}
            />
          </div>
          <div className={`${styles.inlineField} ${styles.offboardingReasonField}`}>
            <label className={styles.label} htmlFor="offboarding-detail">
              Details (optional)
            </label>
            <input
              id="offboarding-detail"
              className={styles.input}
              value={reasonDetail}
              maxLength={1000}
              placeholder="e.g. Relocating; last day agreed with manager"
              onChange={(e) => setReasonDetail(e.currentTarget.value)}
            />
          </div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void startCase()}
            disabled={busy || !workerId || !lastWorkingDate}
          >
            {busy ? <Loader2 className={styles.spin} size={15} /> : <Plus size={16} />}
            Create checklist
          </button>
        </div>
      )}

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading offboarding…
        </div>
      ) : visible.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>No offboarding cases</p>
          <p className={styles.muted}>
            Start an exit checklist when a {t('Employee').toLowerCase()} gives notice.
          </p>
        </div>
      ) : (
        <ul className={styles.lifecycleList} role="list">
          {visible.map((row) => {
            const isOpen = row.status === OffboardingStatus.IN_PROGRESS;
            return (
              <li key={row.id} className={`glass ${styles.lifecycleCard}`}>
                <div className={styles.lifecycleHeader}>
                  <div className={styles.lifecycleIdentity}>
                    <span className={styles.avatar}>
                      {row.workerName
                        .split(' ')
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    <div className={styles.nameText}>
                      <span className={styles.namePrimary}>{row.workerName}</span>
                      <span className={styles.nameMeta}>
                        {row.jobTitle} · {row.employeeNumber}
                        {row.departmentName ? ` · ${row.departmentName}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className={styles.lifecycleStatus}>
                    <span
                      className={`${styles.status} ${
                        row.status === OffboardingStatus.COMPLETED
                          ? styles.statusTerminated
                          : row.status === OffboardingStatus.CANCELLED
                            ? styles.statusDraft
                            : styles.statusSuspended
                      }`}
                    >
                      {row.status === OffboardingStatus.COMPLETED
                        ? `Completed · ${row.exitReason === ExitReason.RESIGNATION ? 'Resigned' : 'Terminated'}`
                        : row.status === OffboardingStatus.CANCELLED
                          ? 'Cancelled'
                          : 'In progress'}
                    </span>
                    <span className={styles.progressLabel}>
                      {row.progressPct}% · {row.outstandingTasks} outstanding
                    </span>
                  </div>
                </div>

                <div className={styles.offboardingMeta}>
                  <span>
                    <strong>Reason:</strong>{' '}
                    {EXIT_REASON_LABELS[row.exitReason] ?? row.exitReason}
                    {row.reasonDetail ? ` — ${row.reasonDetail}` : ''}
                  </span>
                  <span>
                    <strong>Last working day:</strong> {formatDate(row.lastWorkingDate)}
                  </span>
                  {row.noticeDate && (
                    <span>
                      <strong>Notice:</strong> {formatDate(row.noticeDate)}
                    </span>
                  )}
                </div>

                <div className={styles.progressTrack} aria-hidden="true">
                  <span
                    className={styles.progressFill}
                    style={{ width: `${row.progressPct}%` }}
                  />
                </div>

                <ul className={styles.taskList} role="list">
                  {row.tasks.map((task) => {
                    const done = task.status === ChecklistTaskStatus.COMPLETED;
                    const waived = task.status === ChecklistTaskStatus.WAIVED;
                    return (
                      <li
                        key={task.id}
                        className={`${styles.taskRow} ${done || waived ? styles.taskDone : ''}`}
                      >
                        <button
                          type="button"
                          className={styles.taskCheck}
                          onClick={() =>
                            void setTaskStatus(
                              row,
                              task,
                              done
                                ? ChecklistTaskStatus.PENDING
                                : ChecklistTaskStatus.COMPLETED,
                            )
                          }
                          disabled={!isOpen || busyTask === task.id}
                          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                        >
                          {busyTask === task.id ? (
                            <Loader2 className={styles.spin} size={17} />
                          ) : done || waived ? (
                            <CheckCircle2 size={17} />
                          ) : (
                            <Circle size={17} />
                          )}
                        </button>
                        <div className={styles.taskMain}>
                          <span className={styles.taskTitle}>{task.title}</span>
                          {task.description && (
                            <span className={styles.taskMeta}>{task.description}</span>
                          )}
                          <span className={styles.taskMeta}>
                            {waived
                              ? 'Waived'
                              : done
                                ? `Completed ${formatDate(task.completedAt)}`
                                : 'Pending'}
                          </span>
                        </div>
                        {isOpen && !done && !waived && (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
                            onClick={() =>
                              void setTaskStatus(
                                row,
                                task,
                                ChecklistTaskStatus.WAIVED,
                              )
                            }
                            disabled={busyTask === task.id}
                          >
                            <SkipForward size={14} /> Waive
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {isOpen && (
                  <div className={styles.lifecycleActions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnDanger}`}
                      onClick={() => void cancelCase(row)}
                      disabled={busy}
                    >
                      <XCircle size={15} /> Cancel
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => void completeCase(row)}
                      disabled={busy || row.outstandingTasks > 0}
                      title={
                        row.outstandingTasks > 0
                          ? 'Complete or waive the outstanding tasks first'
                          : undefined
                      }
                    >
                      {busy ? <Loader2 className={styles.spin} size={15} /> : <CheckCircle2 size={15} />}
                      Complete offboarding
                    </button>
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
