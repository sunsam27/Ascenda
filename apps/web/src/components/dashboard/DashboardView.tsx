'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import { Clock, DollarSign, TrendingUp, Users } from 'lucide-react';
import type { DashboardInsights, DashboardSummary } from '@ascenda/types';
import { api } from '@/lib/api';
import KpiCard from '@/components/ui/KpiCard';
import InsightsRail from './InsightsRail';
import styles from './DashboardView.module.css';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const PAYROLL_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  PROCESSED: 'Processed',
  LOCKED: 'Locked',
};

/** Minor units (kobo) → "₦32,500,000" with no decimals. */
function formatMoney(minorUnits: number, currency: string): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minorUnits / 100);
}

function count(value: number): string {
  return new Intl.NumberFormat('en-NG').format(value);
}

export default function DashboardView() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryState, setSummaryState] = useState<LoadState>('loading');
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [insightsState, setInsightsState] = useState<LoadState>('loading');

  useEffect(() => {
    let active = true;

    api
      .get<{ data: DashboardSummary }>('/dashboard/summary')
      .then(({ data }) => {
        if (!active) return;
        setSummary(data.data);
        setSummaryState('ready');
      })
      .catch((error) => {
        if (!active) return;
        setSummaryState(
          axios.isAxiosError(error) && error.response?.status === 403
            ? 'forbidden'
            : 'error',
        );
      });

    api
      .get<{ data: DashboardInsights }>('/dashboard/insights')
      .then(({ data }) => {
        if (!active) return;
        setInsights(data.data);
        setInsightsState('ready');
      })
      .catch((error) => {
        if (!active) return;
        setInsightsState(
          axios.isAxiosError(error) && error.response?.status === 403
            ? 'forbidden'
            : 'error',
        );
      });

    return () => {
      active = false;
    };
  }, []);

  const kpis = summary
    ? [
        {
          id: 'kpi-workers',
          label: 'Total Workers',
          value: count(summary.totalWorkers),
          change: `${count(summary.newThisMonth)} new this month`,
          changePositive: true,
          icon: Users,
          color: 'primary' as const,
        },
        {
          id: 'kpi-leave',
          label: 'Pending Leave Requests',
          value: count(summary.pendingLeaveRequests),
          change:
            summary.pendingLeaveRequests > 0 ? 'Awaiting approval' : 'All clear',
          changePositive: summary.pendingLeaveRequests === 0,
          icon: Clock,
          color: 'warning' as const,
        },
        {
          id: 'kpi-payroll',
          label: 'Last Payroll Run',
          value: summary.lastPayrollRun
            ? formatMoney(
                summary.lastPayrollRun.totalNetMinorUnits,
                summary.lastPayrollRun.currency,
              )
            : '—',
          change: summary.lastPayrollRun
            ? `${
                PAYROLL_STATUS_LABEL[summary.lastPayrollRun.status] ??
                summary.lastPayrollRun.status
              } · ${summary.lastPayrollRun.periodLabel}`
            : 'No runs yet',
          changePositive: summary.lastPayrollRun !== null,
          icon: DollarSign,
          color: 'success' as const,
        },
        {
          id: 'kpi-new',
          label: 'New This Month',
          value: count(summary.newThisMonth),
          change: 'Joined this month',
          changePositive: summary.newThisMonth > 0,
          icon: TrendingUp,
          color: 'secondary' as const,
        },
      ]
    : [];

  return (
    <div className={`${styles.page} cascade`}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Dashboard</h1>
        <p className={styles.pageSubtitle}>
          Organisation overview —{' '}
          {new Date().toLocaleDateString('en-NG', {
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      {summaryState === 'ready' && summary && summary.totalWorkers === 0 && (
        <div className={`${styles.emptyBanner} glass`} role="status">
          <p className={styles.emptyTitle}>Your team is empty</p>
          <p className={styles.emptyText}>
            Add people to Ascenda to bring these numbers to life.
          </p>
        </div>
      )}

      <section aria-labelledby="kpi-section-label" className={styles.kpiGrid}>
        <h2 id="kpi-section-label" className="sr-only">
          Key metrics
        </h2>

        {summaryState === 'loading' &&
          Array.from({ length: 4 }).map((_, i) => (
            <article
              key={i}
              className={`glass ${styles.kpiSkeleton}`}
              aria-hidden="true"
            >
              <span className={styles.skeletonIcon} />
              <div className={styles.skeletonBody}>
                <span className={styles.skeletonLineShort} />
                <span className={styles.skeletonLineTall} />
                <span className={styles.skeletonLine} />
              </div>
            </article>
          ))}

        {summaryState === 'forbidden' && (
          <div className={`glass ${styles.stateCard}`} role="status">
            <p className={styles.stateTitle}>Metrics are restricted</p>
            <p className={styles.stateText}>
              Your role does not have access to organisation metrics.
            </p>
          </div>
        )}

        {summaryState === 'error' && (
          <div className={`glass ${styles.stateCard}`} role="alert">
            <p className={styles.stateTitle}>Something went wrong</p>
            <p className={styles.stateText}>
              We could not load your metrics. Please try again.
            </p>
          </div>
        )}

        {summaryState === 'ready' &&
          kpis.map((kpi) => <KpiCard key={kpi.id} {...kpi} />)}
      </section>

      <div className={styles.contentGrid}>
        <section
          className={`glass ${styles.activityCard}`}
          aria-label="Recent activity"
        >
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recent Activity</h2>
          </div>
          <div className={styles.placeholder}>
            <p className={styles.placeholderText}>
              Activity feed coming in Phase 1
            </p>
          </div>
        </section>

        <InsightsRail
          data={insights}
          loading={insightsState === 'loading'}
          unavailable={
            insightsState === 'forbidden' || insightsState === 'error'
          }
        />
      </div>
    </div>
  );
}
