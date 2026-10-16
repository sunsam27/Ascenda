'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  DocumentType,
  type DocumentSummary,
  type PaginationMeta,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/useCurrentUser';
import styles from './documents.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const PAGE_SIZE = 25;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB, mirrors the API

const TYPE_LABEL: Record<DocumentType, string> = {
  [DocumentType.CONTRACT]: 'Contract',
  [DocumentType.ID_DOCUMENT]: 'ID document',
  [DocumentType.PAYSLIP]: 'Payslip',
  [DocumentType.OFFER_LETTER]: 'Offer letter',
  [DocumentType.POLICY]: 'Policy',
  [DocumentType.CERTIFICATION]: 'Certification',
  [DocumentType.OTHER]: 'Other',
};

const TYPE_ORDER: DocumentType[] = [
  DocumentType.CONTRACT,
  DocumentType.ID_DOCUMENT,
  DocumentType.OFFER_LETTER,
  DocumentType.CERTIFICATION,
  DocumentType.PAYSLIP,
  DocumentType.POLICY,
  DocumentType.OTHER,
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function messageFrom(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] };
    const message = data?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

/** Read a file as bare base64 (no `data:` prefix), as the API expects. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export default function DocumentsView() {
  const { user } = useCurrentUser();
  const [state, setState] = useState<LoadState>('loading');
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [typeFilter, setTypeFilter] = useState<DocumentType | 'all'>('all');
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  // Only organisation-scope roles may upload or delete; self-service roles get
  // a read-only view of their own documents.
  const canManage =
    user?.role === 'OWNER' || user?.role === 'HR_ADMINISTRATOR';

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{
        data: DocumentSummary[];
        meta: PaginationMeta;
      }>('/documents', {
        params: {
          page,
          pageSize: PAGE_SIZE,
          ...(debounced ? { search: debounced } : {}),
          ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
        },
      });
      setDocuments(data.data);
      setMeta(data.meta);
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'forbidden'
          : 'error',
      );
    }
  }, [page, debounced, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(doc: DocumentSummary) {
    const ok = window.confirm(
      `Delete “${doc.name}”? This permanently removes the file.`,
    );
    if (!ok) return;
    setDeletingId(doc.id);
    setActionError('');
    try {
      await api.delete(`/documents/${doc.id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setMeta((prev) => (prev ? { ...prev, total: prev.total - 1 } : prev));
      void load();
    } catch (err) {
      setActionError(messageFrom(err, 'Could not delete the document.'));
    } finally {
      setDeletingId(null);
    }
  }

  if (state === 'loading') {
    return (
      <div className={styles.page}>
        <PageHeader />
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} />
          Loading documents…
        </div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className={styles.page}>
        <PageHeader />
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Documents are restricted</p>
          <p className={styles.muted}>
            Your role does not have permission to view documents.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={styles.page}>
        <PageHeader />
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the documents.</p>
        </div>
      </div>
    );
  }

  const total = meta?.total ?? 0;
  const totalPages = meta?.totalPages ?? 1;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className={`${styles.page} cascade`}>
      <PageHeader />

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.search}>
            <Search className={styles.searchIcon} size={16} strokeWidth={2} />
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search documents…"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              aria-label="Search documents"
            />
          </div>
          <select
            className={styles.select}
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.currentTarget.value as DocumentType | 'all');
              setPage(1);
            }}
            aria-label="Filter by type"
          >
            <option value="all">All types</option>
            {TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
        {canManage && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setUploading(true)}
          >
            <Plus size={16} strokeWidth={2.2} />
            Upload document
          </button>
        )}
      </div>

      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}

      {documents.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <FileText size={28} strokeWidth={1.6} aria-hidden="true" />
          <p className={styles.messageTitle}>
            {debounced || typeFilter !== 'all'
              ? 'No matches'
              : 'No documents yet'}
          </p>
          <p className={styles.muted}>
            {debounced || typeFilter !== 'all'
              ? 'Try a different name or type.'
              : canManage
                ? 'Upload contracts, IDs and certificates to keep them in one place.'
                : 'No documents have been shared with you yet.'}
          </p>
        </div>
      ) : (
        <div className={`glass ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Name</th>
                <th className={styles.th}>Type</th>
                <th className={styles.th}>Worker</th>
                <th className={styles.th}>Size</th>
                <th className={styles.th}>Uploaded</th>
                <th className={styles.th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className={styles.row}>
                  <td className={styles.td}>
                    <div className={styles.docCell}>
                      <span className={styles.docIcon} aria-hidden="true">
                        <FileText size={16} strokeWidth={1.8} />
                      </span>
                      <span className={styles.docName}>{doc.name}</span>
                    </div>
                  </td>
                  <td className={styles.td}>
                    <span className={styles.pill}>
                      {TYPE_LABEL[doc.type] ?? doc.type}
                    </span>
                  </td>
                  <td className={styles.td}>{doc.workerName ?? '—'}</td>
                  <td className={styles.td}>{formatBytes(doc.sizeBytes)}</td>
                  <td className={styles.td}>{formatDate(doc.createdAt)}</td>
                  <td className={`${styles.td} ${styles.colActions}`}>
                    <a
                      className={styles.iconButton}
                      href={doc.downloadUrl}
                      aria-label={`Download ${doc.name}`}
                      title="Download"
                    >
                      <Download size={15} strokeWidth={2} />
                    </a>
                    {canManage && (
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => handleDelete(doc)}
                        disabled={deletingId === doc.id}
                        aria-label={`Delete ${doc.name}`}
                        title="Delete"
                      >
                        {deletingId === doc.id ? (
                          <Loader2 className={styles.spin} size={15} />
                        ) : (
                          <Trash2 size={15} strokeWidth={2} />
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className={styles.pager}>
          <span className={styles.pagerInfo}>
            Showing {from}–{to} of {total}
          </span>
          <div className={styles.pagerButtons}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            setPage(1);
            void load();
          }}
        />
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <h1 className={styles.pageTitle}>Documents</h1>
        <p className={styles.pageSubtitle}>
          Worker contracts, IDs, certificates and policies
        </p>
      </div>
    </div>
  );
}

function UploadDialog({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<DocumentType>(DocumentType.CONTRACT);
  const [workerId, setWorkerId] = useState('');
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .get<{ data: WorkerSummary[] }>('/workers', { params: { pageSize: 100 } })
      .then((res) => setWorkers(res.data.data))
      .catch(() => setWorkers([]));
  }, []);

  function handleFile(selected: File | null) {
    setFile(selected);
    if (selected && !name.trim()) {
      setName(selected.name);
    }
  }

  async function submit() {
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Files must be 8 MB or smaller.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const content = await fileToBase64(file);
      await api.post('/documents', {
        name: name.trim() || file.name,
        type,
        workerId: workerId || undefined,
        mimeType: file.type || 'application/octet-stream',
        content,
      });
      onUploaded();
    } catch (err) {
      setError(messageFrom(err, 'Could not upload the document.'));
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
      <div
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label="Upload document"
      >
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>Upload document</p>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.drawerBody}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <label className={styles.fileDrop}>
            <Upload size={20} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.fileDropText}>
              {file ? file.name : 'Choose a file (max 8 MB)'}
            </span>
            <input
              className={styles.fileInput}
              type="file"
              onChange={(e) => handleFile(e.currentTarget.files?.[0] ?? null)}
            />
          </label>

          <div className={styles.grid}>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>Name</span>
              <input
                className={styles.input}
                value={name}
                placeholder="e.g. Employment Contract.pdf"
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Type</span>
              <select
                className={styles.input}
                value={type}
                onChange={(e) => setType(e.currentTarget.value as DocumentType)}
              >
                {TYPE_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Worker (optional)</span>
              <select
                className={styles.input}
                value={workerId}
                onChange={(e) => setWorkerId(e.currentTarget.value)}
              >
                <option value="">Not linked</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.preferredName?.trim() ||
                      `${worker.firstName} ${worker.lastName}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className={styles.drawerActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={submit}
            disabled={busy || !file}
          >
            {busy ? (
              <>
                <Loader2 className={styles.spin} size={16} />
                Uploading…
              </>
            ) : (
              <>
                <Upload size={16} strokeWidth={2} />
                Upload
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
