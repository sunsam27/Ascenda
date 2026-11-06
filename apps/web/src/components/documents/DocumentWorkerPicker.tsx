'use client';

import { useEffect, useState } from 'react';
import type { PaginationMeta, WorkerSummary } from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './documents.module.css';

export default function DocumentWorkerPicker({ value, onChange, disabled }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<WorkerSummary[]>([]);
  const [selected, setSelected] = useState<WorkerSummary | null>(null);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      api.get<{ data: WorkerSummary[]; meta: PaginationMeta }>('/workers', { params: { page, pageSize: 25, search: search.trim() || undefined } })
        .then(({ data }) => { if (active) { setRows(data.data); setMeta(data.meta); } })
        .catch(() => { if (active) { setRows([]); setError('Worker search failed. Change the search to retry.'); } })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [page, search]);
  const label = (worker: WorkerSummary) => `${worker.firstName} ${worker.lastName} · ${worker.employeeNumber}`;
  return <div className={styles.workflowForm}>
    <label className={styles.field}><span className={styles.label}>Find a worker (optional)</span>
      <input className={styles.input} type="search" value={search} disabled={disabled} placeholder="Search workers…"
        onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label>
    <label className={styles.field}><span className={styles.label}>Linked worker</span>
      <select className={styles.input} value={value} disabled={disabled || loading} onChange={(e) => {
        onChange(e.target.value); setSelected(rows.find((w) => w.id === e.target.value) ?? null);
      }}>
        <option value="">Not linked — visible to authorised administrators only</option>
        {selected && !rows.some((w) => w.id === selected.id) && <option value={selected.id}>{label(selected)}</option>}
        {rows.map((w) => <option key={w.id} value={w.id}>{label(w)}</option>)}
      </select></label>
    {loading && <p role="status">Searching…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {meta && meta.totalPages > 1 && <div className={styles.pagerButtons}>
      <button className={styles.btn} type="button" disabled={disabled || loading || page <= 1} onClick={() => setPage(page - 1)}>Previous workers</button>
      <span>{page} / {meta.totalPages}</span>
      <button className={styles.btn} type="button" disabled={disabled || loading || page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next workers</button>
    </div>}
  </div>;
}
