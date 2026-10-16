'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  LeaveStatus,
  type LeaveCalendarEntry,
  type LeaveCalendarView,
  type LeaveType,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
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

const WEEKDAY_COLUMNS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthStart(anchor: Date): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
}

function monthEnd(anchor: Date): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
}

function coversEntry(entry: LeaveCalendarEntry, date: string): boolean {
  return entry.startDate <= date && date <= entry.endDate;
}

function statusTone(status: LeaveStatus): string {
  return (
    (status === LeaveStatus.APPROVED
      ? styles.badgeSuccess
      : styles.badgeWarning) ?? ''
  );
}

export default function TeamCalendarPanel({
  canSeeOthers,
}: {
  canSeeOthers: boolean;
}) {
  const [anchor, setAnchor] = useState(() => monthStart(new Date()));
  const [view, setView] = useState<LeaveCalendarView | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const from = iso(monthStart(anchor));
  const to = iso(monthEnd(anchor));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: LeaveCalendarView }>(
        '/leave-requests/calendar',
        {
          params: {
            from,
            to,
            ...(leaveTypeFilter ? { leaveTypeId: leaveTypeFilter } : {}),
            ...(workerFilter ? { workerId: workerFilter } : {}),
          },
        },
      );
      setView(res.data.data);
      setError('');
    } catch (err) {
      setError(messageFrom(err, 'Could not load the team calendar.'));
    } finally {
      setLoading(false);
    }
  }, [from, to, leaveTypeFilter, workerFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ data: LeaveType[] }>('/leave-types')
      .then((res) => setLeaveTypes(res.data.data))
      .catch(() => {
        // Leave-type labels fall back to the entry's own name.
      });
  }, []);

  useEffect(() => {
    if (!canSeeOthers) return;
    let active = true;
    fetchAllWorkers()
      .then((rows) => {
        if (active) setWorkers(rows.filter(isSelectableWorker));
      })
      .catch(() => {
        // The person filter simply stays empty.
      });
    return () => {
      active = false;
    };
  }, [canSeeOthers]);

  const dayMap = useMemo(() => {
    const map = new Map<string, LeaveCalendarView['days'][number]>();
    for (const day of view?.days ?? []) map.set(day.date, day);
    return map;
  }, [view]);

  const entryMap = useMemo(() => {
    const map = new Map<string, LeaveCalendarEntry>();
    for (const entry of view?.entries ?? []) map.set(entry.requestId, entry);
    return map;
  }, [view]);

  const cells = useMemo(() => {
    const start = monthStart(anchor);
    const offset = (start.getUTCDay() + 6) % 7;
    const gridStart = new Date(start);
    gridStart.setUTCDate(gridStart.getUTCDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart);
      date.setUTCDate(gridStart.getUTCDate() + i);
      return date;
    });
  }, [anchor]);

  const monthIndex = anchor.getUTCMonth();

  const entriesForDay = useCallback(
    (date: string): LeaveCalendarEntry[] =>
      (view?.entries ?? []).filter((entry) => coversEntry(entry, date)),
    [view],
  );

  const visibleEntries = useMemo(() => {
    const entries = view?.entries ?? [];
    if (!selectedDate) return entries;
    return entries.filter((entry) => coversEntry(entry, selectedDate));
  }, [view, selectedDate]);

  function todayIso(): string {
    return iso(new Date());
  }

  function shiftMonth(delta: number) {
    setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + delta, 1)));
    setSelectedDate(null);
  }

  return (
    <div className={styles.panel}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.toolbar}>
        <div className={styles.yearNav}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1)))}
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <span className={styles.monthLabel}>{MONTH_LABEL.format(anchor)}</span>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1)))}
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => setAnchor(monthStart(new Date()))}
          >
            Today
          </button>
        </div>

        <div className={styles.toolbarActions}>
          {canSeeOthers && (
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
        </div>
      </div>

      <div className={styles.calendarLegend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendApproved}`} />
          Approved
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendPending}`} />
          Pending
        </span>
      </div>

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading calendar…
        </div>
      ) : (
        <div className={styles.calendar}>
          <div className={styles.calendarHead}>
            {WEEKDAY_COLUMNS.map((label) => (
              <span key={label} className={styles.calendarHeadCell}>
                {label}
              </span>
            ))}
          </div>
          <div className={styles.calendarGrid}>
            {cells.map((date) => {
              const dateIso = iso(date);
              const day = dayMap.get(dateIso);
              const inMonth = date.getUTCMonth() === anchor.getUTCMonth();
              const isToday = dateIso === iso(new Date());
              const entryIds = day?.requestIds ?? [];
              const entries = entryIds
                .map((id) => entryMap.get(id))
                .filter((e): e is LeaveCalendarEntry => Boolean(e));
              const classNames = [
                styles.calendarCell,
                inMonth ? '' : styles.calendarCellMuted,
                day && !day.isWorkingDay ? styles.calendarCellOff : '',
                isToday ? styles.calendarCellToday : '',
                selectedDate === dateIso ? styles.calendarCellSelected : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={dateIso}
                  type="button"
                  className={classNames}
                  onClick={() =>
                    setSelectedDate((d) => (d === dateIso ? null : dateIso))
                  }
                  disabled={entries.length === 0}
                  aria-label={`${dateIso}${entries.length ? `, ${entries.length} on leave` : ''}`}
                >
                  <span className={styles.calendarDayNum}>{date.getUTCDate()}</span>
                  {entries.length > 0 && (
                    <span className={styles.calendarDots}>
                      {entries.slice(0, 4).map((entry) => (
                        <span
                          key={entry.requestId}
                          className={`${styles.calendarDot} ${
                            entry.status === LeaveStatus.APPROVED
                              ? styles.legendApproved
                              : styles.legendPending
                          }`}
                        />
                      ))}
                    </span>
                  )}
                  {entries.length > 0 && (
                    <span className={styles.calendarCount}>{entries.length}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.calendarEntries}>
        <p className={styles.messageTitle}>
          {selectedDate
            ? `On leave · ${selectedDate}`
            : `Leave this month (${view?.entries.length ?? 0})`}
        </p>
        {(view?.entries ?? []).length === 0 ? (
          <div className={`glass ${styles.message}`}>
            <CalendarDays size={28} strokeWidth={1.5} aria-hidden="true" />
            <p className={styles.messageTitle}>Nothing scheduled</p>
            <p className={styles.muted}>
              No approved or pending leave falls in this month.
            </p>
          </div>
        ) : (
          <ul className={styles.panelList} role="list">
            {(selectedDate
              ? view?.entries.filter((e) => coversEntry(e, selectedDate)) ?? []
              : view?.entries ?? []
            ).map((entry) => {
              const typeName =
                entry.leaveTypeName ??
                leaveTypes.find((t) => t.id === entry.leaveTypeId)?.name ??
                'Leave';
              return (
                <li
                  key={entry.requestId}
                  className={`glass ${styles.panelItem}`}
                >
                  <div className={styles.panelItemMain}>
                    <div className={styles.panelItemBody}>
                      <span className={styles.panelName}>
                        {entry.workerName ?? 'Worker'}
                      </span>
                      <span className={styles.panelMeta}>
                        {typeName} · {entry.startDate}
                        {entry.endDate !== entry.startDate
                          ? ` → ${entry.endDate}`
                          : ''}{' '}
                        · {entry.days} day{entry.days === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <span className={`${styles.badge} ${statusTone(entry.status)}`}>
                    {entry.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
