'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DocumentType, WorkerCategory, type Department, type DocumentSummary, type Location, type PaginationMeta } from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './documents.module.css';

type Audience = { departmentId?: string; locationId?: string; category?: WorkerCategory };
type Announcement = { id: string; title: string; body: string; createdAt: string };
type PolicyStatus = { userId: string; name: string; acknowledgedAt?: string };

function errorMessage(error: unknown) {
  const response = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof response === 'string' ? response : Array.isArray(response) ? response.join(', ') : 'This action could not be completed. Please try again.';
}

/** Native modal supplies Escape handling, focus trapping and focus restoration. */
export function DocumentDialog({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={styles.workflowDialog} onCancel={(event) => {
    event.preventDefault(); if (!busy) onClose();
  }} aria-label={title}>
    <div className={styles.drawerHeader}><h2 className={styles.drawerTitle}>{title}</h2>
      <button className={styles.btn} type="button" onClick={onClose} disabled={busy} aria-label="Close dialog">Close</button></div>
    <div className={styles.drawerBody}>{children}</div>
  </dialog>;
}

function AudienceFields({ value, onChange }: { value: Audience; onChange: (value: Audience) => void }) {
  const [kind, setKind] = useState('all');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([api.get<{ data: Department[] }>('/departments'), api.get<{ data: Location[] }>('/locations')])
      .then(([d, l]) => { if (active) { setDepartments(d.data.data); setLocations(l.data.data); } })
      .catch(() => { if (active) setError('Audience lists could not be loaded. Retry before selecting a department or location.'); });
    return () => { active = false; };
  }, []);
  return <>
    <label className={styles.field}><span className={styles.label}>Audience</span>
      <select className={styles.input} value={kind} onChange={(e) => { setKind(e.target.value); onChange({}); }}>
        <option value="all">All active workspace members</option><option value="department">Department</option>
        <option value="location">Location</option><option value="category">Worker category</option>
      </select></label>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {kind !== 'all' && <label className={styles.field}><span className={styles.label}>Choose audience</span>
      <select className={styles.input} required value={value.departmentId ?? value.locationId ?? value.category ?? ''}
        onChange={(e) => onChange(kind === 'department' ? { departmentId: e.target.value } : kind === 'location'
          ? { locationId: e.target.value } : { category: e.target.value as WorkerCategory })}>
        <option value="">Select…</option>
        {kind === 'department' && departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        {kind === 'location' && locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        {kind === 'category' && Object.values(WorkerCategory).map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ').toLowerCase()}</option>)}
      </select></label>}
    <p className={styles.muted}>Recipients are snapshotted at publication. Only active members with a workspace login receive notifications.</p>
  </>;
}

export function DocumentActions({ doc, canManage, onChanged }: { doc: DocumentSummary; canManage: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'edit' | 'publish' | 'report' | null>(null);
  const [name, setName] = useState(doc.name);
  const [expiresAt, setExpiresAt] = useState(doc.expiresAt?.slice(0, 10) ?? '');
  const [audience, setAudience] = useState<Audience>({});
  const [rows, setRows] = useState<PolicyStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function act(kind: 'edit' | 'publish' | 'acknowledge') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (kind === 'edit') await api.patch(`/documents/${doc.id}`, { name, expiresAt: expiresAt ? `${expiresAt}T23:59:59.999Z` : null });
      else await api.post(`/documents/${doc.id}/${kind}`, kind === 'publish' ? audience : {});
      setMode(null); onChanged();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  async function report() {
    setMode('report'); setError(''); setBusy(true);
    try { setRows((await api.get<PolicyStatus[]>(`/documents/${doc.id}/acknowledgements`)).data); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <>
    {canManage && !doc.policyPublishedAt && <button className={styles.btn} type="button" onClick={() => {
      setName(doc.name); setExpiresAt(doc.expiresAt?.slice(0, 10) ?? ''); setError(''); setMode('edit');
    }}>Edit</button>}
    {canManage && doc.type === DocumentType.POLICY && !doc.policyPublishedAt && !doc.workerId &&
      <button className={styles.btn} type="button" onClick={() => { setMode('publish'); setAudience({}); setError(''); }}>Publish policy</button>}
    {canManage && doc.policyPublishedAt && <button className={styles.btn} type="button" onClick={() => void report()}>Acknowledgements</button>}
    {doc.acknowledgementRequired && (doc.acknowledgedAt ? <span className={styles.pill}>Acknowledged</span> :
      <button className={styles.btn} type="button" disabled={busy} onClick={() => {
        if (window.confirm(`Confirm that you have read “${doc.name}”?`)) void act('acknowledge');
      }}>{busy ? 'Saving…' : 'I have read this'}</button>)}
    {error && !mode && <p role="alert" className={styles.error}>{error}</p>}
    {mode && <DocumentDialog title={mode === 'publish' ? 'Publish policy' : mode === 'report' ? 'Policy acknowledgements' : 'Edit document'}
      busy={busy} onClose={() => setMode(null)}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {mode === 'report' ? busy ? <p>Loading…</p> : <>
        <p>{rows.filter((r) => r.acknowledgedAt).length} of {rows.length} acknowledged</p>
        <ul className={styles.reportList}>{rows.map((r) => <li key={r.userId}><strong>{r.name}</strong>
          <span>{r.acknowledgedAt ? `Read ${new Date(r.acknowledgedAt).toLocaleDateString()}` : 'Awaiting acknowledgement'}</span></li>)}</ul>
      </> : <form className={styles.workflowForm} onSubmit={(e) => { e.preventDefault(); void act(mode); }}>
        {mode === 'publish' ? <>
          <p>Publish “{doc.name}” for reading and acknowledgement. Published policies cannot be edited or deleted; upload a new version for changes.</p>
          <AudienceFields value={audience} onChange={setAudience} />
        </> : <>
          <label className={styles.field}><span className={styles.label}>Name</span><input className={styles.input} value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} /></label>
          <label className={styles.field}><span className={styles.label}>Expiry date (optional)</span><input className={styles.input} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
        </>}
        <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>{busy ? 'Saving…' : mode === 'publish' ? 'Publish policy' : 'Save changes'}</button>
      </form>}
    </DocumentDialog>}
  </>;
}

export function AnnouncementsPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await api.get<{ data: Announcement[]; meta: PaginationMeta }>('/documents/announcements', { params: { page } });
      setRows(result.data.data); setMeta(result.data.meta);
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  async function publish() {
    if (busy) return;
    setBusy(true); setError('');
    try { await api.post('/documents/announcements', { title, body, ...audience }); setComposing(false); if (page === 1) await load(); else setPage(1); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <section className={styles.workflowForm} aria-label="Announcements">
    <div className={styles.toolbar}><h2 className={styles.messageTitle}>Announcements</h2>
      {canManage && <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => {
        setTitle(''); setBody(''); setAudience({}); setError(''); setComposing(true);
      }}>Publish announcement</button>}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {loading ? <p>Loading announcements…</p> : rows.length === 0 ? <p className={styles.muted}>No announcements for you yet.</p> :
      rows.map((row) => <article className={`glass ${styles.announcement}`} key={row.id}>
        <h3 className={styles.messageTitle}>{row.title}</h3><time className={styles.muted}>{new Date(row.createdAt).toLocaleDateString()}</time>
        <p className={styles.announcementBody}>{row.body}</p></article>)}
    {meta && meta.totalPages > 1 && <div className={styles.pagerButtons}>
      <button className={styles.btn} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {meta.totalPages}</span>
      <button className={styles.btn} disabled={page >= meta.totalPages || loading} onClick={() => setPage(page + 1)}>Next</button>
    </div>}
    {composing && <DocumentDialog title="Publish announcement" busy={busy} onClose={() => setComposing(false)}>
      <form className={styles.workflowForm} onSubmit={(e) => { e.preventDefault(); void publish(); }}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <label className={styles.field}><span className={styles.label}>Title</span><input className={styles.input} required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className={styles.field}><span className={styles.label}>Message</span><textarea className={styles.input} required maxLength={5000} rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <AudienceFields value={audience} onChange={setAudience} />
        <p className={styles.muted}>This publishes immediately and queues in-app and email delivery. Do not include confidential HR or payroll information.</p>
        <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>{busy ? 'Publishing…' : 'Publish announcement'}</button>
      </form>
    </DocumentDialog>}
  </section>;
}
