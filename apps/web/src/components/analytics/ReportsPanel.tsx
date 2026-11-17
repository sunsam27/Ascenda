'use client';

import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { Download, FileText } from 'lucide-react';
import type {
  AnalyticsExportFormat,
  AnalyticsReport,
  AnalyticsReportDefinition,
  AnalyticsReportType,
} from '@ascenda/types';
import { api } from '@/lib/api';
import { formatMinorUnits } from '@/lib/money';
import { terminologyOf, useOrganisation } from '@/lib/useOrganisation';
import StepUpDialog from '@/components/payroll/StepUpDialog';
import styles from './analytics.module.css';

type Catalogue = { data: AnalyticsReportDefinition[]; canExport: boolean; maxExportRows: number };
type DownloadTarget = {
  type: AnalyticsReportType;
  from: string;
  to: string;
  format: AnalyticsExportFormat;
};

export default function ReportsPanel({ from, to }: { from: string; to: string }) {
  const { organisation } = useOrganisation();
  const term = terminologyOf(organisation);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [selected, setSelected] = useState<AnalyticsReportType | ''>('');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [pending, setPending] = useState<DownloadTarget | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const type = selected || catalogue?.data[0]?.type;

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<Catalogue>('/analytics/reports/catalogue', { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setCatalogue(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Report list could not be loaded. Please try again.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!type) return;
    const controller = new AbortController();
    setReport(null);
    setLoading(true);
    setError('');
    setDownloadError('');
    setNotice('');
    api
      .get<{ data: AnalyticsReport }>('/analytics/reports', {
        params: { type, from, to, page, pageSize: 25 },
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (!controller.signal.aborted) setReport(data.data);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          isAxiosError(cause) && cause.response?.status === 403
            ? 'This report is not available to your role.'
            : 'The report could not be loaded. Check the date range or try again.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [type, from, to, page, retry]);

  useEffect(() => () => downloadController.current?.abort(), []);

  async function download(target: DownloadTarget, token?: string) {
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    setDownloadError('');
    setNotice('');
    try {
      const response = await api.get<Blob>('/analytics/reports/export', {
        params: target,
        responseType: 'blob',
        signal: controller.signal,
        headers: token ? { 'x-step-up-token': token } : undefined,
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ascenda-${target.type}-${target.from}-${target.to}.${target.format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`${target.format.toUpperCase()} download prepared. This export has been audited.`);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      let message = 'The report could not be exported. Please try again.';
      if (isAxiosError(cause) && cause.response?.data instanceof Blob) {
        try {
          const body = JSON.parse(await cause.response.data.text()) as { message?: unknown };
          if (typeof body.message === 'string') message = body.message;
        } catch {
          /* Non-JSON proxy failures use the generic message. */
        }
      }
      if (!controller.signal.aborted) setDownloadError(message);
    } finally {
      if (!controller.signal.aborted) {
        setDownloading(false);
        setPending(null);
      }
    }
  }

  function beginDownload(format: AnalyticsExportFormat) {
    if (!report || downloading) return;
    const target = { type: report.type, from: report.from, to: report.to, format };
    if (report.requiresStepUp) setPending(target);
    else void download(target);
  }

  function cell(row: AnalyticsReport['rows'][number], column: AnalyticsReport['columns'][number]) {
    const value = row[column.key];
    if (value == null) return 'Hidden';
    if (column.kind === 'money' && typeof value === 'number')
      return formatMinorUnits(value, String(row.currency));
    if (typeof value === 'number') return value.toLocaleString();
    if (column.key === 'category') return term(value.charAt(0) + value.slice(1).toLowerCase());
    return value;
  }

  return (
    <section className={styles.card} aria-labelledby="reports-title">
      <h2 id="reports-title">
        <FileText size={20} aria-hidden="true" /> Standard reports
      </h2>
      <p className={styles.note}>
        Preview your permitted data, then download the whole report as CSV or PDF. Downloads are
        Owner-only and audited. Excel is not included in this release.
      </p>
      <div className={styles.reportControls}>
        <label>
          Report
          <select
            value={type ?? ''}
            disabled={downloading || pending !== null || !catalogue}
            onChange={(event) => {
              setSelected(event.target.value as AnalyticsReportType);
              setPage(1);
              setReport(null);
            }}
          >
            {catalogue?.data.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {definition.type === 'employee'
                  ? `${term('Employee')} / workforce directory`
                  : definition.type === 'department'
                    ? `${term('Department')} summary`
                    : definition.title}
              </option>
            ))}
          </select>
        </label>
        {report?.canExport && (
          <div className={styles.exportActions}>
            <button
              type="button"
              disabled={
                loading ||
                downloading ||
                pending !== null ||
                report.meta.total > (catalogue?.maxExportRows ?? 0)
              }
              onClick={() => beginDownload('csv')}
            >
              <Download size={16} aria-hidden="true" /> Download CSV
            </button>
            <button
              type="button"
              disabled={
                loading ||
                downloading ||
                pending !== null ||
                report.meta.total > (catalogue?.maxExportRows ?? 0)
              }
              onClick={() => beginDownload('pdf')}
            >
              <Download size={16} aria-hidden="true" /> Download PDF
            </button>
          </div>
        )}
      </div>
      {loading ? (
        <p role="status" className={styles.empty}>
          Loading report…
        </p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            className={styles.retry}
            type="button"
            onClick={() => {
              setError('');
              setLoading(true);
              setRetry((value) => value + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        report && (
          <>
            <p className={styles.note}>{report.description}</p>
            <p className={styles.reportMeta}>
              {report.from} – {report.to} ·{' '}
              {report.scope === 'team' ? 'Your team, including you' : 'Your organisation'} ·{' '}
              {report.meta.total.toLocaleString()} records · Generated{' '}
              {new Date(report.generatedAt).toLocaleString()}
            </p>
            {report.requiresStepUp && report.canExport && (
              <p className={styles.note}>
                Payroll exports require password confirmation. Hidden values remain hidden in every
                format.
              </p>
            )}
            {!report.canExport && (
              <p className={styles.note}>
                You can preview this report. Only an Owner can download analytics reports.
              </p>
            )}
            {report.meta.total > (catalogue?.maxExportRows ?? Infinity) && (
              <p className={styles.note}>
                This report exceeds the {catalogue?.maxExportRows.toLocaleString()}-row download
                limit. A reviewed offline export is required.
              </p>
            )}
            {report.rows.length === 0 ? (
              <p className={styles.empty}>No records on this page for the selected period.</p>
            ) : (
              <div
                className={styles.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Scrollable report preview"
              >
                <table>
                  <caption>
                    {report.title} · preview page {report.meta.page}
                  </caption>
                  <thead>
                    <tr>
                      {report.columns.map((column) => (
                        <th
                          key={column.key}
                          scope="col"
                          className={column.kind === 'text' ? styles.textCell : styles.numericCell}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, index) => (
                      <tr key={index}>
                        {report.columns.map((column) => (
                          <td
                            key={column.key}
                            className={
                              column.kind === 'text' ? styles.textCell : styles.numericCell
                            }
                          >
                            {cell(row, column)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={styles.pagination}>
              <button
                type="button"
                disabled={page === 1 || downloading || pending !== null}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </button>
              <span>
                Page {report.meta.page} of {Math.max(1, report.meta.totalPages)}
              </span>
              <button
                type="button"
                disabled={page >= report.meta.totalPages || downloading || pending !== null}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          </>
        )
      )}
      {downloading && (
        <p role="status" className={styles.note}>
          Preparing the full report…
        </p>
      )}
      {downloadError && (
        <p role="alert" className={styles.exportError}>
          {downloadError}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.note}>
          {notice}
        </p>
      )}
      <StepUpDialog
        open={pending !== null}
        title="Confirm payroll report export"
        description="Re-enter your password to download this payroll report. The export is audited; suppressed values remain hidden."
        confirmLabel="Confirm and download"
        onCancel={() => {
          if (!downloading) setPending(null);
        }}
        onVerified={async (token) => {
          if (pending) await download(pending, token);
        }}
      />
    </section>
  );
}
