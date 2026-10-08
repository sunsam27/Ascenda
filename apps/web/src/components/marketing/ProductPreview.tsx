import {
  Search,
  Bell,
  Users,
  Wallet,
  Clock,
  CircleCheckBig,
  Minus,
} from 'lucide-react';
import Image from 'next/image';
import styles from './ProductPreview.module.css';

/**
 * ProductPreview — illustrative dashboard mockup for the hero.
 * Wrapped in role="img" so assistive tech reads it as one labelled picture.
 */

type Tint = 'primary' | 'secondary' | 'success' | 'warning';

const kpis: { label: string; value: string; icon: typeof Users; tint: Tint }[] = [
  { label: 'Total workers', value: '247', icon: Users, tint: 'primary' },
  { label: 'Payroll · October', value: '₦32,500,000', icon: Wallet, tint: 'success' },
  { label: 'Pending approvals', value: '4', icon: Clock, tint: 'warning' },
];

type Status = 'paid' | 'review' | 'approved' | 'draft';

const rows: {
  initials: string;
  name: string;
  type: string;
  gross: string;
  status: Status;
}[] = [
  { initials: 'AO', name: 'Amaka Okafor', type: 'Full time', gross: '₦420,000', status: 'paid' },
  { initials: 'MA', name: 'Musa Adeyemi', type: 'Contract', gross: '₦285,000', status: 'review' },
  { initials: 'GE', name: 'Grace Eze', type: 'Part time', gross: '₦150,000', status: 'approved' },
  { initials: 'TB', name: 'Tunde Bello', type: 'Full time', gross: '₦360,000', status: 'paid' },
];

const statusMap = {
  paid: { label: 'Paid', className: styles.badgeSuccess, Icon: CircleCheckBig },
  review: { label: 'In review', className: styles.badgeWarning, Icon: Clock },
  approved: { label: 'Approved', className: styles.badgeSuccess, Icon: CircleCheckBig },
  draft: { label: 'Draft', className: styles.badgeMuted, Icon: Minus },
};

export default function ProductPreview() {
  return (
    <div
      className={`glass ${styles.frame}`}
      role="img"
      aria-label="Preview of the Ascenda dashboard: October payroll in review, key metrics for workers and approvals, and a payslip table with paid, in-review and approved statuses."
    >
      <div className={styles.panel}>
        {/* App chrome — solid surface (DESIGN_SYSTEM.md §1) */}
        <div className={styles.topBar}>
          <div className={styles.appBrand}>
            <Image
              src="/ascenda-logo.png"
              alt=""
              width={24}
              height={24}
              className={styles.appLogo}
              aria-hidden="true"
            />
            <span className={styles.appName}>Ascenda</span>
          </div>
          <div className={styles.search}>
            <Search size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>Search workers…</span>
          </div>
          <div className={styles.topRight}>
            <span className={styles.bell}><Bell size={16} strokeWidth={1.75} /></span>
            <span className={styles.userAvatar}>JA</span>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.contentHead}>
            <div>
              <p className={styles.contentTitle}>October payroll</p>
              <p className={styles.contentSub}>Pay period 1–31 Oct · 247 workers</p>
            </div>
            <span className={`${styles.badge} ${styles.badgeWarning}`}>
              <Clock size={12} strokeWidth={2} aria-hidden="true" />
              In review
            </span>
          </div>

          <div className={styles.kpiRow}>
            {kpis.map(({ label, value, icon: Icon, tint }) => (
              <div key={label} className={styles.kpi}>
                <span className={styles.kpiIcon} data-tint={tint} aria-hidden="true">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <div className={styles.kpiBody}>
                  <span className={styles.kpiLabel}>{label}</span>
                  <span className={styles.kpiValue}>{value}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Worker</th>
                  <th scope="col" className={styles.colType}>Type</th>
                  <th scope="col" className={styles.colNum}>Gross pay</th>
                  <th scope="col" className={styles.colStatus}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = statusMap[row.status];
                  return (
                    <tr key={row.name}>
                      <th scope="row" className={styles.worker}>
                        <span className={styles.rowAvatar} aria-hidden="true">{row.initials}</span>
                        <span className={styles.workerName}>{row.name}</span>
                      </th>
                      <td className={styles.colType}>{row.type}</td>
                      <td className={styles.colNum}>{row.gross}</td>
                      <td className={styles.colStatus}>
                        <span className={`${styles.badge} ${status.className}`}>
                          <status.Icon size={12} strokeWidth={2} aria-hidden="true" />
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Floating approval toast — glass-overlay (DESIGN_SYSTEM.md §6) */}
      <div className={styles.toast}>
        <span className={styles.toastIcon} aria-hidden="true">
          <CircleCheckBig size={18} strokeWidth={2} />
        </span>
        <div className={styles.toastBody}>
          <p className={styles.toastTitle}>Payroll approved</p>
          <p className={styles.toastMeta}>J. Adeyemi · Finance Approver</p>
        </div>
      </div>
    </div>
  );
}
