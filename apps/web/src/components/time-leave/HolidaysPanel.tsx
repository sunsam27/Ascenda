'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  CalendarOff,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Holiday, Location } from '@ascenda/types';
import { api } from '@/lib/api';
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

const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' });
const monthShortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' });

function formatParts(iso: string): { day: string; month: string; weekday: string } {
  const date = new Date(`${iso}T00:00:00Z`);
  return {
    day: dayFmt.format(date),
    month: monthShortFmt.format(date),
    weekday: weekdayFmt.format(date),
  };
}

export default function HolidaysPanel({
  locations,
  canManage,
}: {
  locations: Location[];
  canManage: boolean;
}) {
  const currentYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(currentYear);
  const [locationFilter, setLocationFilter] = useState('');
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ name: '', date: '', locationId: '', isRecurring: false });
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState(draft);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: Holiday[] }>('/holidays', {
        params: { year, ...(locationFilter ? { locationId: locationFilter } : {}) },
      });
      setHolidays(res.data.data);
      setError('');
    } catch (err) {
      setError(messageFrom(err, 'Could not load the holiday calendar.'));
    } finally {
      setLoading(false);
    }
  }, [year, locationFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const name = draft.name.trim();
    if (!name || !draft.date) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/holidays', {
        name,
        date: draft.date,
        locationId: draft.locationId || undefined,
        isRecurring: draft.isRecurring,
      });
      setDraft({ name: '', date: '', locationId: '', isRecurring: false });
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not create the holiday.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const name = edit.name.trim();
    if (!name || !edit.date) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/holidays/${id}`, {
        name,
        date: edit.date,
        locationId: edit.locationId || null,
        isRecurring: edit.isRecurring,
      });
      setEditId(null);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the holiday.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(holiday: Holiday) {
    const ok = window.confirm(`Delete “${holiday.name}”?`);
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/holidays/${holiday.id}`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not delete the holiday.'));
    } finally {
      setBusy(false);
    }
  }

  function locationName(holiday: Holiday): string {
    if (!holiday.locationId) return 'Organisation-wide';
    return (
      holiday.locationName ??
      locations.find((l) => l.id === holiday.locationId)?.name ??
      'Location'
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.yearNav}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setYear((y) => y - 1)}
            aria-label="Previous year"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <span className={styles.yearLabel}>{year}</span>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setYear((y) => y + 1)}
            aria-label="Next year"
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.toolbarActions}>
          <label className={styles.label} htmlFor="holiday-location-filter">
            Location
          </label>
          <select
            id="holiday-location-filter"
            className={styles.select}
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {canManage && (
        <div className={`glass ${styles.inlineForm}`}>
          <div className={styles.inlineField}>
            <label className={styles.label} htmlFor="new-holiday-name">
              Holiday name
            </label>
            <input
              id="new-holiday-name"
              className={styles.input}
              value={draft.name}
              placeholder="e.g. New Year's Day"
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
            />
          </div>
          <div className={`${styles.inlineField} ${styles.inlineFieldNarrow}`}>
            <label className={styles.label} htmlFor="holiday-date">
              Date
            </label>
            <input
              id="holiday-date"
              type="date"
              className={styles.input}
              value={draft.date}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            />
          </div>
          <div className={styles.inlineField}>
            <label className={styles.label} htmlFor="holiday-location">
              Applies to
            </label>
            <select
              id="holiday-location"
              className={styles.select}
              value={draft.locationId}
              onChange={(e) => setDraft((d) => ({ ...d, locationId: e.target.value }))}
            >
              <option value="">All locations</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={draft.isRecurring}
              onChange={(e) => setDraft((d) => ({ ...d, isRecurring: e.target.checked }))}
            />
            Repeats yearly
          </label>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={create}
            disabled={busy || !draft.name.trim() || !draft.date}
          >
            {busy ? <Loader2 className={styles.spin} size={15} /> : <Plus size={16} />}
            Add
          </button>
        </div>
      )}

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading holidays…
        </div>
      ) : holidays.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <CalendarOff size={28} strokeWidth={1.5} aria-hidden="true" />
          <p className={styles.messageTitle}>No holidays for {year}</p>
          <p className={styles.muted}>
            {canManage
              ? 'Add the public holidays your organisation observes.'
              : 'Nothing has been published for this year yet.'}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList} role="list">
          {holidays.map((holiday) => {
            return (
              <li
                key={holiday.id}
                className={`glass ${styles.panelItem} ${editId === holiday.id ? styles.panelItemEditing : ''}`}
              >
                {editId === holiday.id ? (
                  <div className={styles.editForm}>
                    <div className={styles.grid}>
                      <div className={styles.gridItem}>
                        <label className={styles.label}>Name</label>
                        <input
                          className={styles.input}
                          value={edit.name}
                          onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                          aria-label="Holiday name"
                        />
                      </div>
                      <div className={styles.gridItem}>
                        <label className={styles.label}>Date</label>
                        <input
                          type="date"
                          className={styles.input}
                          value={edit.date}
                          onChange={(e) => setEdit((s) => ({ ...s, date: e.target.value }))}
                          aria-label="Holiday date"
                        />
                      </div>
                      <div className={styles.gridItem}>
                        <label className={styles.label}>Applies to</label>
                        <select
                          className={styles.select}
                          value={edit.locationId}
                          onChange={(e) => setEdit((s) => ({ ...s, locationId: e.target.value }))}
                          aria-label="Holiday location"
                        >
                          <option value="">All locations</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.gridItem}>
                        <label className={styles.label}>Repeats</label>
                        <label className={styles.checkboxRow}>
                          <input
                            type="checkbox"
                            checked={edit.isRecurring}
                            onChange={(e) => setEdit((s) => ({ ...s, isRecurring: e.target.checked }))}
                          />
                          Repeats yearly
                        </label>
                      </div>
                    </div>
                    <div className={styles.editActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => saveEdit(holiday.id)}
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
                    <div className={styles.panelItemMain}>
                      <div className={styles.dateChip} aria-hidden="true">
                        <span className={styles.dateChipDay}>{formatParts(holiday.date).day}</span>
                        <span className={styles.dateChipMonth}>{formatParts(holiday.date).month}</span>
                      </div>
                      <div className={styles.panelItemBody}>
                        <span className={styles.panelName}>{holiday.name}</span>
                        <span className={styles.panelMeta}>
                          {formatParts(holiday.date).weekday} · {locationName(holiday)}
                        </span>
                        {holiday.isRecurring && (
                          <div className={styles.badges}>
                            <span className={`${styles.badge} ${styles.badgePrimary}`}>Repeats yearly</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {canManage && (
                      <div className={styles.panelActions}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => {
                            setEditId(holiday.id);
                            setEdit({
                              name: holiday.name,
                              date: holiday.date,
                              locationId: holiday.locationId ?? '',
                              isRecurring: holiday.isRecurring,
                            });
                          }}
                          aria-label={`Edit ${holiday.name}`}
                        >
                          <Pencil size={15} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => remove(holiday)}
                          disabled={busy}
                          aria-label={`Delete ${holiday.name}`}
                        >
                          <Trash2 size={15} strokeWidth={2} />
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

      {!loading && holidays.length > 0 && (
        <p className={styles.formHint}>
          {holidays.length} holiday{holidays.length === 1 ? '' : 's'} in {year}
          {locationFilter ? ' for the selected location' : ''}.
        </p>
      )}

      {loading && (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading…
        </div>
      )}
    </div>
  );
}
