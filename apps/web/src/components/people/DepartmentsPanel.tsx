'use client';

import { useState } from 'react';
import axios from 'axios';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Department } from '@ascenda/types';
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

export default function DepartmentsPanel({
  departments,
  onChanged,
  t,
}: {
  departments: Department[];
  onChanged: () => void;
  t: (term: string) => string;
}) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/departments', { name });
      setDraft('');
      onChanged();
    } catch (err) {
      setError(messageFrom(err, 'Could not create the department.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const name = editValue.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/departments/${id}`, { name });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the department.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(department: Department) {
    const ok = window.confirm(
      `Delete ${department.name}? Departments with workers assigned cannot be deleted.`,
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/departments/${department.id}`);
      onChanged();
    } catch (err) {
      setError(messageFrom(err, 'Could not delete the department.'));
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
          <label className={styles.label} htmlFor="new-department">
            New {t('Department')}
          </label>
          <input
            id="new-department"
            className={styles.input}
            value={draft}
            placeholder={`e.g. ${t('Department') === 'Department' ? 'Finance' : 'Worship'}`}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
          />
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={create}
          disabled={busy || !draft.trim()}
        >
          {busy ? <Loader2 className={styles.spin} size={15} /> : <Plus size={16} />}
          Add
        </button>
      </div>

      {departments.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.muted}>
            No {t('Department').toLowerCase()}s yet.
          </p>
        </div>
      ) : (
        <ul className={styles.panelList} role="list">
          {departments.map((department) => (
            <li key={department.id} className={`glass ${styles.panelItem}`}>
              {editingId === department.id ? (
                <>
                  <input
                    className={styles.input}
                    value={editValue}
                    onChange={(e) => setEditValue(e.currentTarget.value)}
                    aria-label={`Rename ${department.name}`}
                  />
                  <div className={styles.panelActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => saveEdit(department.id)}
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
                    <span className={styles.panelName}>{department.name}</span>
                  </div>
                  <div className={styles.panelActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => {
                        setEditingId(department.id);
                        setEditValue(department.name);
                      }}
                      aria-label={`Rename ${department.name}`}
                    >
                      <Pencil size={15} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => remove(department)}
                      disabled={busy}
                      aria-label={`Delete ${department.name}`}
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
