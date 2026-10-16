'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { CheckCircle2, Download, FileUp, Loader2, Upload, X } from 'lucide-react';
import type {
  WorkerImportPreview,
  WorkerImportPreviewRow,
  WorkerImportResult,
} from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './people.module.css';

type Step = 'choose' | 'preview' | 'done';

const TEMPLATE_HEADERS = [
  'Employee Number',
  'First Name',
  'Last Name',
  'Preferred Name',
  'Email',
  'Phone',
  'Category',
  'Employment Type',
  'Status',
  'Job Title',
  'Department',
  'Location',
  'Start Date',
  'End Date',
  'Date of Birth',
  'Gender',
].join(',');

const TEMPLATE_SAMPLE = [
  'EMP-001',
  'Ada',
  'Okafor',
  '',
  'ada.okafor@example.com',
  '08030000000',
  'Employee',
  'Full time',
  'Active',
  'Associate Pastor',
  'Ministry',
  'Lagos HQ',
  '2026-01-05',
  '',
  '1990-06-15',
  'Female',
].join(',');

const STATUS_CLASS: Record<WorkerImportPreviewRow['status'], string | undefined> =
  {
    valid: styles.statusActive,
    duplicate: styles.statusSuspended,
    error: styles.statusTerminated,
  };

const STATUS_LABEL: Record<WorkerImportPreviewRow['status'], string> = {
  valid: 'Ready',
  duplicate: 'Duplicate',
  error: 'Error',
};

function messageFrom(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] })
      ?.message;
    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export default function ImportWorkersDrawer({
  onClose,
  onImported,
  t,
}: {
  onClose: () => void;
  onImported: () => void;
  t: (term: string) => string;
}) {
  const [step, setStep] = useState<Step>('choose');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<WorkerImportPreview | null>(null);
  const [result, setResult] = useState<WorkerImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  function downloadTemplate() {
    const blob = new Blob([`${TEMPLATE_HEADERS}\n${TEMPLATE_SAMPLE}\n`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'worker-import-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
      const { data } = await api.post<{ data: WorkerImportPreview }>(
        '/workers/import/preview',
        { csv: text },
      );
      setPreview(data.data);
      setStep('preview');
    } catch (err) {
      setError(messageFrom(err, 'Could not read that file. Please try again.'));
      if (inputRef.current) inputRef.current.value = '';
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post<{ data: WorkerImportResult }>(
        '/workers/import',
        { csv },
      );
      setResult(data.data);
      setStep('done');
      onImported();
    } catch (err) {
      setError(messageFrom(err, 'Import failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  function chooseAnother() {
    setStep('choose');
    setPreview(null);
    setError('');
    setFileName('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const validCount = preview?.summary.valid ?? 0;

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={`${styles.drawer} ${styles.drawerWide}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Import ${t('Employee')}s`}
      >
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>Import {t('Employee')}s</p>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            disabled={busy}
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

          {step === 'choose' && (
            <>
              <div className={styles.importIntro}>
                <p>
                  Upload a CSV to add many {t('Employee').toLowerCase()}s at
                  once. We&apos;ll validate every row before anything is saved —
                  duplicates and errors are skipped so you can fix and retry.
                </p>
                <p>
                  Department and {t('Location').toLowerCase()} names must match
                  existing ones exactly.
                </p>
              </div>

              <div className={styles.importFileRow}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={downloadTemplate}
                  disabled={busy}
                >
                  <Download size={16} strokeWidth={2} />
                  Download template
                </button>

                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className={styles.spin} size={16} />
                  ) : (
                    <FileUp size={16} strokeWidth={2} />
                  )}
                  Choose CSV file
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={onFile}
                />
                {fileName && (
                  <span className={styles.muted} aria-live="polite">
                    {fileName}
                  </span>
                )}
              </div>
            </>
          )}

          {step === 'preview' && preview && (
            <>
              <div className={styles.importSummary}>
                <div className={`${styles.statChip} ${styles.statValid}`}>
                  <span className={styles.statValue}>
                    {preview.summary.valid}
                  </span>
                  <span className={styles.statLabel}>Ready</span>
                </div>
                <div className={`${styles.statChip} ${styles.statDuplicate}`}>
                  <span className={styles.statValue}>
                    {preview.summary.duplicate}
                  </span>
                  <span className={styles.statLabel}>Duplicate</span>
                </div>
                <div className={`${styles.statChip} ${styles.statError}`}>
                  <span className={styles.statValue}>
                    {preview.summary.error}
                  </span>
                  <span className={styles.statLabel}>Error</span>
                </div>
                <div className={styles.statChip}>
                  <span className={styles.statValue}>{preview.summary.total}</span>
                  <span className={styles.statLabel}>Total rows</span>
                </div>
              </div>

              {preview.summary.total > 0 && (
                <div className={styles.importTableWrap}>
                  <table className={styles.importTable}>
                    <thead>
                      <tr>
                        <th className={styles.th}>Row</th>
                        <th className={styles.th}>Status</th>
                        <th className={styles.th}>Name</th>
                        <th className={styles.th}>Job title</th>
                        <th className={styles.th}>{t('Department')}</th>
                        <th className={styles.th}>{t('Location')}</th>
                        <th className={styles.th}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.rowNumber} className={styles.row}>
                          <td
                            className={`${styles.td} ${styles.importRowNum}`}
                          >
                            {row.rowNumber}
                          </td>
                          <td className={styles.td}>
                            <span
                              className={`${styles.status} ${STATUS_CLASS[row.status] ?? ''}`}
                            >
                              {STATUS_LABEL[row.status]}
                            </span>
                          </td>
                          <td className={styles.td}>
                            {row.name ?? '—'}
                            {row.employeeNumber && (
                              <span className={styles.nameMeta}>
                                {' '}
                                · {row.employeeNumber}
                              </span>
                            )}
                          </td>
                          <td className={styles.td}>{row.jobTitle ?? '—'}</td>
                          <td className={styles.td}>{row.department ?? '—'}</td>
                          <td className={styles.td}>{row.location ?? '—'}</td>
                          <td className={styles.td}>
                            {row.errors.length > 0 ? (
                              <span className={styles.importErrors}>
                                {row.errors.join('; ')}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {step === 'done' && result && (
            <div className={`glass ${styles.message}`}>
              <CheckCircle2 size={32} strokeWidth={1.6} aria-hidden="true" />
              <p className={styles.messageTitle}>Import complete</p>
              <p className={styles.muted}>
                Added {result.created} of {result.total}{' '}
                {t('Employee').toLowerCase()}
                {result.total === 1 ? '' : 's'}
                {result.skipped > 0
                  ? `; ${result.skipped} skipped (duplicates or errors).`
                  : '.'}
              </p>
            </div>
          )}
        </div>

        <div className={styles.drawerActions}>
          {step === 'choose' && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
          )}

          {step === 'preview' && (
            <>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={chooseAnother}
                disabled={busy}
              >
                Choose another file
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={commit}
                disabled={busy || validCount === 0}
                title={
                  validCount === 0
                    ? 'No valid rows to import'
                    : `Import ${validCount}`
                }
              >
                {busy ? (
                  <Loader2 className={styles.spin} size={15} />
                ) : (
                  <Upload size={15} strokeWidth={2.2} />
                )}
                Import {validCount}{' '}
                {t('Employee').toLowerCase()}
                {validCount === 1 ? '' : 's'}
              </button>
            </>
          )}

          {step === 'done' && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onClose}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
