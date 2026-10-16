'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Check, Clock, Loader2, Pencil, X } from 'lucide-react';
import type { EffectiveWorkSchedule, Location } from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './time-leave.module.css';

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const GRACE_MAX = 240;

type ScheduleForm = {
  workDays: number[];
  workDayStart: string;
  workDayEnd: string;
  lateGraceMinutes: string;
};

const DEFAULT_FORM: ScheduleForm = {
  workDays: [1, 2, 3, 4, 5],
  workDayStart: '09:00',
  workDayEnd: '17:00',
  lateGraceMinutes: '0',
};

function toMinutes(hhmm: string): number {
  const parts = hhmm.split(':').map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function formError(form: ScheduleForm): string | null {
  if (form.workDays.length === 0) return 'Choose at least one working day.';
  if (!TIME_RE.test(form.workDayStart) || !TIME_RE.test(form.workDayEnd)) {
    return 'Enter valid start and end times.';
  }
  if (toMinutes(form.workDayEnd) <= toMinutes(form.workDayStart)) {
    return 'The end time must be after the start time.';
  }
  const grace = Number(form.lateGraceMinutes);
  if (!Number.isInteger(grace) || grace < 0 || grace > GRACE_MAX) {
    return `Late grace must be a whole number of minutes (0–${GRACE_MAX}).`;
  }
  return null;
}

function overrides(loc: Location): boolean {
  return (
    (loc.workDays?.length ?? 0) > 0 ||
    loc.workDayStart != null ||
    loc.workDayEnd != null ||
    loc.lateGraceMinutes != null
  );
}

export default function WorkSchedulePanel({
  canManage,
  canManageOrg,
}: {
  canManage: boolean;
  canManageOrg: boolean;
}) {
  const [org, setOrg] = useState<ScheduleForm>(DEFAULT_FORM);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editId, setEditId] = useState<string | null>(null);
  const [editOverride, setEditOverride] = useState(false);
  const [edit, setEdit] = useState<ScheduleForm>(DEFAULT_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [schedule, locs] = await Promise.all([
        api.get<{ data: EffectiveWorkSchedule }>('/attendance/schedule'),
        api.get<{ data: Location[] }>('/locations'),
      ]);
      const s = schedule.data.data;
      setOrg({
        workDays: s.workDays,
        workDayStart: s.workDayStart,
        workDayEnd: s.workDayEnd,
        lateGraceMinutes: String(s.lateGraceMinutes),
      });
      setLocations(locs.data.data);
      setError('');
    } catch (err) {
      setError(messageFrom(err, 'Could not load the work schedule.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleDay(form: ScheduleForm, day: number): ScheduleForm {
    const workDays = form.workDays.includes(day)
      ? form.workDays.filter((d) => d !== day)
      : [...form.workDays, day].sort((a, b) => a - b);
    return { ...form, workDays };
  }

  async function saveOrg() {
    if (formError(org)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.patch('/organisations', {
        workDays: org.workDays,
        workDayStart: org.workDayStart,
        workDayEnd: org.workDayEnd,
        lateGraceMinutes: Number(org.lateGraceMinutes),
      });
      setNotice('Organisation default saved.');
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not save the organisation default.'));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(loc: Location) {
    const overriding = overrides(loc);
    setEditId(loc.id);
    setEditOverride(overriding);
    setEdit({
      workDays: loc.workDays?.length ? loc.workDays : org.workDays,
      workDayStart: loc.workDayStart ?? org.workDayStart,
      workDayEnd: loc.workDayEnd ?? org.workDayEnd,
      lateGraceMinutes: String(loc.lateGraceMinutes ?? Number(org.lateGraceMinutes)),
    });
  }

  async function saveLocation(id: string) {
    if (editOverride && formError(edit)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.patch(`/locations/${id}`, {
        workDays: editOverride ? edit.workDays : [],
        workDayStart: editOverride ? edit.workDayStart : null,
        workDayEnd: editOverride ? edit.workDayEnd : null,
        lateGraceMinutes: editOverride ? Number(edit.lateGraceMinutes) : null,
      });
      setEditId(null);
      setNotice('Location schedule saved.');
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not save the location schedule.'));
    } finally {
      setBusy(false);
    }
  }

  function fields(
    form: ScheduleForm,
    setForm: (updater: (prev: ScheduleForm) => ScheduleForm) => void,
    disabled = false,
  ) {
    return (
      <div className={styles.grid}>
        <div className={`${styles.gridItem} ${styles.gridFull}`}>
          <label className={styles.label}>Working days</label>
          <div className={styles.badges}>
            {WEEKDAYS.map((d) => (
              <label key={d.value} className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={form.workDays.includes(d.value)}
                  disabled={disabled}
                  onChange={() => setForm((prev) => toggleDay(prev, d.value))}
                />
                {d.label}
              </label>
            ))}
          </div>
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Start time</label>
          <input
            type="time"
            className={styles.input}
            value={form.workDayStart}
            disabled={disabled}
            onChange={(e) => setForm((prev) => ({ ...prev, workDayStart: e.target.value }))}
            aria-label="Work day start time"
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>End time</label>
          <input
            type="time"
            className={styles.input}
            value={form.workDayEnd}
            disabled={disabled}
            onChange={(e) => setForm((prev) => ({ ...prev, workDayEnd: e.target.value }))}
            aria-label="Work day end time"
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Late grace (minutes)</label>
          <input
            type="number"
            min={0}
            max={GRACE_MAX}
            step={1}
            className={styles.input}
            value={form.lateGraceMinutes}
            disabled={disabled}
            onChange={(e) => setForm((prev) => ({ ...prev, lateGraceMinutes: e.target.value }))}
            aria-label="Late grace minutes"
          />
        </div>
      </div>
    );
  }

  const orgIssue = formError(org);

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

      <div className={`glass ${styles.inlineForm} ${styles.stackedForm}`}>
        <div className={styles.panelItemBody}>
          <span className={styles.panelName}>Organisation default</span>
          <span className={styles.panelMeta}>
            The schedule every location inherits unless it sets its own override.
          </span>
        </div>
        {fields(org, setOrg, !canManageOrg)}
        {canManageOrg ? (
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.formAction}`}
              onClick={saveOrg}
              disabled={busy || !!orgIssue}
            >
              {busy ? <Loader2 className={styles.spin} size={15} /> : <Check size={16} />}
              Save default
            </button>
            {orgIssue ? <p className={styles.formHint}>{orgIssue}</p> : null}
          </>
        ) : (
          <p className={styles.formHint}>
            Only the organisation owner can change the default schedule.
          </p>
        )}
      </div>

      <div className={styles.panelItemBody}>
        <span className={styles.panelName}>Location overrides</span>
        <span className={styles.panelMeta}>
          A location with an override uses its own working days, hours and grace; otherwise it
          inherits the organisation default.
        </span>
      </div>

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading…
        </div>
      ) : locations.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <Clock size={22} strokeWidth={1.7} />
          <p className={styles.messageTitle}>No locations yet</p>
          <p className={styles.muted}>
            Add a location to give a site its own working hours.
          </p>
        </div>
      ) : (
        <ul className={styles.panelList} role="list">
          {locations.map((loc) => {
            const overriding = overrides(loc);
            const days = overriding && loc.workDays?.length ? loc.workDays : org.workDays;
            const start = loc.workDayStart ?? org.workDayStart;
            const end = loc.workDayEnd ?? org.workDayEnd;
            const grace = loc.lateGraceMinutes ?? Number(org.lateGraceMinutes);
            return (
              <li
                key={loc.id}
                className={`glass ${styles.panelItem} ${
                  editId === loc.id ? styles.panelItemEditing : ''
                }`}
              >
                {editId === loc.id ? (
                  <div className={styles.editForm}>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={editOverride}
                        onChange={(e) => {
                          setEditOverride(e.target.checked);
                          if (e.target.checked) {
                            setEdit((prev) => ({
                              ...prev,
                              workDays: prev.workDays.length ? prev.workDays : org.workDays,
                            }));
                          }
                        }}
                        disabled={!canManage}
                      />
                      Override the organisation schedule for {loc.name}
                    </label>
                    {editOverride && fields(edit, setEdit, !canManage)}
                    <div className={styles.editActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => saveLocation(loc.id)}
                        disabled={busy || (editOverride && !!formError(edit))}
                        aria-label="Save"
                      >
                        <Check size={15} strokeWidth={2.4} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => setEditId(null)}
                        disabled={busy}
                        aria-label="Cancel"
                      >
                        <X size={15} strokeWidth={2.4} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.panelItemBody}>
                      <span className={styles.panelName}>{loc.name}</span>
                      <span className={styles.panelMeta}>
                        {days.map((d) => WEEKDAYS[d - 1]?.label).join(', ')} · {start}–{end} ·{' '}
                        {grace} min grace
                      </span>
                      <div className={styles.badges}>
                        <span
                          className={`${styles.badge} ${
                            overriding ? styles.badgePrimary : ''
                          }`}
                        >
                          {overriding ? 'Custom schedule' : 'Inherits default'}
                        </span>
                      </div>
                    </div>
                    {canManage && (
                      <div className={styles.panelActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => startEdit(loc)}
                          aria-label={`Edit schedule for ${loc.name}`}
                        >
                          <Pencil size={15} strokeWidth={2} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
