'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CalendarCheck, Loader2, LogIn, LogOut, Trash2 } from 'lucide-react';
import {
  AttendanceStatus,
  type AttendanceSummary,
  type EffectiveWorkSchedule,
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

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  [AttendanceStatus.PRESENT]: 'Present',
  [AttendanceStatus.ABSENT]: 'Absent',
  [AttendanceStatus.LATE]: 'Late',
  [AttendanceStatus.REMOTE]: 'Remote',
  [AttendanceStatus.ON_LEAVE]: 'On leave',
  [AttendanceStatus.HALF_DAY]: 'Half day',
  [AttendanceStatus.OFF_DAY]: 'Off day',
};

const STATUS_TONE: Record<AttendanceStatus, string | undefined> = {
  [AttendanceStatus.PRESENT]: styles.badgeSuccess,
  [AttendanceStatus.ABSENT]: styles.badgeDanger,
  [AttendanceStatus.LATE]: styles.badgeWarning,
  [AttendanceStatus.REMOTE]: styles.badgePrimary,
  [AttendanceStatus.ON_LEAVE]: styles.badgePrimary,
  [AttendanceStatus.HALF_DAY]: styles.badgeWarning,
  [AttendanceStatus.OFF_DAY]: '',
};

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  CLOCK_IN_OUT: 'Clock',
  IMPORT: 'Import',
};

const STATUSES = Object.values(AttendanceStatus);

/** Statuses a manager can pick for a manual entry (OFF_DAY is derived). */
const ENTRY_STATUSES = STATUSES.filter((s) => s !== AttendanceStatus.OFF_DAY);

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' });
const monthShortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function scheduleSummary(schedule: EffectiveWorkSchedule): string {
  const days = schedule.workDays
    .map((d) => WEEKDAY_LABELS[d] ?? '')
    .filter(Boolean)
    .join(', ');
  const scope =
    schedule.scope === 'LOCATION'
      ? schedule.locationName ?? 'Location'
      : 'Organisation default';
  const grace =
    schedule.lateGraceMinutes > 0 ? ` · ${schedule.lateGraceMinutes} min grace` : '';
  return `${days || 'No working days'} · ${schedule.workDayStart}–${schedule.workDayEnd}${grace} · ${scope}`;
}

type Draft = {
  workerId: string;
  date: string;
  status: AttendanceStatus;
  notes: string;
};

const newDraft = (): Draft => ({
  workerId: '',
  date: isoToday(),
  status: AttendanceStatus.PRESENT,
  notes: '',
});

export default function AttendancePanel({
  canRecord,
  canDelete,
  canClock,
}: {
  canRecord: boolean;
  canDelete: boolean;
  canClock: boolean;
}) {
  const { user } = useCurrentUser();
  const [records, setRecords] = useState<AttendanceSummary[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [schedule, setSchedule] = useState<EffectiveWorkSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [clockBusy, setClockBusy] = useState(false);
  const [todayRecord, setTodayRecord] = useState<AttendanceSummary | null>(null);
  const [error, setError] = useState('');

  const [from, setFrom] = useState(isoMonthStart);
  const [to, setTo] = useState(isoToday);
  const [statusFilter, setStatusFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');

  const [draft, setDraft] = useState<Draft>(newDraft);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: AttendanceSummary[] }>('/attendance', {
        params: {
          from: from || undefined,
          to: to || undefined,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(workerFilter ? { workerId: workerFilter } : {}),
          pageSize: 200,
        },
      });
      setRecords(res.data.data);
      setError('');
    } catch (err) {
      setError(messageFrom(err, 'Could not load attendance.'));
    } finally {
      setLoading(false);
    }
  }, [from, to, statusFilter, workerFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ data: EffectiveWorkSchedule }>('/attendance/schedule')
      .then((res) => setSchedule(res.data.data))
      .catch(() => {
        // Schedule is informational; roles without access just don't see it.
      });
  }, []);

  useEffect(() => {
    if (!canRecord && !canClock) return;
    let active = true;
    fetchAllWorkers()
      .then((rows) => {
        if (active) setWorkers(rows.filter(isSelectableWorker));
      })
      .catch(() => {
        // The person pickers simply stay empty.
      });
    return () => {
      active = false;
    };
  }, [canRecord, canClock]);

  const selfWorker = useMemo(
    () => workers.find((w) => w.userId === user?.sub) ?? null,
    [workers, user?.sub],
  );

  const loadToday = useCallback(async () => {
    if (!canClock || !selfWorker) {
      setTodayRecord(null);
      return;
    }
    const today = isoToday();
    try {
      const res = await api.get<{ data: AttendanceSummary[] }>('/attendance', {
        params: { workerId: selfWorker.id, from: today, to: today, pageSize: 1 },
      });
      setTodayRecord(res.data.data[0] ?? null);
    } catch {
      setTodayRecord(null);
    }
  }, [canClock, selfWorker]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  async function record() {
    if (!draft.workerId || !draft.date) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/attendance', {
        workerId: draft.workerId,
        date: draft.date,
        status: draft.status,
        notes: draft.notes.trim() || undefined,
      });
      setDraft((d) => ({ ...newDraft(), workerId: d.workerId }));
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not save the attendance record.'));
    } finally {
      setBusy(false);
    }
  }

  async function clockIn() {
    if (!selfWorker) return;
    setClockBusy(true);
    setError('');
    try {
      await api.post('/attendance/clock-in', { workerId: selfWorker.id });
      await Promise.all([loadToday(), load()]);
    } catch (err) {
      setError(messageFrom(err, 'Could not clock in.'));
    } finally {
      setClockBusy(false);
    }
  }

  async function clockOut() {
    if (!selfWorker) return;
    setClockBusy(true);
    setError('');
    try {
      await api.post('/attendance/clock-out', { workerId: selfWorker.id });
      await Promise.all([loadToday(), load()]);
    } catch (err) {
      setError(messageFrom(err, 'Could not clock out.'));
    } finally {
      setClockBusy(false);
    }
  }

  function clockSummary(): string {
    if (!todayRecord || (!todayRecord.clockIn && !todayRecord.clockOut)) {
      return 'Not clocked in yet today.';
    }
    const start = todayRecord.clockIn
      ? timeFmt.format(new Date(todayRecord.clockIn))
      : null;
    const end = todayRecord.clockOut
      ? timeFmt.format(new Date(todayRecord.clockOut))
      : null;
    if (start && !end) return `Clocked in at ${start}.`;
    const hours =
      todayRecord.hoursWorked != null
        ? ` · ${todayRecord.hoursWorked.toFixed(2).replace(/\.00$/, '')}h`
        : '';
    return `Clocked in ${start ?? '—'}–${end ?? '—'}${hours}.`;
  }

  async function remove(record: AttendanceSummary) {
    const ok = window.confirm(
      `Delete the ${STATUS_LABELS[record.status].toLowerCase()} record for ${record.workerName} on ${record.date}?`,
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/attendance/${record.id}`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not delete the attendance record.'));
    } finally {
      setBusy(false);
    }
  }

  function timeRange(record: AttendanceSummary): string | null {
    const starts = record.clockIn ? timeFmt.format(new Date(record.clockIn)) : '';
    const ends = record.clockOut ? timeFmt.format(new Date(record.clockOut)) : '';
    if (!starts && !ends) return null;
    return `${starts || '—'}–${ends || '—'}`;
  }

  return (
    <div className={styles.panel}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {canClock && selfWorker && (
        <div className={`glass ${styles.clockCard}`}>
          <div className={styles.clockStatus}>
            <p className={styles.messageTitle}>Today</p>
            <p className={styles.muted}>{clockSummary()}</p>
          </div>
          <div className={styles.clockActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={clockIn}
              disabled={clockBusy || Boolean(todayRecord?.clockIn)}
            >
              {clockBusy ? (
                <Loader2 className={styles.spin} size={15} />
              ) : (
                <LogIn size={16} />
              )}
              Clock in
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={clockOut}
              disabled={
                clockBusy || !todayRecord?.clockIn || Boolean(todayRecord?.clockOut)
              }
            >
              <LogOut size={16} />
              Clock out
            </button>
          </div>
        </div>
      )}

      {schedule && (
        <div className={`glass ${styles.message}`}>
          <CalendarCheck size={22} strokeWidth={1.6} aria-hidden="true" />
          <p className={styles.messageTitle}>Work schedule</p>
          <p className={styles.muted}>{scheduleSummary(schedule)}</p>
        </div>
      )}

      {canRecord && (
        <div className={`glass ${styles.inlineForm} ${styles.stackedForm}`}>
          <div className={styles.grid}>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="attendance-worker">
                Person
              </label>
              <select
                id="attendance-worker"
                className={styles.select}
                value={draft.workerId}
                onChange={(e) => setDraft((d) => ({ ...d, workerId: e.target.value }))}
              >
                <option value="">Select a person…</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.firstName} {w.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label}>Date</label>
              <input
                type="date"
                className={styles.input}
                value={draft.date}
                onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                aria-label="Attendance date"
              />
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label}>Status</label>
              <select
                className={styles.select}
                value={draft.status}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, status: e.target.value as AttendanceStatus }))
                }
                aria-label="Attendance status"
              >
                {ENTRY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label}>Notes</label>
              <input
                className={styles.input}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Optional"
                aria-label="Attendance notes"
              />
            </div>
          </div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${styles.formAction}`}
            onClick={record}
            disabled={busy || !draft.workerId || !draft.date}
          >
            {busy ? <Loader2 className={styles.spin} size={15} /> : <CalendarCheck size={16} />}
            Save record
          </button>
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.gridItem}>
          <label className={styles.label} htmlFor="attendance-from">
            From
          </label>
          <input
            id="attendance-from"
            type="date"
            className={styles.input}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label} htmlFor="attendance-to">
            To
          </label>
          <input
            id="attendance-to"
            type="date"
            className={styles.input}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label} htmlFor="attendance-status">
            Status
          </label>
          <select
            id="attendance-status"
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
        {canRecord && (
          <div className={styles.gridItem}>
            <label className={styles.label} htmlFor="attendance-worker-filter">
              Worker
            </label>
            <select
              id="attendance-worker-filter"
              className={styles.select}
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
            >
              <option value="">All workers</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.firstName} {w.lastName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading attendance…
        </div>
      ) : records.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <CalendarCheck size={28} strokeWidth={1.5} aria-hidden="true" />
          <p className={styles.messageTitle}>No attendance records</p>
          <p className={styles.muted}>
            {canRecord
              ? 'Record attendance for your team, or widen the date range.'
              : 'Nothing has been recorded for this period yet.'}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList} role="list">
          {records.map((record) => {
            const date = new Date(`${record.date}T00:00:00Z`);
            const hours =
              record.hoursWorked != null
                ? `${record.hoursWorked.toFixed(2).replace(/\.00$/, '')}h`
                : null;
            const range = timeRange(record);
            return (
              <li key={record.id} className={`glass ${styles.panelItem}`}>
                <div className={styles.panelItemMain}>
                  <div className={styles.dateChip} aria-hidden="true">
                    <span className={styles.dateChipDay}>{dayFmt.format(date)}</span>
                    <span className={styles.dateChipMonth}>{monthShortFmt.format(date)}</span>
                  </div>
                  <div className={styles.panelItemBody}>
                    <span className={styles.panelName}>
                      {record.workerName || 'Worker'}
                    </span>
                    <span className={styles.panelMeta}>
                      {weekdayFmt.format(date)} · {SOURCE_LABELS[record.source] ?? record.source}
                      {range ? ` · ${range}` : ''}
                      {hours ? ` · ${hours}` : ''}
                    </span>
                    <div className={styles.badges}>
                      <span className={`${styles.badge} ${STATUS_TONE[record.status] ?? ''}`}>
                        {STATUS_LABELS[record.status]}
                      </span>
                      {record.notes && (
                        <span className={styles.badge}>{record.notes}</span>
                      )}
                    </div>
                  </div>
                </div>
                {canDelete && (
                  <div className={styles.panelActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => remove(record)}
                      disabled={busy}
                      aria-label={`Delete record for ${record.workerName} on ${record.date}`}
                    >
                      <Trash2 size={15} strokeWidth={2} />
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
