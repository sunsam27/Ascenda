'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Download, FileText, Loader2, RefreshCw, X } from 'lucide-react';
import { type Payslip, type PayslipLine } from '@ascenda/types';
import { api } from '@/lib/api';
import { formatMinorUnits } from '@/lib/money';
import { ITEM_TYPE_LABEL, formatRange, messageFrom } from './payroll-ui';
import styles from './payroll.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

export default function PayslipsPanel({ selfService }: { selfService: boolean }) {
  const [state, setState] = useState<LoadState>('loading');
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Payslip | null>(null);
  const [downloadingId, setDownloadingId] = useState('');

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const { data } = await api.get<{ data: Payslip[] }>('/payslips', {
        params: { pageSize: 100 },
      });
      setPayslips(data.data);
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

  async function download(slip: Payslip) {
    setDownloadingId(slip.id);
    setError('');
    try {
      const res = await api.get(`/payslips/${slip.id}/pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `payslip-${slip.periodLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(messageFrom(err, 'Could not download the payslip.'));
    } finally {
      setDownloadingId('');
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>
          {selfService
            ? 'Your payslips are generated when a run is processed.'
            : 'Payslips frozen at the moment each run was processed.'}
        </p>
        <div className={styles.toolbarActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => void load()}>
            <RefreshCw size={15} strokeWidth={2} /> Refresh
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
          <Loader2 className={styles.spin} size={16} /> Loading payslips…
        </div>
      ) : state === 'forbidden' ? (
        <div className={`glass ${styles.message}`}>
          <p className={styles.messageTitle}>Payslips are restricted</p>
          <p className={styles.muted}>Your role cannot view payslips.</p>
        </div>
      ) : state === 'error' ? (
        <div className={`glass ${styles.message}`} role="alert">
          <p className={styles.messageTitle}>Something went wrong</p>
          <p className={styles.muted}>We could not load the payslips.</p>
        </div>
      ) : payslips.length === 0 ? (
        <div className={`glass ${styles.message}`}>
          <FileText size={28} strokeWidth={1.6} aria-hidden="true" />
          <p className={styles.messageTitle}>No payslips yet</p>
          <p className={styles.muted}>
            Payslips appear here once a pay run has been processed.
          </p>
        </div>
      ) : (
        <div className={`glass ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Period</th>
                <th className={styles.num}>Gross</th>
                <th className={styles.num}>Deductions</th>
                <th className={styles.num}>Net</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {payslips.map((slip) => (
                <tr key={slip.id}>
                  <td>{slip.periodLabel}</td>
                  <td className={styles.num}>
                    {formatMinorUnits(slip.grossMinorUnits, slip.currency)}
                  </td>
                  <td className={styles.num}>
                    {formatMinorUnits(slip.deductionsMinorUnits, slip.currency)}
                  </td>
                  <td className={`${styles.num} ${styles.numStrong}`}>
                    {formatMinorUnits(slip.netMinorUnits, slip.currency)}
                  </td>
                  <td className={styles.tableRowActions}>
                    <button type="button" className={styles.btn} onClick={() => setOpen(slip)}>
                      View
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => void download(slip)}
                      disabled={downloadingId === slip.id}
                      aria-label="Download payslip PDF"
                      title="Download PDF"
                    >
                      {downloadingId === slip.id ? (
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
        <PayslipModal
          slip={open}
          onClose={() => setOpen(null)}
          onDownload={() => void download(open)}
          downloading={downloadingId === open.id}
        />
      )}
    </div>
  );
}

function PayslipModal({
  slip,
  onClose,
  onDownload,
  downloading,
}: {
  slip: Payslip;
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

  const earnings = slip.lines.filter((l) => l.amountMinorUnits >= 0);
  const deductions = slip.lines.filter((l) => l.amountMinorUnits < 0);

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label="Payslip">
        <div className={styles.drawerHeader}>
          <p className={styles.drawerTitle}>Payslip · {slip.periodLabel}</p>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.drawerBody}>
          <p className={styles.muted}>
            {formatRange(slip.periodStart, slip.periodEnd)}
          </p>

          <div className={styles.summary}>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Gross</span>
              <span className={styles.statValue}>
                {formatMinorUnits(slip.grossMinorUnits, slip.currency)}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Deductions</span>
              <span className={`${styles.statValue} ${styles.statValueNeg}`}>
                {formatMinorUnits(slip.deductionsMinorUnits, slip.currency)}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Net</span>
              <span className={`${styles.statValue} ${styles.statValuePos}`}>
                {formatMinorUnits(slip.netMinorUnits, slip.currency)}
              </span>
            </div>
            <div className={`glass ${styles.stat}`}>
              <span className={styles.statLabel}>Employer costs</span>
              <span className={styles.statValue}>
                {formatMinorUnits(slip.employerCostsMinorUnits, slip.currency)}
              </span>
            </div>
          </div>

          <RuleSection title="Earnings" lines={earnings} currency={slip.currency} />
          <RuleSection title="Deductions" lines={deductions} currency={slip.currency} />
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

function RuleSection({
  title,
  lines,
  currency,
}: {
  title: string;
  lines: PayslipLine[];
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
