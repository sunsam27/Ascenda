'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Download, FileText, Loader2, RefreshCw, Wand2, X } from 'lucide-react';
import {
  type RemittanceSchedule,
  type YearEndLine,
  type YearEndStatement,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { formatMinorUnits } from '@/lib/money';
import {
  ITEM_TYPE_LABEL,
  REMITTANCE_SIDE_LABEL,
  formatRange,
  messageFrom,
} from './payroll-ui';
import styles from './payroll.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';
type SubTab = 'statements' | 'remittance';

export default function YearEndPanel({
  canGenerate,
  canSeeRemittance,
}: {
  canGenerate: boolean;
  canSeeRemittance: boolean;
}) {
  const [subTab, setSubTab] = useState<SubTab>('statements');

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist" aria-label="Year-end sections">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'statements'}
          className={`${styles.tab} ${subTab === 'statements' ? styles.tabActive : ''}`}
          onClick={() => setSubTab('statements')}
        >
          Statements
        </button>
        {canSeeRemittance && (
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'remittance'}
            className={`${styles.tab} ${subTab === 'remittance' ? styles.tabActive : ''}`}
            onClick={() => setSubTab('remittance')}
          >
            Remittance
          </button>
        )}
      </div>

      {subTab === 'statements' ? (
        <StatementsSection canGenerate={canGenerate} />
      ) : (
        <RemittanceSection />
      )}
    </div>
  );
}

// ── Statements ───────────────────────────────────────────────────────────────

function StatementsSection({ canGenerate }: { canGenerate: boolean }) {
  const [state, setState] = useState<LoadState>('loading');
  const [statements, setStatements] = useState<YearEndStatement[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [generating, setGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');
  const [open, setOpen] = useState<YearEndStatement | null>(null);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{ data: YearEndStatement[] }>(
        '/payroll/year-end/statements',
        { params: { pageSize: 100 } },
      );
      setStatements(data.data);
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

  async function generate() {
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post<{ data: { created: number; taxYearLabel: string } }>(
        '/payroll/year-end/statements',
        { year },
      );
      setNotice(
        data.data.created > 0
          ? `Generated ${data.data.created} statement(s) for ${data.data.taxYearLabel}.`
          : `No new statements for ${data.data.taxYearLabel} (already generated).`,
      );
      await load();
    } catch (err) {
      setError(messageFrom(err, 'Could not generate statements.'));
    } finally {
      setGenerating(false);
    }
  }

  async function download(statement: YearEndStatement) {
    setDownloadingId(statement.id);
    setError('');
    try {
      const res = await api.get(`/payroll/year-end/statements/${statement.id}/pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `year-end-${statement.taxYearLabel.replace(/\W+/g, '-')}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(messageFrom(err, 'Could not download the statement.'));
    } finally {
      setDownloadingId('');
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {canGenerate && (
            <label className={styles.field}>
              <span className={styles.label}>Tax year</span>
              <input
                className={styles.input}
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number(e.currentTarget.value))}
              />
            </label>
          )}
          <p className={styles.muted}>
            Annual statements frozen from processed payslips.
          </p>
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => void load()}>
            <RefreshCw size={15} strokeWidth={2} /> Refresh
          </button>
          {canGenerate && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? <Loader2 className={styles.spin} size={15} /> : <Wand2 size={15} strokeWidth={2.2} />}
              Generate
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
          <Loader2 className={styles.spin} size={16} /> Loading statements…
        </div>
      ) : state === 'forbidden' ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Statements are restricted</p>
          <p className={styles.muted}>Your role cannot view year-end statements.</p>
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the statements.</p>
        </div>
      ) : statements.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <FileText size={28} strokeWidth={1.6} aria-hidden="true" />
          <p className={styles.messageTitle}>No statements yet</p>
          <p className={styles.muted}>
            {canGenerate
              ? 'Generate statements after a tax year has been paid.'
              : 'Your annual statement will appear here once it has been generated.'}
          </p>
        </div>
      ) : (
        <div className={`glass ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tax year</th>
                <th className={styles.num}>Gross</th>
                <th className={styles.num}>Deductions</th>
                <th className={styles.num}>Net</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.taxYearLabel}
                    {!s.validatedByProfessional && (
                      <span className={`${styles.badge} ${styles.badgeWarning}`}>unvalidated</span>
                    )}
                  </td>
                  <td className={styles.num}>
                    {formatMinorUnits(s.grossMinorUnits, s.currency)}
                  </td>
                  <td className={styles.num}>
                    {formatMinorUnits(s.deductionsMinorUnits, s.currency)}
                  </td>
                  <td className={`${styles.num} ${styles.numStrong}`}>
                    {formatMinorUnits(s.netMinorUnits, s.currency)}
                  </td>
                  <td className={styles.tableRowActions}>
                    <button type="button" className={styles.btn} onClick={() => setOpen(s)}>
                      View
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => void download(s)}
                      disabled={downloadingId === s.id}
                      aria-label="Download statement PDF"
                      title="Download PDF"
                    >
                      {downloadingId === s.id ? (
                        <Loader2 className={styles.spin} size={15} />
                      ) : (
                        <Download size={15} strokeWidth={2} />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <StatementModal
          statement={open}
          onClose={() => setOpen(null)}
          onDownload={() => void download(open)}
          downloading={downloadingId === open.id}
        />
      )}
    </div>
  );
}

function StatementModal({
  statement,
  onClose,
  onDownload,
  downloading,
}: {
  statement: YearEndStatement;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const earnings = statement.lines.filter((l) => l.amountMinorUnits >= 0);
  const deductions = statement.lines.filter((l) => l.amountMinorUnits < 0);

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="Year-end statement">
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>Year-end · {statement.taxYearLabel}</p>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.drawerBody}>
          <p className={styles.muted}>
            {formatRange(statement.periodStart, statement.periodEnd)} ·{' '}
            {statement.payslipCount} payslip(s)
          </p>

          {!statement.validatedByProfessional && (
            <p className={styles.warning} role="note">
              Statutory figures have not been validated by a payroll professional.
            </p>
          )}

          <div className={styles.summary}>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Gross</span>
              <span className={styles.statValue}>
                {formatMinorUnits(statement.grossMinorUnits, statement.currency)}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Deductions</span>
              <span className={`${styles.statValue} ${styles.statValueNeg}`}>
                {formatMinorUnits(statement.deductionsMinorUnits, statement.currency)}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Net</span>
              <span className={`${styles.statValue} ${styles.statValuePos}`}>
                {formatMinorUnits(statement.netMinorUnits, statement.currency)}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Employer costs</span>
              <span className={styles.statValue}>
                {formatMinorUnits(statement.employerCostsMinorUnits, statement.currency)}
              </span>
            </div>
          </div>

          <LineSection title="Earnings" lines={earnings} currency={statement.currency} />
          <LineSection title="Deductions" lines={deductions} currency={statement.currency} />
        </div>
        <div className={styles.drawerActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onDownload}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className={styles.spin} size={15} />
            ) : (
              <Download size={15} strokeWidth={2.2} />
            )}
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function LineSection({
  title,
  lines,
  currency,
}: {
  title: string;
  lines: YearEndLine[];
  currency: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{title}</span>
      <div className={`glass ${styles.tableWrap}`}>
        <table className={styles.table}>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i}>
                <td>{line.description}</td>
                <td className={styles.muted}>{ITEM_TYPE_LABEL[line.type]}</td>
                <td className={`${styles.num} ${styles.numStrong}`}>
                  {formatMinorUnits(line.amountMinorUnits, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Remittance ───────────────────────────────────────────────────────────────

function RemittanceSection() {
  const [state, setState] = useState<LoadState>('loading');
  const [schedule, setSchedule] = useState<RemittanceSchedule | null>(null);
  const [error, setError] = useState('');
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{ data: RemittanceSchedule }>(
        '/payroll/year-end/remittance',
        { params: { year } },
      );
      setSchedule(data.data);
      setState('ready');
    } catch (err) {
      setState(
        axios.isAxiosError(err) && err.response?.status === 403
          ? 'forbidden'
          : 'error',
      );
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    setError('');
    try {
      const res = await api.get('/payroll/year-end/remittance/export', {
        params: { year },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `remittance-${year}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(messageFrom(err, 'Could not export the schedule.'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <label className={styles.field}>
            <span className={styles.label}>Tax year</span>
            <input
              className={styles.input}
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.currentTarget.value))}
            />
          </label>
          <p className={styles.muted}>
            Aggregated statutory lines across the year's payslips.
          </p>
        </div>
        <div className={styles.toolbarActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => void load()}>
            <RefreshCw size={15} strokeWidth={2} /> Refresh
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void exportCsv()}
            disabled={exporting || !schedule || schedule.lines.length === 0}
          >
            {exporting ? <Loader2 className={styles.spin} size={15} /> : <Download size={15} strokeWidth={2.2} />}
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {state === 'loading' ? (
        <div className={styles.spinnerRow}>
          <Loader2 className={styles.spin} size={16} /> Loading schedule…
        </div>
      ) : state === 'forbidden' ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Remittance is restricted</p>
          <p className={styles.muted}>Your role cannot view remittance schedules.</p>
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the schedule.</p>
        </div>
      ) : !schedule || schedule.lines.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Nothing to remit</p>
          <p className={styles.muted}>
            No statutory lines were found on this year's payslips.
          </p>
        </div>
      ) : (
        <>
          {!schedule.validatedByProfessional && (
            <p className={styles.warning} role="note">
              One or more rule packs have not been validated by a payroll professional.
            </p>
          )}
          <div className={styles.summary}>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Employee total</span>
              <span className={styles.statValue}>
                {formatMinorUnits(schedule.employeeTotalMinorUnits, schedule.currency)}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Employer total</span>
              <span className={styles.statValue}>
                {formatMinorUnits(schedule.employerTotalMinorUnits, schedule.currency)}
              </span>
            </div>
          </div>
          <div className={`glass ${styles.tableWrap}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Scheme</th>
                  <th>Side</th>
                  <th className={styles.num}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {schedule.lines.map((line, i) => (
                  <tr key={i}>
                    <td>{line.label}</td>
                    <td>
                      <span className={`${styles.badge} ${line.side === 'EMPLOYER' ? styles.badgeInfo : styles.badge}`}>
                        {REMITTANCE_SIDE_LABEL[line.side]}
                      </span>
                    </td>
                    <td className={`${styles.num} ${styles.numStrong}`}>
                      {formatMinorUnits(line.amountMinorUnits, schedule.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
