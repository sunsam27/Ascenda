'use client';

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Check, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { invalidateOrganisation, useOrganisation } from '@/lib/useOrganisation';
import {
  OrganisationType,
  SystemRole,
  type UpdateOrganisationDto,
} from '@ascenda/types';
import styles from './OrganisationPanel.module.css';

type LoadState = 'loading' | 'ready' | 'error';

const TYPE_LABELS: Record<OrganisationType, string> = {
  [OrganisationType.CHURCH]: 'Church / Faith organisation',
  [OrganisationType.SME]: 'Small or medium business',
  [OrganisationType.NGO]: 'NGO / Non-profit',
  [OrganisationType.SCHOOL]: 'School / Education',
  [OrganisationType.OTHER]: 'Other',
};

/** Common IANA zones for the launch market; the field stays free-text. */
const TIMEZONE_OPTIONS = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/London',
  'America/New_York',
  'UTC',
];

/** Terms organisations most often relabel. */
const TERM_SUGGESTIONS = ['Department', 'Employee', 'Location', 'Manager', 'Team'];

interface Draft {
  name: string;
  type: OrganisationType;
  country: string;
  currency: string;
  timezone: string;
  logoUrl: string;
  terminology: { key: string; value: string }[];
}

function toDraft(org: {
  name: string;
  type: OrganisationType;
  country: string;
  currency: string;
  timezone: string;
  logoUrl?: string | null;
  terminology: Record<string, string>;
}): Draft {
  return {
    name: org.name,
    type: org.type,
    country: org.country,
    currency: org.currency,
    timezone: org.timezone,
    logoUrl: org.logoUrl ?? '',
    terminology: Object.entries(org.terminology ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
  };
}

function draftToPayload(draft: Draft): UpdateOrganisationDto {
  const terminology: Record<string, string> = {};
  for (const { key, value } of draft.terminology) {
    const term = key.trim();
    if (term && value.trim()) terminology[term] = value.trim();
  }
  return {
    name: draft.name.trim(),
    type: draft.type,
    country: draft.country.trim().toUpperCase(),
    currency: draft.currency.trim().toUpperCase(),
    timezone: draft.timezone.trim(),
    logoUrl: draft.logoUrl.trim(),
    terminology,
  };
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

export default function OrganisationPanel() {
  const { user } = useCurrentUser();
  const { organisation, loading } = useOrganisation();
  const [state, setState] = useState<LoadState>('loading');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const canManage = user?.role === SystemRole.OWNER;

  useEffect(() => {
    if (loading) return;
    if (!organisation) {
      setState('error');
      return;
    }
    setDraft(toDraft(organisation));
    setState('ready');
  }, [loading, organisation]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  function setTerm(index: number, patch: Partial<{ key: string; value: string }>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const terminology = prev.terminology.map((term, i) =>
        i === index ? { ...term, ...patch } : term,
      );
      return { ...prev, terminology };
    });
    setSaved(false);
  }

  function addTerm() {
    setDraft((prev) => {
      if (!prev) return prev;
      const used = new Set(prev.terminology.map((t) => t.key.trim()));
      const suggestion = TERM_SUGGESTIONS.find((s) => !used.has(s)) ?? '';
      return {
        ...prev,
        terminology: [...prev.terminology, { key: suggestion, value: '' }],
      };
    });
    setSaved(false);
  }

  function removeTerm(index: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        terminology: prev.terminology.filter((_, i) => i !== index),
      };
    });
    setSaved(false);
  }

  function reset() {
    if (organisation) {
      setDraft(toDraft(organisation));
      setError('');
      setSaved(false);
    }
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('Organisation name is required.');
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(draft.country.trim())) {
      setError('Country must be a two-letter ISO code (e.g. NG).');
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(draft.currency.trim())) {
      setError('Currency must be a three-letter ISO code (e.g. NGN).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch<{ data: unknown }>('/organisations', draftToPayload(draft));
      invalidateOrganisation();
      setSaved(true);
    } catch (err) {
      setError(messageFrom(err, 'Could not save changes. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const readOnly = useMemo(() => !canManage, [canManage]);

  if (state === 'loading' || loading) {
    return <p className={styles.muted}>Loading organisation…</p>;
  }

  if (state === 'error' || !draft) {
    return (
      <div className={`glass ${styles.message}`}>
        <p className={styles.messageTitle}>Something went wrong</p>
        <p className={styles.muted}>We could not load your organisation.</p>
      </div>
    );
  }

  return (
    <div className={`glass ${styles.panel}`}>
      {readOnly && (
        <p className={styles.notice} role="status">
          Only the workspace owner can change organisation settings.
        </p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <fieldset className={styles.fieldset} disabled={readOnly || busy}>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.label}>Organisation name</span>
            <input
              className={styles.input}
              value={draft.name}
              onChange={(e) => set('name', e.currentTarget.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Type</span>
            <select
              className={styles.input}
              value={draft.type}
              onChange={(e) => set('type', e.currentTarget.value as OrganisationType)}
            >
              {Object.values(OrganisationType).map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Country (ISO 3166-1 alpha-2)</span>
            <input
              className={styles.input}
              maxLength={2}
              placeholder="NG"
              value={draft.country}
              onChange={(e) =>
                set('country', e.currentTarget.value.toUpperCase())
              }
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Currency (ISO 4217)</span>
            <input
              className={styles.input}
              maxLength={3}
              placeholder="NGN"
              value={draft.currency}
              onChange={(e) =>
                set('currency', e.currentTarget.value.toUpperCase())
              }
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Timezone (IANA)</span>
            <input
              className={styles.input}
              list="org-timezones"
              placeholder="Africa/Lagos"
              value={draft.timezone}
              onChange={(e) => set('timezone', e.currentTarget.value)}
            />
            <datalist id="org-timezones">
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Logo URL</span>
            <input
              className={styles.input}
              placeholder="https://…"
              value={draft.logoUrl}
              onChange={(e) => set('logoUrl', e.currentTarget.value)}
            />
          </label>
        </div>

        <div className={styles.terms}>
          <div className={styles.termsHeader}>
            <div>
              <p className={styles.termsTitle}>Terminology</p>
              <p className={styles.muted}>
                Relabel common terms for your organisation, e.g. Department →
                Ministry, Employee → Pastor.
              </p>
            </div>
            <button
              type="button"
              className={styles.addTerm}
              onClick={addTerm}
              disabled={readOnly || busy}
            >
              <Plus size={15} strokeWidth={2} />
              Add term
            </button>
          </div>

          {draft.terminology.length === 0 && (
            <p className={styles.muted}>No custom terms yet.</p>
          )}

          <ul className={styles.termList} role="list">
            {draft.terminology.map((term, index) => (
              <li key={index} className={styles.termRow}>
                <input
                  className={styles.input}
                  placeholder="Default term"
                  list="term-suggestions"
                  value={term.key}
                  onChange={(e) => setTerm(index, { key: e.currentTarget.value })}
                />
                <span className={styles.arrow} aria-hidden="true">
                  →
                </span>
                <input
                  className={styles.input}
                  placeholder="Your term"
                  value={term.value}
                  onChange={(e) => setTerm(index, { value: e.currentTarget.value })}
                />
                <button
                  type="button"
                  className={styles.removeTerm}
                  onClick={() => removeTerm(index)}
                  aria-label={`Remove term ${term.key || index + 1}`}
                  disabled={readOnly || busy}
                >
                  <X size={15} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
          <datalist id="term-suggestions">
            {TERM_SUGGESTIONS.map((term) => (
              <option key={term} value={term} />
            ))}
          </datalist>
        </div>
      </fieldset>

      {!readOnly && (
        <div className={styles.actions}>
          {saved && (
            <span className={styles.saved} role="status">
              Changes saved
            </span>
          )}
          <button
            type="button"
            className={styles.resetButton}
            onClick={reset}
            disabled={busy}
          >
            <RotateCcw size={15} strokeWidth={2} />
            Reset
          </button>
          <button
            type="button"
            className={styles.saveButton}
            onClick={save}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className={styles.spin} size={15} />
            ) : (
              <Check size={15} strokeWidth={2.5} />
            )}
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}
