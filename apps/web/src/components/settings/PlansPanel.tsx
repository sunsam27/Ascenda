'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Building2,
  Check,
  CircleCheckBig,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  BillingPeriod,
  type CreatePlanDto,
  type PlanSummary,
  type UpdatePlanDto,
} from '@ascenda/types';
import styles from './PlansPanel.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const planIcons: Record<string, LucideIcon> = {
  free: Sparkles,
  starter: Rocket,
  growth: Zap,
  scale: Building2,
  enterprise: ShieldCheck,
};

const planTilts = [styles.tilt0, styles.tilt1, styles.tilt2];

interface Draft {
  code: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  billingPeriod: BillingPeriod;
  minHeadcount: string;
  maxHeadcount: string;
  maxSeats: string;
  features: string;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY_DRAFT: Draft = {
  code: '',
  name: '',
  description: '',
  price: '0',
  currency: 'NGN',
  billingPeriod: BillingPeriod.ANNUALLY,
  minHeadcount: '',
  maxHeadcount: '',
  maxSeats: '',
  features: '',
  isActive: true,
  sortOrder: '0',
};

function toDraft(plan: PlanSummary): Draft {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description ?? '',
    price: String(plan.priceMinorUnits / 100),
    currency: plan.currency,
    billingPeriod: plan.billingPeriod,
    minHeadcount: plan.minHeadcount != null ? String(plan.minHeadcount) : '',
    maxHeadcount: plan.maxHeadcount != null ? String(plan.maxHeadcount) : '',
    maxSeats: plan.maxSeats != null ? String(plan.maxSeats) : '',
    features: plan.features.join('\n'),
    isActive: plan.isActive,
    sortOrder: String(plan.sortOrder),
  };
}

function optionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function draftToPayload(draft: Draft): CreatePlanDto {
  return {
    code: draft.code.trim().toLowerCase(),
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    priceMinorUnits: Math.round((Number.parseFloat(draft.price) || 0) * 100),
    currency: draft.currency.trim().toUpperCase() || 'NGN',
    billingPeriod: draft.billingPeriod,
    minHeadcount: optionalInt(draft.minHeadcount),
    maxHeadcount: optionalInt(draft.maxHeadcount),
    maxSeats: optionalInt(draft.maxSeats),
    features: draft.features
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean),
    isActive: draft.isActive,
    sortOrder: optionalInt(draft.sortOrder) ?? 0,
  };
}

function formatPrice(plan: PlanSummary): string {
  if (plan.isFree || plan.priceMinorUnits === 0) return 'Free';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: plan.currency,
    minimumFractionDigits: 0,
  }).format(plan.priceMinorUnits / 100);
}

function sizeLabel(plan: PlanSummary): string {
  if (plan.minHeadcount != null && plan.maxHeadcount != null) {
    return `${plan.minHeadcount}–${plan.maxHeadcount} people`;
  }
  if (plan.maxHeadcount == null && plan.minHeadcount != null) {
    return `${plan.minHeadcount}+ people`;
  }
  if (plan.maxSeats) return `Up to ${plan.maxSeats} people`;
  return 'Flexible size';
}

export default function PlansPanel() {
  const [state, setState] = useState<LoadState>('loading');
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load() {
    setState('loading');
    api
      .get<{ data: PlanSummary[] }>('/plans/admin')
      .then(({ data }) => {
        setPlans(data.data);
        setState('ready');
      })
      .catch((err) => {
        setState(
          axios.isAxiosError(err) && err.response?.status === 403
            ? 'forbidden'
            : 'error',
        );
      });
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(plan: PlanSummary) {
    setCreating(false);
    setError('');
    setEditingId(plan.id);
    setDraft(toDraft(plan));
  }

  function startCreate() {
    setEditingId(null);
    setError('');
    setCreating(true);
    setDraft({ ...EMPTY_DRAFT, sortOrder: String(plans.length) });
  }

  function cancel() {
    setEditingId(null);
    setCreating(false);
    setError('');
  }

  async function save(id?: string) {
    if (!draft.name.trim() || !draft.code.trim()) {
      setError('Code and name are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = draftToPayload(draft);
      if (id) {
        const { data } = await api.patch<PlanSummary>(`/plans/${id}`, payload as UpdatePlanDto);
        setPlans((prev) => prev.map((p) => (p.id === id ? data : p)));
      } else {
        const { data } = await api.post<PlanSummary>('/plans', payload);
        setPlans((prev) =>
          [...prev, data].sort((a, b) => a.sortOrder - b.sortOrder),
        );
      }
      cancel();
    } catch (err) {
      setError(messageFrom(err, 'Could not save the plan. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function archive(plan: PlanSummary) {
    const keep = window.confirm(
      `Archive “${plan.name}”? It will stop appearing for new signups; existing subscribers are unaffected.`,
    );
    if (!keep) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.delete<PlanSummary>(`/plans/${plan.id}`);
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? data : p)));
    } catch (err) {
      setError(messageFrom(err, 'Could not archive the plan.'));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return <p className={styles.muted}>Loading plans…</p>;
  }

  if (state === 'forbidden') {
    return (
      <div className={`glass ${styles.message}`}>
        <p className={styles.messageTitle}>Platform administrators only</p>
        <p className={styles.muted}>
          Your account does not have permission to manage plans.
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={`glass ${styles.message}`}>
        <p className={styles.messageTitle}>Something went wrong</p>
        <p className={styles.muted}>We could not load the plans.</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {!creating && (
        <button type="button" className={styles.addButton} onClick={startCreate}>
          <Plus size={16} strokeWidth={2} />
          New plan
        </button>
      )}

      {creating && (
        <PlanEditor
          title="New plan"
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          onCancel={cancel}
          onSave={() => save()}
          onArchive={null}
          showCode
        />
      )}

      <ul className={styles.list} role="list">
        {plans.map((plan, index) => {
          if (editingId === plan.id) {
            return (
              <li key={plan.id}>
                <PlanEditor
                  title={`Edit ${plan.name}`}
                  draft={draft}
                  setDraft={setDraft}
                  busy={busy}
                  onCancel={cancel}
                  onSave={() => save(plan.id)}
                  onArchive={plan.isActive ? () => archive(plan) : null}
                />
              </li>
            );
          }

          const Icon = planIcons[plan.code] ?? Sparkles;
          const tilt = planTilts[index % planTilts.length];

          return (
            <li key={plan.id} className={`glass ${styles.item}`}>
              <div className={styles.itemMain}>
                <div className={styles.itemHeader}>
                  <span
                    className={`${styles.planIcon} ${tilt}`}
                    aria-hidden="true"
                  >
                    <Icon size={20} strokeWidth={2} />
                  </span>
                  <span className={styles.planName}>{plan.name}</span>
                  <span className={styles.planCode}>{plan.code}</span>
                  {plan.isFree && <span className={styles.freeTag}>Free</span>}
                  {!plan.isActive && (
                    <span className={styles.archivedTag}>Archived</span>
                  )}
                </div>
                <p className={styles.priceRow}>
                  <span className={styles.price}>{formatPrice(plan)}</span>
                  {!plan.isFree && (
                    <span className={styles.period}>
                      {plan.billingPeriod === BillingPeriod.ANNUALLY
                        ? '/ year'
                        : '/ month'}
                    </span>
                  )}
                  <span className={styles.dot}>·</span>
                  <span className={styles.size}>{sizeLabel(plan)}</span>
                </p>
                {plan.features.length > 0 && (
                  <ul className={styles.features} role="list">
                    {plan.features.map((feature) => (
                      <li key={feature}>
                        <CircleCheckBig
                          size={15}
                          strokeWidth={2.2}
                          aria-hidden="true"
                        />
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={() => startEdit(plan)}
                  disabled={busy}
                >
                  <Pencil size={15} strokeWidth={2} />
                  {plan.isActive ? 'Edit' : 'Edit / activate'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlanEditor({
  title,
  draft,
  setDraft,
  busy,
  onCancel,
  onSave,
  onArchive,
  showCode,
}: {
  title: string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
  onArchive: (() => void) | null;
  showCode?: boolean;
}) {
  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft({ ...draft, [key]: value });
  }

  return (
    <div className={`glass ${styles.editor}`}>
      <p className={styles.editorTitle}>{title}</p>

      <div className={styles.grid}>
        {showCode && (
          <label className={styles.field}>
            <span className={styles.label}>Code</span>
            <input
              className={styles.input}
              value={draft.code}
              placeholder="starter"
              onChange={(e) => set('code', e.currentTarget.value)}
            />
          </label>
        )}
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={styles.input}
            value={draft.name}
            onChange={(e) => set('name', e.currentTarget.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Price (NGN)</span>
          <input
            className={styles.input}
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => set('price', e.currentTarget.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Billing period</span>
          <select
            className={styles.input}
            value={draft.billingPeriod}
            onChange={(e) =>
              set('billingPeriod', e.currentTarget.value as BillingPeriod)
            }
          >
            <option value={BillingPeriod.ANNUALLY}>Annually</option>
            <option value={BillingPeriod.MONTHLY}>Monthly</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Min headcount</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={draft.minHeadcount}
            onChange={(e) => set('minHeadcount', e.currentTarget.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Max headcount</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={draft.maxHeadcount}
            onChange={(e) => set('maxHeadcount', e.currentTarget.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Max seats</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={draft.maxSeats}
            onChange={(e) => set('maxSeats', e.currentTarget.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Sort order</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={draft.sortOrder}
            onChange={(e) => set('sortOrder', e.currentTarget.value)}
          />
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Description</span>
        <input
          className={styles.input}
          value={draft.description}
          onChange={(e) => set('description', e.currentTarget.value)}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Features (one per line)</span>
        <textarea
          className={styles.textarea}
          rows={4}
          value={draft.features}
          onChange={(e) => set('features', e.currentTarget.value)}
        />
      </label>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => set('isActive', e.currentTarget.checked)}
        />
        Active (visible to new signups)
      </label>

      <div className={styles.editorActions}>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onCancel}
          disabled={busy}
        >
          <X size={15} strokeWidth={2} />
          Cancel
        </button>
        {onArchive && (
          <button
            type="button"
            className={styles.archiveButton}
            onClick={onArchive}
            disabled={busy}
          >
            Archive
          </button>
        )}
        <button
          type="button"
          className={styles.saveButton}
          onClick={onSave}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className={styles.spin} size={15} />
          ) : (
            <Check size={15} strokeWidth={2.5} />
          )}
          Save
        </button>
      </div>
    </div>
  );
}

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}
