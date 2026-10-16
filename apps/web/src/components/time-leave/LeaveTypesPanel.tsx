'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { LeaveTypeCategory } from '@ascenda/types';
import type { LeaveType } from '@ascenda/types';
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

const CATEGORY_LABELS: Record<LeaveTypeCategory, string> = {
  [LeaveTypeCategory.ANNUAL]: 'Annual',
  [LeaveTypeCategory.SICK]: 'Sick',
  [LeaveTypeCategory.MATERNITY]: 'Maternity',
  [LeaveTypeCategory.PATERNITY]: 'Paternity',
  [LeaveTypeCategory.COMPASSIONATE]: 'Compassionate',
  [LeaveTypeCategory.STUDY]: 'Study',
  [LeaveTypeCategory.UNPAID]: 'Unpaid',
  [LeaveTypeCategory.CUSTOM]: 'Custom',
};

const CATEGORIES = Object.values(LeaveTypeCategory);

type Draft = {
  name: string;
  category: LeaveTypeCategory;
  defaultBalance: string;
  isPaid: boolean;
  requiresApproval: boolean;
};

const newDraft = (): Draft => ({
  name: '',
  category: LeaveTypeCategory.ANNUAL,
  defaultBalance: '20',
  isPaid: true,
  requiresApproval: true,
});

export default function LeaveTypesPanel({
  canManage,
  canDelete,
}: {
  canManage: boolean;
  canDelete: boolean;
}) {
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
      const res = await api.get<{ data: LeaveType[] }>('/leave-types');
      setTypes(res.data.data);
      setError('');
    } catch (err) {
      setError(messageFrom(err, 'Could not load leave types.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const name = draft.name.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/leave-types', {
        name,
        category: draft.category,
        defaultBalance: Number(draft.defaultBalance) || 0,
        isPaid: draft.isPaid,
        requiresApproval: draft.requiresApproval,
      });
      setDraft(newDraft());
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not create the leave type.'));
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
      await api.patch(`/leave-types/${id}`, {
        name,
        category: edit.category,
        defaultBalance: Number(edit.defaultBalance) || 0,
        isPaid: edit.isPaid,
        requiresApproval: edit.requiresApproval,
      });
      setEditId(null);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the leave type.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(type: LeaveType) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/leave-types/${type.id}`, { isActive: !type.isActive });
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the leave type.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(type: LeaveType) {
    const ok = window.confirm(
      `Delete “${type.name}”? Leave types already used can only be deactivated.`,
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/leave-types/${type.id}`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not delete the leave type.'));
    } finally {
      setBusy(false);
    }
  }

  function draftFields(value: Draft, setValue: (updater: (prev: Draft) => Draft) => void) {
    return (
      <div className={styles.grid}>
        <div className={styles.gridItem}>
          <label className={styles.label}>Name</label>
          <input
            className={styles.input}
            value={value.name}
            onChange={(e) => setValue((s) => ({ ...s, name: e.target.value }))}
            placeholder="e.g. Annual leave"
            aria-label="Leave type name"
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Category</label>
          <select
            className={styles.select}
            value={value.category}
            onChange={(e) =>
              setValue((s) => ({ ...s, category: e.target.value as LeaveTypeCategory }))
            }
            aria-label="Leave type category"
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Default days per year</label>
          <input
            type="number"
            min={0}
            step={0.5}
            className={styles.input}
            value={value.defaultBalance}
            onChange={(e) => setValue((s) => ({ ...s, defaultBalance: e.target.value }))}
            aria-label="Default balance"
          />
        </div>
        <div className={styles.gridItem}>
          <label className={styles.label}>Options</label>
          <div className={styles.badges}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={value.isPaid}
                onChange={(e) => setValue((s) => ({ ...s, isPaid: e.target.checked }))}
              />
              Paid
            </label>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={value.requiresApproval}
                onChange={(e) => setValue((s) => ({ ...s, requiresApproval: e.target.checked }))}
              />
              Needs approval
            </label>
          </div>
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
          {draftFields(draft, setDraft)}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${styles.formAction}`}
            onClick={create}
            disabled={busy || !draft.name.trim()}
          >
            {busy ? <Loader2 className={styles.spin} size={15} /> : <Plus size={16} />}
            Add leave type
          </button>
        </div>
      )}

      {loading ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading…
        </div>
      ) : types.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>No leave types yet</p>
          <p className={styles.muted}>
            {canManage
              ? 'Add the leave your organisation offers, e.g. annual or sick leave.'
              : 'An administrator has not configured any leave types.'}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList} role="list">
          {types.map((type) => (
            <li
              key={type.id}
              className={`glass ${styles.panelItem} ${editId === type.id ? styles.panelItemEditing : ''}`}
            >
              {editId === type.id ? (
                <div className={styles.editForm}>
                  {draftFields(edit, setEdit)}
                  <div className={styles.editActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => saveEdit(type.id)}
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
                    <span className={styles.panelName}>{type.name}</span>
                    <span className={styles.panelMeta}>
                      {CATEGORY_LABELS[type.category]} · {type.defaultBalance} day
                      {type.defaultBalance === 1 ? '' : 's'}/year
                    </span>
                    <div className={styles.badges}>
                      <span className={`${styles.badge} ${type.isPaid ? styles.badgeSuccess : styles.badgeWarning}`}>
                        {type.isPaid ? 'Paid' : 'Unpaid'}
                      </span>
                      {type.requiresApproval && (
                        <span className={`${styles.badge} ${styles.badgePrimary}`}>Approval</span>
                      )}
                      <span className={`${styles.badge} ${type.isActive ? '' : styles.badgeDanger}`}>
                        {type.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <div className={styles.panelActions}>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => toggleActive(type)}
                        disabled={busy}
                      >
                        {type.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => {
                          setEditId(type.id);
                          setEdit({
                            name: type.name,
                            category: type.category,
                            defaultBalance: String(type.defaultBalance),
                            isPaid: type.isPaid,
                            requiresApproval: type.requiresApproval,
                          });
                        }}
                        aria-label={`Edit ${type.name}`}
                      >
                        <Pencil size={15} strokeWidth={2} />
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => remove(type)}
                          disabled={busy}
                          aria-label={`Delete ${type.name}`}
                        >
                          <Trash2 size={15} strokeWidth={2} />
                        </button>
                      )}
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
