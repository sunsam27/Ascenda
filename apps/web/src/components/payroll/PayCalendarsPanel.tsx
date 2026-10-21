'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { CalendarDays, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  PayFrequency,
  type CreatePayCalendarDto,
  type PayCalendar,
  type PayCalendarPeriod,
} from '@ascenda/types';
import { api } from '@/lib/api';
import {
  PAY_FREQUENCY_LABEL,
  PAY_FREQUENCY_OPTIONS,
  formatDate,
  formatRange,
  messageFrom,
  usesDayOfMonth,
} from './payroll-ui';
import styles from './payroll.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

type CalendarDraft = {
  name: string;
  frequency: PayFrequency;
  dayOfMonth: string;
  dayOfWeek: string;
  cutOffDayOfMonth: string;
  isActive: boolean;
};

function newDraft(): CalendarDraft {
  return {
    name: 'Monthly',
    frequency: PayFrequency.MONTHLY,
    dayOfMonth: '28',
    dayOfWeek: '',
    cutOffDayOfMonth: '25',
    isActive: true,
  };
}

function draftFromCalendar(calendar: PayCalendar): CalendarDraft {
  return {
    name: calendar.name,
    frequency: calendar.frequency,
    dayOfMonth: calendar.dayOfMonth != null ? String(calendar.dayOfMonth) : '',
    dayOfWeek: calendar.dayOfWeek != null ? String(calendar.dayOfWeek) : '',
    cutOffDayOfMonth:
      calendar.cutOffDayOfMonth != null ? String(calendar.cutOffDayOfMonth) : '',
    isActive: calendar.isActive,
  };
}

/** One-line description of how the calendar's periods are generated. */
function scheduleSummary(calendar: PayCalendar): string {
  const parts: string[] = [PAY_FREQUENCY_LABEL[calendar.frequency]];
  if (usesDayOfMonth(calendar.frequency)) {
    if (calendar.dayOfMonth != null) parts.push(`paid on day ${calendar.dayOfMonth}`);
  } else if (calendar.dayOfWeek != null) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    parts.push(`paid each ${days[calendar.dayOfWeek - 1] ?? `day ${calendar.dayOfWeek}`}`);
  }
  if (calendar.cutOffDayOfMonth != null) {
    parts.push(`cut-off day ${calendar.cutOffDayOfMonth}`);
  }
  return parts.join(' · ');
}

export default function PayCalendarsPanel({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<LoadState>('loading');
  const [calendars, setCalendars] = useState<PayCalendar[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [editing, setEditing] = useState<{ calendar: PayCalendar | null } | null>(null);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{ data: PayCalendar[] }>(
        '/payroll/pay-calendars',
        { params: { pageSize: 200 } },
      );
      setCalendars(data.data);
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'forbidden'
          : 'error',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(calendar: PayCalendar) {
    setBusyId(calendar.id);
    setError('');
    setNotice('');
    try {
      await api.patch(`/payroll/pay-calendars/${calendar.id}`, {
        isActive: !calendar.isActive,
      });
      setNotice(
        calendar.isActive
          ? `"${calendar.name}" deactivated — it can no longer be used for new runs.`
          : `"${calendar.name}" activated.`,
      );
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the calendar.'));
    } finally {
      setBusyId('');
    }
  }

  async function remove(calendar: PayCalendar) {
    if (!window.confirm(`Delete pay calendar "${calendar.name}"?`)) return;
    setBusyId(calendar.id);
    setError('');
    setNotice('');
    try {
      await api.delete(`/payroll/pay-calendars/${calendar.id}`);
      setNotice(`"${calendar.name}" deleted.`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not delete the calendar.'));
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <p className={styles.muted}>
            Pay calendars define the periods a pay run can be created for. New
            workspaces start with a default Monthly calendar.
          </p>
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
              onClick={() => setEditing({ calendar: null })}
            >
              <Plus size={16} strokeWidth={2.2} /> New calendar
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
          <Loader2 className={styles.spin} size={16} /> Loading pay calendars…
        </div>
      ) : state === 'forbidden' ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Pay calendars are restricted</p>
          <p className={styles.muted}>
            Your role does not have permission to view pay calendars.
          </p>
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the pay calendars.</p>
        </div>
      ) : calendars.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>No pay calendars yet</p>
          <p className={styles.muted}>
            {canManage
              ? 'Create a calendar to define the periods pay runs align to.'
              : 'No pay calendars have been configured for this organisation.'}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList}>
          {calendars.map((calendar) => (
            <li key={calendar.id} className={`glass ${styles.panelItem}`}>
              <span className={styles.panelItemBody}>
                <span className={styles.panelName}>{calendar.name}</span>
                <span className={styles.panelMeta}>
                  {scheduleSummary(calendar)}
                </span>
                <span className={styles.badges}>
                  {calendar.isActive ? (
                    <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                      Active
                    </span>
                  ) : (
                    <span className={styles.badge}>Inactive</span>
                  )}
                  <span className={styles.badge}>
                    {PAY_FREQUENCY_LABEL[calendar.frequency]}
                  </span>
                </span>
              </span>
              {canManage && (
                <span className={styles.panelActions}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    title={calendar.isActive ? 'Deactivate' : 'Activate'}
                    aria-label={calendar.isActive ? 'Deactivate calendar' : 'Activate calendar'}
                    onClick={() => void toggleActive(calendar)}
                    disabled={busyId === calendar.id}
                  >
                    {busyId === calendar.id ? (
                      <Loader2 className={styles.spin} size={15} />
                    ) : (
                      <CalendarDays size={15} strokeWidth={2} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Edit"
                    aria-label="Edit calendar"
                    onClick={() => setEditing({ calendar })}
                  >
                    <Pencil size={15} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Delete"
                    aria-label="Delete calendar"
                    onClick={() => void remove(calendar)}
                    disabled={busyId === calendar.id}
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CalendarDrawer
          calendar={editing.calendar}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── Calendar editor drawer ───────────────────────────────────────────────────

function CalendarDrawer({
  calendar,
  onClose,
  onSaved,
}: {
  calendar: PayCalendar | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<CalendarDraft>(
    calendar ? draftFromCalendar(calendar) : newDraft(),
  );
  const [preview, setPreview] = useState<PayCalendarPeriod[]>([]);
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const dayOfMonthBased = usesDayOfMonth(draft.frequency);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Preview the periods this calendar would generate for the current year.
  // Only meaningful for an existing calendar (periods are derived server-side).
  useEffect(() => {
    if (!calendar) {
      setPreview([]);
      setPreviewError('');
      return;
    }
    const year = new Date().getFullYear();
    api
      .get<{ data: PayCalendarPeriod[] }>(
        `/payroll/pay-calendars/${calendar.id}/periods`,
        { params: { year } },
      )
      .then((res) => {
        setPreview(res.data.data.slice(0, 6));
        setPreviewError('');
      })
      .catch(() => {
        setPreview([]);
        setPreviewError('Could not load a period preview.');
      });
  }, [calendar]);

  async function save() {
    if (!draft.name.trim()) {
      setError('A calendar name is required.');
      return;
    }
    const payload: CreatePayCalendarDto = {
      name: draft.name.trim(),
      frequency: draft.frequency,
      dayOfMonth: dayOfMonthBased ? Number(draft.dayOfMonth) || undefined : undefined,
      dayOfWeek: dayOfMonthBased ? undefined : Number(draft.dayOfWeek) || undefined,
      cutOffDayOfMonth: draft.cutOffDayOfMonth
        ? Number(draft.cutOffDayOfMonth)
        : undefined,
      isActive: draft.isActive,
    };
    setBusy(true);
    setError('');
    try {
      if (calendar) {
        await api.patch(`/payroll/pay-calendars/${calendar.id}`, payload);
      } else {
        await api.post('/payroll/pay-calendars', payload);
      }
      onSaved();
    } catch (err) {
      setError(messageFrom(err, 'Could not save the calendar.'));
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
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="Pay calendar">
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>
            {calendar ? 'Edit pay calendar' : 'New pay calendar'}
          </p>
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
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.label} htmlFor="cal-name">
                Name
              </label>
              <input
                id="cal-name"
                className={styles.input}
                placeholder="Monthly"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.currentTarget.value }))}
              />
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="cal-frequency">
                Frequency
              </label>
              <select
                id="cal-frequency"
                className={styles.select}
                value={draft.frequency}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    frequency: e.currentTarget.value as PayFrequency,
                  }))
                }
              >
                {PAY_FREQUENCY_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {PAY_FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </select>
            </div>
            {dayOfMonthBased ? (
              <div className={styles.gridItem}>
                <label className={styles.label} htmlFor="cal-dom">
                  Pay day of month (1–31)
                </label>
                <input
                  id="cal-dom"
                  className={styles.input}
                  inputMode="numeric"
                  placeholder="28"
                  value={draft.dayOfMonth}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, dayOfMonth: e.currentTarget.value }))
                  }
                />
              </div>
            ) : (
              <div className={styles.gridItem}>
                <label className={styles.label} htmlFor="cal-dow">
                  Pay day of week
                </label>
                <select
                  id="cal-dow"
                  className={styles.select}
                  value={draft.dayOfWeek}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, dayOfWeek: e.currentTarget.value }))
                  }
                >
                  <option value="">Select a day…</option>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => (
                    <option key={label} value={String(i + 1)}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="cal-cutoff">
                Cut-off day of month (optional)
              </label>
              <input
                id="cal-cutoff"
                className={styles.input}
                inputMode="numeric"
                placeholder="25"
                value={draft.cutOffDayOfMonth}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, cutOffDayOfMonth: e.currentTarget.value }))
                }
              />
              <span className={styles.formHint}>
                Changes after this day wait for the next period.
              </span>
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, isActive: e.currentTarget.checked }))
                  }
                />
                Active (available for new pay runs)
              </label>
            </div>
          </div>

          {calendar && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>
                Period preview · {new Date().getFullYear()}
              </span>
              {previewError ? (
                <p className={styles.muted}>{previewError}</p>
              ) : preview.length === 0 ? (
                <p className={styles.muted}>No periods to preview.</p>
              ) : (
                <ul className={styles.panelList}>
                  {preview.map((p) => (
                    <li
                      key={`${p.periodStart}|${p.periodEnd}`}
                      className={`glass ${styles.panelItem}`}
                    >
                      <span className={styles.panelItemBody}>
                        <span className={styles.panelName}>
                          {formatRange(p.periodStart, p.periodEnd)}
                        </span>
                        <span className={styles.panelMeta}>
                          paid {formatDate(p.payDate)}
                        </span>
                      </span>
                      {p.beforeCutOff && (
                        <span className={`${styles.badge} ${styles.badgeInfo}`}>
                          Before cut-off
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className={styles.drawerActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={busy}>
            {busy && <Loader2 className={styles.spin} size={15} />}
            {calendar ? 'Save calendar' : 'Create calendar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
