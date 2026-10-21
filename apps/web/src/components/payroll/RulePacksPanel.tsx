'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { BadgeCheck, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  type CreateStatutoryRulePackDto,
  type StatutoryRule,
  type StatutoryRulePack,
} from '@ascenda/types';
import { api } from '@/lib/api';
import {
  STATUTORY_BASE_OPTIONS,
  STATUTORY_ITEM_TYPE_OPTIONS,
  STATUTORY_KIND_LABEL,
  STATUTORY_KIND_OPTIONS,
  STATUTORY_SIDE_OPTIONS,
  formatDate,
  messageFrom,
} from './payroll-ui';
import styles from './payroll.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

type RuleDraft = {
  code: string;
  label: string;
  kind: StatutoryRule['kind'];
  base: StatutoryRule['base'];
  side: StatutoryRule['side'];
  itemType: StatutoryRule['itemType'];
  amount: string;
  rate: string;
  cap: string;
  bands: { rate: string; upTo: string }[];
};

type PackDraft = {
  country: string;
  version: string;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  rules: RuleDraft[];
};

function newRule(): RuleDraft {
  return {
    code: '',
    label: '',
    kind: 'PERCENT_CAPPED',
    base: 'GROSS',
    side: 'EMPLOYEE',
    itemType: 'TAX',
    amount: '',
    rate: '',
    cap: '',
    bands: [{ rate: '', upTo: '' }],
  };
}

function newPack(): PackDraft {
  return {
    country: '',
    version: '',
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: '',
    isActive: true,
    rules: [newRule()],
  };
}

/** Major-unit string → integer minor units (rules are authored in major units). */
function toMinor(value: string): number | undefined {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

function draftFromPack(pack: StatutoryRulePack): PackDraft {
  return {
    country: pack.country,
    version: pack.version,
    validFrom: pack.validFrom.slice(0, 10),
    validTo: pack.validTo ? pack.validTo.slice(0, 10) : '',
    isActive: pack.isActive,
    rules: pack.rules.map((rule) => ({
      code: rule.code,
      label: rule.label,
      kind: rule.kind,
      base: rule.base,
      side: rule.side,
      itemType: rule.itemType,
      amount: rule.amountMinorUnits != null ? String(rule.amountMinorUnits / 100) : '',
      rate: rule.rateBps != null ? String(rule.rateBps / 100) : '',
      cap: rule.capMinorUnits != null ? String(rule.capMinorUnits / 100) : '',
      bands: (rule.bands ?? [{ rateBps: 0, upToMinorUnits: null }]).map((band) => ({
        rate: String(band.rateBps / 100),
        upTo: band.upToMinorUnits != null ? String(band.upToMinorUnits / 100) : '',
      })),
    })),
  };
}

function rulePayload(rule: RuleDraft): StatutoryRule {
  const base: StatutoryRule = {
    code: rule.code.trim(),
    label: rule.label.trim(),
    kind: rule.kind,
    base: rule.base,
    side: rule.side,
    itemType: rule.itemType,
  };
  if (rule.kind === 'FLAT') {
    base.amountMinorUnits = toMinor(rule.amount) ?? 0;
  } else if (rule.kind === 'PERCENT_CAPPED') {
    base.rateBps = Math.round(Number(rule.rate || '0') * 100);
    const cap = toMinor(rule.cap);
    base.capMinorUnits = cap ?? null;
  } else {
    base.bands = rule.bands.map((band) => ({
      rateBps: Math.round(Number(band.rate || '0') * 100),
      upToMinorUnits: toMinor(band.upTo) ?? null,
    }));
  }
  return base;
}

export default function RulePacksPanel({ canManage }: { canManage: boolean }) {
  const [state, setState] = useState<LoadState>('loading');
  const [packs, setPacks] = useState<StatutoryRulePack[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [editing, setEditing] = useState<{ pack: StatutoryRulePack | null } | null>(null);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{ data: StatutoryRulePack[] }>(
        '/payroll/statutory-rule-packs',
        { params: { pageSize: 100 } },
      );
      setPacks(data.data);
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

  async function setValidated(pack: StatutoryRulePack, validated: boolean) {
    setBusyId(pack.id);
    setError('');
    setNotice('');
    try {
      await api.patch(`/payroll/statutory-rule-packs/${pack.id}/validation`, {
        validated,
      });
      setNotice(
        validated
          ? 'Pack marked as validated by a professional.'
          : 'Validation flag cleared.',
      );
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not update the validation flag.'));
    } finally {
      setBusyId('');
    }
  }

  async function remove(pack: StatutoryRulePack) {
    if (!window.confirm(`Delete rule pack "${pack.version}" for ${pack.country}?`)) return;
    setBusyId(pack.id);
    setError('');
    try {
      await api.delete(`/payroll/statutory-rule-packs/${pack.id}`);
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not delete the pack.'));
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <p className={styles.muted}>
            Statutory rules are data you configure per country. Rates are never
            assumed by the system.
          </p>
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => void load()}>
            <RefreshCw size={15} strokeWidth={2} /> Refresh
          </button>
          {canManage && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setEditing({ pack: null })}
            >
              <Plus size={16} strokeWidth={2.2} /> New rule pack
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
          <Loader2 className={styles.spin} size={16} /> Loading rule packs…
        </div>
      ) : state === 'forbidden' ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Statutory rules are restricted</p>
          <p className={styles.muted}>Your role cannot view statutory rule packs.</p>
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the rule packs.</p>
        </div>
      ) : packs.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>No rule packs yet</p>
          <p className={styles.muted}>
            {canManage
              ? 'Create a pack to describe a country’s statutory deductions.'
              : 'No statutory rule packs have been configured.'}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList}>
          {packs.map((pack) => (
            <li key={pack.id} className={`glass ${styles.panelItem}`}>
              <span className={styles.panelItemBody}>
                <span className={styles.panelName}>
                  {pack.country} · v{pack.version}
                </span>
                <span className={styles.panelMeta}>
                  {pack.rules.length} rule{pack.rules.length === 1 ? '' : 's'} ·
                  in force from {formatDate(pack.validFrom)}
                  {pack.validTo ? ` to ${formatDate(pack.validTo)}` : ''}
                </span>
                <span className={styles.badges}>
                  {pack.isActive ? (
                    <span className={`${styles.badge} ${styles.badgeSuccess}`}>Active</span>
                  ) : (
                    <span className={styles.badge}>Inactive</span>
                  )}
                  {pack.validated ? (
                    <span className={`${styles.badge} ${styles.badgeInfo}`}>
                      <BadgeCheck size={12} strokeWidth={2.4} /> Validated
                    </span>
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeWarning}`}>
                      Not professionally validated
                    </span>
                  )}
                </span>
              </span>
              {canManage && (
                <span className={styles.panelActions}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    title={pack.validated ? 'Clear validation' : 'Mark validated'}
                    aria-label={pack.validated ? 'Clear validation' : 'Mark validated'}
                    onClick={() => void setValidated(pack, !pack.validated)}
                    disabled={busyId === pack.id}
                  >
                    {busyId === pack.id ? (
                      <Loader2 className={styles.spin} size={15} />
                    ) : (
                      <BadgeCheck size={15} strokeWidth={2} />
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Edit"
                    aria-label="Edit rule pack"
                    onClick={() => setEditing({ pack })}
                  >
                    <Pencil size={15} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Delete"
                    aria-label="Delete rule pack"
                    onClick={() => void remove(pack)}
                    disabled={busyId === pack.id}
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
        <PackDrawer
          pack={editing.pack}
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

// ── Pack editor drawer ───────────────────────────────────────────────────────

function PackDrawer({
  pack,
  onClose,
  onSaved,
}: {
  pack: StatutoryRulePack | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<PackDraft>(pack ? draftFromPack(pack) : newPack());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function setRule(index: number, patch: Partial<RuleDraft>) {
    setDraft((d) => ({
      ...d,
      rules: d.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  }

  function setBand(ruleIndex: number, bandIndex: number, patch: Partial<{ rate: string; upTo: string }>) {
    setDraft((d) => ({
      ...d,
      rules: d.rules.map((r, i) =>
        i === ruleIndex
          ? {
              ...r,
              bands: r.bands.map((b, bi) => (bi === bandIndex ? { ...b, ...patch } : b)),
            }
          : r,
      ),
    }));
  }

  async function save() {
    if (!draft.country.trim() || !draft.version.trim() || !draft.validFrom) {
      setError('Country, version and effective-from date are required.');
      return;
    }
    if (draft.country.trim().length !== 2) {
      setError('Country must be a 2-letter ISO code, e.g. NG.');
      return;
    }
    const payload: CreateStatutoryRulePackDto = {
      country: draft.country.trim().toUpperCase(),
      version: draft.version.trim(),
      validFrom: draft.validFrom,
      validTo: draft.validTo || null,
      isActive: draft.isActive,
      rules: draft.rules.map(rulePayload),
    };
    setBusy(true);
    setError('');
    try {
      if (pack) {
        await api.patch(`/payroll/statutory-rule-packs/${pack.id}`, payload);
      } else {
        await api.post('/payroll/statutory-rule-packs', payload);
      }
      onSaved();
    } catch (err) {
      setError(messageFrom(err, 'Could not save the rule pack.'));
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
      <div className={`${styles.drawer} ${styles.drawerWide}`} role="dialog" aria-modal="true" aria-label="Rule pack">
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>{pack ? 'Edit rule pack' : 'New rule pack'}</p>
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
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="pack-country">
                Country code
              </label>
              <input
                id="pack-country"
                className={styles.input}
                placeholder="NG"
                maxLength={2}
                value={draft.country}
                onChange={(e) => setDraft((d) => ({ ...d, country: e.currentTarget.value }))}
              />
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="pack-version">
                Version
              </label>
              <input
                id="pack-version"
                className={styles.input}
                placeholder="2026.1"
                value={draft.version}
                onChange={(e) => setDraft((d) => ({ ...d, version: e.currentTarget.value }))}
              />
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="pack-from">
                Effective from
              </label>
              <input
                id="pack-from"
                type="date"
                className={styles.input}
                value={draft.validFrom}
                onChange={(e) => setDraft((d) => ({ ...d, validFrom: e.currentTarget.value }))}
              />
            </div>
            <div className={styles.gridItem}>
              <label className={styles.label} htmlFor="pack-to">
                Effective to (optional)
              </label>
              <input
                id="pack-to"
                type="date"
                className={styles.input}
                value={draft.validTo}
                onChange={(e) => setDraft((d) => ({ ...d, validTo: e.currentTarget.value }))}
              />
            </div>
            <div className={`${styles.gridItem} ${styles.gridFull}`}>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => setDraft((d) => ({ ...d, isActive: e.currentTarget.checked }))}
                />
                Active (eligible to be applied by a run)
              </label>
            </div>
          </div>

          <span className={styles.sectionLabel}>Rules</span>
          <div className={styles.ruleList}>
            {draft.rules.map((rule, i) => (
              <div key={i} className={styles.ruleCard}>
                <div className={styles.ruleHead}>
                  <span className={styles.panelName}>Rule {i + 1}</span>
                  {draft.rules.length > 1 && (
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          rules: d.rules.filter((_, ri) => ri !== i),
                        }))
                      }
                      aria-label="Remove rule"
                    >
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  )}
                </div>
                <div className={styles.grid}>
                  <div className={styles.gridItem}>
                    <label className={styles.label}>Code</label>
                    <input
                      className={styles.input}
                      placeholder="PAYE"
                      value={rule.code}
                      onChange={(e) => setRule(i, { code: e.currentTarget.value })}
                    />
                  </div>
                  <div className={styles.gridItem}>
                    <label className={styles.label}>Label</label>
                    <input
                      className={styles.input}
                      placeholder="Income tax"
                      value={rule.label}
                      onChange={(e) => setRule(i, { label: e.currentTarget.value })}
                    />
                  </div>
                  <div className={styles.gridItem}>
                    <label className={styles.label}>Kind</label>
                    <select
                      className={styles.select}
                      value={rule.kind}
                      onChange={(e) =>
                        setRule(i, { kind: e.currentTarget.value as RuleDraft['kind'] })
                      }
                    >
                      {STATUTORY_KIND_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {STATUTORY_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.gridItem}>
                    <label className={styles.label}>Base</label>
                    <select
                      className={styles.select}
                      value={rule.base}
                      onChange={(e) =>
                        setRule(i, { base: e.currentTarget.value as RuleDraft['base'] })
                      }
                    >
                      {STATUTORY_BASE_OPTIONS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.gridItem}>
                    <label className={styles.label}>Side</label>
                    <select
                      className={styles.select}
                      value={rule.side}
                      onChange={(e) =>
                        setRule(i, { side: e.currentTarget.value as RuleDraft['side'] })
                      }
                    >
                      {STATUTORY_SIDE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.gridItem}>
                    <label className={styles.label}>Produces</label>
                    <select
                      className={styles.select}
                      value={rule.itemType}
                      onChange={(e) =>
                        setRule(i, { itemType: e.currentTarget.value as RuleDraft['itemType'] })
                      }
                    >
                      {STATUTORY_ITEM_TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  {rule.kind === 'FLAT' && (
                    <div className={`${styles.gridItem} ${styles.gridFull}`}>
                      <label className={styles.label}>Amount (major units)</label>
                      <input
                        className={styles.input}
                        inputMode="decimal"
                        placeholder="5000"
                        value={rule.amount}
                        onChange={(e) => setRule(i, { amount: e.currentTarget.value })}
                      />
                    </div>
                  )}

                  {rule.kind === 'PERCENT_CAPPED' && (
                    <>
                      <div className={styles.gridItem}>
                        <label className={styles.label}>Rate (%)</label>
                        <input
                          className={styles.input}
                          inputMode="decimal"
                          placeholder="8"
                          value={rule.rate}
                          onChange={(e) => setRule(i, { rate: e.currentTarget.value })}
                        />
                      </div>
                      <div className={styles.gridItem}>
                        <label className={styles.label}>Cap (major units, optional)</label>
                        <input
                          className={styles.input}
                          inputMode="decimal"
                          placeholder="—"
                          value={rule.cap}
                          onChange={(e) => setRule(i, { cap: e.currentTarget.value })}
                        />
                      </div>
                    </>
                  )}

                  {rule.kind === 'PERCENT_BANDS' && (
                    <div className={`${styles.gridItem} ${styles.gridFull}`}>
                      <label className={styles.label}>Bands (rate %, up to amount)</label>
                      <div className={styles.ruleList}>
                        {rule.bands.map((band, bi) => (
                          <div key={bi} className={styles.bandRow}>
                            <input
                              className={styles.input}
                              inputMode="decimal"
                              placeholder="rate %"
                              value={band.rate}
                              onChange={(e) => setBand(i, bi, { rate: e.currentTarget.value })}
                            />
                            <input
                              className={styles.input}
                              inputMode="decimal"
                              placeholder="up to (blank = no limit)"
                              value={band.upTo}
                              onChange={(e) => setBand(i, bi, { upTo: e.currentTarget.value })}
                            />
                            <button
                              type="button"
                              className={styles.iconButton}
                              onClick={() =>
                                setRule(i, {
                                  bands: rule.bands.filter((_, x) => x !== bi),
                                })
                              }
                              aria-label="Remove band"
                              disabled={rule.bands.length <= 1}
                            >
                              <Trash2 size={14} strokeWidth={2} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost} ${styles.formAction}`}
                          onClick={() => setRule(i, { bands: [...rule.bands, { rate: '', upTo: '' }] })}
                        >
                          <Plus size={14} strokeWidth={2.2} /> Add band
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost} ${styles.formAction}`}
            onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, newRule()] }))}
          >
            <Plus size={15} strokeWidth={2.2} /> Add rule
          </button>
        </div>
        <div className={styles.drawerActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={busy}>
            {busy && <Loader2 className={styles.spin} size={15} />}
            {pack ? 'Save pack' : 'Create pack'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
