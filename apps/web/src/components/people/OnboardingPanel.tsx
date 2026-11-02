'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CheckCircle2, Circle, Loader2, RotateCcw, SkipForward } from 'lucide-react';
import type {
  ChecklistTaskSummary,
  OnboardingChecklistSummary,
} from '@ascenda/types';
import { ChecklistTaskStatus, OnboardingStatus } from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './people.module.css';

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

export default function OnboardingPanel({
  t,
}: {
  t: (term: string) => string;
}) {
  const [rows, setRows] = useState<OnboardingChecklistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | OnboardingStatus>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<{
        data: OnboardingChecklistSummary[];
      }>('/talent/onboarding', { params: { pageSize: 100 } });
      setRows(response.data.data);
    } catch (err) {
      setError(messageFrom(err, 'Could not load onboarding checklists.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      filter === 'all'
        ? rows
        : rows.filter((row) => row.status === filter),
    [filter, rows],
  );

  const completed = rows.filter(
    (row) => row.status === OnboardingStatus.COMPLETED,
  ).length;

  async function setTaskStatus(
    row: OnboardingChecklistSummary,
    task: ChecklistTaskSummary,
    status: ChecklistTaskStatus,
  ) {
    setBusyTask(task.id);
    setError('');
    try {
      const response = await api.patch<{ data: OnboardingChecklistSummary }>(
        `/talent/onboarding/tasks/${task.id}`,
        { status },
      );
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? response.data.data : item,
        ),
      );
    } catch (err) {
      setError(messageFrom(err, 'Could not update the onboarding task.'));
    } finally {
      setBusyTask(null);
    }
  }

  return (
    <div className={styles.lifecyclePanel}>
      <div className={styles.lifecycleSummary}>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{rows.length}</span>
          <span className={styles.statLabel}>{t('Employee')} checklists</span>
        </div>
        <div className={`${styles.statChip} ${styles.statValid}`}>
          <span className={styles.statValue}>{completed}</span>
          <span className={styles.statLabel}>Completed</span>
        </div>
        <div className={`${styles.statChip} ${styles.statDuplicate}`}>
          <span className={styles.statValue}>
            {rows.reduce((sum, row) => sum + row.outstandingTasks, 0)}
          </span>
          <span className={styles.statLabel}>Outstanding tasks</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Onboarding filter">
          {(
            [
              ['all', 'All'],
              [OnboardingStatus.IN_PROGRESS, 'In progress'],
              [OnboardingStatus.COMPLETED, 'Completed'],
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
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Loader2 className={styles.spin} size={15} /> : <RotateCcw size={15} />}
          Refresh
        </button>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading onboarding…
        </div>
      ) : visible.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>No onboarding checklists</p>
          <p className={styles.muted}>
            A checklist is created automatically when a {t('Employee').toLowerCase()} is added.
          </p>
        </div>
      ) : (
        <ul className={styles.lifecycleList} role="list">
          {visible.map((row) => (
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
                      {row.jobTitle} · {row.employeeNumber} · starts {formatDate(row.startDate)}
                    </span>
                  </div>
                </div>
                <div className={styles.lifecycleStatus}>
                  <span
                    className={`${styles.status} ${
                      row.status === OnboardingStatus.COMPLETED
                        ? styles.statusActive
                        : styles.statusOnLeave
                    }`}
                  >
                    {row.status === OnboardingStatus.COMPLETED ? 'Completed' : 'In progress'}
                  </span>
                  <span className={styles.progressLabel}>
                    {row.progressPct}% · {row.outstandingTasks} outstanding
                  </span>
                </div>
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
                        disabled={busyTask === task.id}
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
                          {!task.isRequired ? ' · Optional' : ''}
                        </span>
                      </div>
                      {!done && !waived && (
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
