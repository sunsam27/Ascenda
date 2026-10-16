'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Ban, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { BlackoutPeriod, LeaveType, Location } from '@ascenda/types';
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

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeLabel(period: BlackoutPeriod): string {
  const start = new Date(`${period.startDate}T00:00:00Z`);
  const end = new Date(`${period.endDate}T00:00:00Z`);
  if (period.startDate === period.endDate) return dateFmt.format(start);
  return `${dateFmt.format(start)} – ${dateFmt.format(end)}`;
}

/** True when today falls within the window (honouring yearly recurrence). */
function activeNow(period: BlackoutPeriod): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (!period.isRecurring) {
    return period.startDate <= today && today <= period.endDate;
  }
  const md = today.slice(5);
  const start = period.startDate.slice(5);
  const end = period.endDate.slice(5);
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

type Draft = {
  name: string;
  startDate: string;
  endDate: string;
  isRecurring: boolean;
  locationId: string;
  leaveTypeId: string;
  reason: string;
};

const currentYear = new Date().getUTCFullYear();

const newDraft = (): Draft => ({
  name: '',
  startDate: `${nowYear()}-01-01`,
  endDate: `${nowYear()}-12-31`,
  isRecurring: false,
  locationId: '',
  leaveTypeId: '',
  reason: '',
});

function nowYear(): number {
  return new Date().getUTCFullYear();
}

function toPayload(d: Draft) {
  return {
    name: d.name.trim(),
    startDate: d.startDate,
    endDate: d.endDate,
    isRecurring: d.isRecurring,
    locationId: d.locationId || null,
    leaveTypeId: d.leaveTypeId || null,
    reason: d.reason.trim() || null,
  };
}

export default function BlackoutPeriodsPanel({
  locations,
  canManage,
}: {
  locations: Location[];
  canManage: boolean;
}) {
  const [periods, setPeriods] = useState<BlackoutPeriod[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(newDraft);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: BlackoutPeriod[] }>('/blackout-periods', {
        params: { pageSize: 200 },
      });
      setPeriods(res.data.data);
      setError('');
    } catch (err) {
      setError(messageFrom(err, 'Could not load blackout periods.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ data: LeaveType[] }>('/leave-types', { params: { activeOnly: false } })
      .then((res) => setTypes(res.data.data))
      .catch(() => {
        // Names simply fall back to "All leave types".
      });
  }, []);

  const typeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of types) map.set(t.id, t.name);
    return map;
  }, [types]);

  const locationName = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of locations) map.set(l.id, l.name);
    return map;
  }, [locations]);

  async function create() {
    const name = draft.name.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/blackout-periods', toPayload(draft));
      setDraft(newDraft());
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not create the blackout period.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const name = edit.name.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/blackout-periods/${id}`, toPayload(edit));
      setEditId(null);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the blackout period.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(period: BlackoutPeriod) {
    const ok = window.confirm(`Delete the blackout period “${period.name}”?`);
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/blackout-periods/${period.id}`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not delete the blackout period.'));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(period: BlackoutPeriod) {
    setEditId(period.id);
    setEdit({
      name: period.name,
      startDate: period.startDate,
      endDate: period.endDate,
      isRecurring: period.isRecurring,
      locationId: period.locationId ?? '',
      leaveTypeId: period.leaveTypeId ?? '',
      reason: period.reason ?? '',
    });
  }

  function fields(value: Draft, setValue: (updater: (prev: Draft) => Draft) => void) {
    return (
      <div className={styles.grid}>
        <div className={styles.gridItem}>
          <label className={styles.label}>Name</label>
          <input
            className={styles.input}
            value={value.name}
            onChange={(e) => setValue((s) => ({ ...s, name: e.target.value }))}
            placeholder="e.g. Year-end close"
            aria-label="Blackout name"
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Starts</label>
          <input
            type="date"
            className={styles.input}
            value={value.startDate}
            onChange={(e) =>
              setValue((s) => ({
                ...s,
                startDate: e.target.value,
                endDate: s.endDate < e.target.value ? e.target.value : s.endDate,
              }))
            }
            aria-label="Blackout start date"
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Ends</label>
          <input
            type="date"
            className={styles.input}
            min={value.startDate}
            value={value.endDate}
            onChange={(e) => setValue((s) => ({ ...s, endDate: e.target.value }))}
            aria-label="Blackout end date"
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Applies to</label>
          <select
            className={styles.select}
            value={value.locationId}
            onChange={(e) => setValue((s) => ({ ...s, locationId: e.target.value }))}
            aria-label="Blackout location"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Leave type</label>
          <select
            className={styles.select}
            value={value.leaveTypeId}
            onChange={(e) => setValue((s) => ({ ...s, leaveTypeId: e.target.value }))}
            aria-label="Blackout leave type"
          >
            <option value="">All leave types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Options</label>
          <div className={styles.badges}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={value.isRecurring}
                onChange={(e) => setValue((s) => ({ ...s, isRecurring: e.target.checked }))}
              />
              Repeats every year
            </label>
          </div>
        </div>
        <div className={`${styles.gridItem} ${styles.gridFull}`}>
          <label className={styles.label}>Reason (optional)</label>
          <input
            className={styles.input}
            value={value.reason}
            onChange={(e) => setValue((s) => ({ ...s, reason: e.target.value }))}
            placeholder="e.g. Peak season — no leave approved"
            aria-label="Blackout reason"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {canManage && (
        <div className={`glass ${styles.inlineForm} ${styles.stackedForm}`}>
          {fields(draft, setDraft)}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${styles.formAction}`}
            onClick={create}
            disabled={busy || !draft.name.trim() || !draft.startDate || !draft.endDate}
          >
            {busy ? <Loader2 className={styles.spin} size={15} /> : <Plus size={16} />}
            Add blackout period
          </button>
          <p className={styles.formHint}>
            Leave that overlaps a blackout is rejected unless an owner or HR administrator
            overrides it.
          </p>
        </div>
      )}

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading…
        </div>
      ) : periods.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <Ban size={22} strokeWidth={2} />
          <p className={styles.messageTitle}>No blackout periods</p>
          <p className={styles.muted}>
            {canManage
              ? 'Block leave during busy windows, e.g. month-end or year-end close.'
              : 'No dates are currently blocked for leave.'}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList} role="list">
          {periods.map((period) => (
            <li
              key={period.id}
              className={`glass ${styles.panelItem} ${
                editId === period.id ? styles.panelItemEditing : ''
              }`}
            >
              {editId === period.id ? (
                <div className={styles.editForm}>
                  {fields(edit, setEdit)}
                  <div className={styles.editActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => saveEdit(period.id)}
                      disabled={busy}
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
                    <span className={styles.panelName}>{period.name}</span>
                    <span className={styles.panelMeta}>
                      {dateFmt.format(new Date(`${period.startDate}T00:00:00Z`))} –{' '}
                      {dateFmt.format(new Date(`${period.endDate}T00:00:00Z`))} ·{' '}
                      {period.locationId
                        ? locationName.get(period.locationId) ?? 'Location'
                        : 'All locations'}{' '}
                      ·{' '}
                      {period.leaveTypeId
                        ? typeName.get(period.leaveTypeId) ?? 'Leave type'
                        : 'All leave types'}
                    </span>
                    <div className={styles.badges}>
                      {activeNow(period) ? (
                        <span className={`${styles.badge} ${styles.badgeWarning}`}>
                          Active now
                        </span>
                      ) : null}
                      {period.isRecurring ? (
                        <span className={`${styles.badge} ${styles.badgePrimary}`}>
                          Recurring
                        </span>
                      ) : null}
                      {period.reason ? (
                        <span className={styles.badge}>{period.reason}</span>
                      ) : null}
                    </div>
                  </div>
                  {canManage && (
                    <div className={styles.panelActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => startEdit(period)}
                        aria-label={`Edit ${period.name}`}
                      >
                        <Pencil size={15} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => remove(period)}
                        disabled={busy}
                        aria-label={`Delete ${period.name}`}
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
