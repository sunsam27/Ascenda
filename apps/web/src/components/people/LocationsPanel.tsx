'use client';

import { useState } from 'react';
import axios from 'axios';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Location } from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './people.module.css';

interface Draft {
  name: string;
  city: string;
  country: string;
}

const EMPTY: Draft = { name: '', city: '', country: '' };

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function locationMeta(location: Location): string {
  return [location.city, location.country].filter(Boolean).join(', ');
}

export default function LocationsPanel({
  locations,
  onChanged,
  t,
}: {
  locations: Location[];
  onChanged: () => void;
  t: (term: string) => string;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    const name = draft.name.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/locations', {
        name,
        city: draft.city.trim() || undefined,
        country: draft.country.trim() || undefined,
      });
      setDraft(EMPTY);
      onChanged();
    } catch (err) {
      setError(messageFrom(err, 'Could not create the location.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const name = editValue.name.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/locations/${id}`, {
        name,
        city: editValue.city.trim(),
        country: editValue.country.trim(),
      });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the location.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(location: Location) {
    const ok = window.confirm(
      `Delete ${location.name}? Locations with workers assigned cannot be deleted.`,
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/locations/${location.id}`);
      onChanged();
    } catch (err) {
      setError(messageFrom(err, 'Could not delete the location.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.panel}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={`glass ${styles.inlineForm}`}>
        <div className={styles.inlineField}>
          <label className={styles.label} htmlFor="new-location">
            New {t('Location')}
          </label>
          <input
            id="new-location"
            className={styles.input}
            value={draft.name}
            placeholder="e.g. Lagos HQ"
            onChange={(e) =>
              setDraft((d) => ({ ...d, name: e.currentTarget.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
        </div>
        <div className={styles.inlineField}>
          <label className={styles.label} htmlFor="new-location-city">
            City
          </label>
          <input
            id="new-location-city"
            className={styles.input}
            value={draft.city}
            onChange={(e) =>
              setDraft((d) => ({ ...d, city: e.currentTarget.value }))
            }
          />
        </div>
        <div className={styles.inlineField}>
          <label className={styles.label} htmlFor="new-location-country">
            Country
          </label>
          <input
            id="new-location-country"
            className={styles.input}
            value={draft.country}
            onChange={(e) =>
              setDraft((d) => ({ ...d, country: e.currentTarget.value }))
            }
          />
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={create}
          disabled={busy || !draft.name.trim()}
        >
          {busy ? <Loader2 className={styles.spin} size={15} /> : <Plus size={16} />}
          Add
        </button>
      </div>

      {locations.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.muted}>No {t('Location').toLowerCase()}s yet.</p>
        </div>
      ) : (
        <ul className={styles.panelList} role="list">
          {locations.map((location) => (
            <li key={location.id} className={`glass ${styles.panelItem}`}>
              {editingId === location.id ? (
                <>
                  <div className={styles.inlineField}>
                    <input
                      className={styles.input}
                      value={editValue.name}
                      onChange={(e) =>
                        setEditValue((d) => ({
                          ...d,
                          name: e.currentTarget.value,
                        }))
                      }
                      aria-label={`Rename ${location.name}`}
                    />
                  </div>
                  <div className={styles.inlineField}>
                    <input
                      className={styles.input}
                      value={editValue.city}
                      placeholder="City"
                      onChange={(e) =>
                        setEditValue((d) => ({
                          ...d,
                          city: e.currentTarget.value,
                        }))
                      }
                    />
                  </div>
                  <div className={styles.inlineField}>
                    <input
                      className={styles.input}
                      value={editValue.country}
                      placeholder="Country"
                      onChange={(e) =>
                        setEditValue((d) => ({
                          ...d,
                          country: e.currentTarget.value,
                        }))
                      }
                    />
                  </div>
                  <div className={styles.panelActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => saveEdit(location.id)}
                      disabled={busy}
                      aria-label="Save"
                    >
                      <Check size={15} strokeWidth={2.4} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                      aria-label="Cancel"
                    >
                      <X size={15} strokeWidth={2.4} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.panelItemMain}>
                    <span className={styles.panelName}>{location.name}</span>
                    {locationMeta(location) && (
                      <span className={styles.panelMeta}>
                        {locationMeta(location)}
                      </span>
                    )}
                  </div>
                  <div className={styles.panelActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => {
                        setEditingId(location.id);
                        setEditValue({
                          name: location.name,
                          city: location.city ?? '',
                          country: location.country ?? '',
                        });
                      }}
                      aria-label={`Edit ${location.name}`}
                    >
                      <Pencil size={15} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => remove(location)}
                      disabled={busy}
                      aria-label={`Delete ${location.name}`}
                    >
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
