import type { Metadata } from 'next';
import KpiCard from '@/components/ui/KpiCard';
import styles from './dashboard.module.css';
import {
  Users,
  Clock,
  DollarSign,
  TrendingUp,
} from 'lucide-react';

export const metadata: Metadata = { title: 'Dashboard | Ascenda' };

// Placeholder KPI data — will come from API
const kpis = [
  {
    id: 'kpi-workers',
    label: 'Total Workers',
    value: '247',
    change: '+12 this month',
    changePositive: true,
    icon: Users,
    color: 'primary' as const,
  },
  {
    id: 'kpi-leave',
    label: 'Pending Leave Requests',
    value: '14',
    change: '3 urgent',
    changePositive: false,
    icon: Clock,
    color: 'warning' as const,
  },
  {
    id: 'kpi-payroll',
    label: 'Last Payroll Run',
    value: '₦32,500,000',
    change: 'Approved · Oct 1',
    changePositive: true,
    icon: DollarSign,
    color: 'success' as const,
  },
  {
    id: 'kpi-headcount',
    label: 'Active This Month',
    value: '231',
    change: '93.5% of workforce',
    changePositive: true,
    icon: TrendingUp,
    color: 'secondary' as const,
  },
];

export default function DashboardPage() {
  return (
    <div className={`${styles.page} cascade`}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Dashboard</h1>
        <p className={styles.pageSubtitle}>
          Organisation overview — {new Date().toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Row */}
      <section aria-labelledby="kpi-section-label" className={styles.kpiGrid}>
        <h2 id="kpi-section-label" className="sr-only">Key metrics</h2>
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} {...kpi} />
        ))}
      </section>

      {/* Activity placeholder */}
      <div className={styles.contentGrid}>
        <section className={`glass ${styles.activityCard}`} aria-label="Recent activity">
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recent Activity</h2>
          </div>
          <div className={styles.placeholder}>
            <p className={styles.placeholderText}>Activity feed coming in Phase 1</p>
          </div>
        </section>

        <section className={`glass ${styles.upcomingCard}`} aria-label="Upcoming payroll">
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Upcoming Payroll</h2>
          </div>
          <div className={styles.placeholder}>
            <p className={styles.placeholderText}>Pay calendar integration in Phase 3</p>
          </div>
        </section>
      </div>
    </div>
  );
}
