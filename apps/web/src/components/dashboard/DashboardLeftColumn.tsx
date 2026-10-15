'use client';

import type { DashboardInsights, LeaveInsight } from '@ascenda/types';
import { Plane } from 'lucide-react';
import styles from './DashboardLeftColumn.module.css';

interface DashboardLeftColumnProps {
  insights: DashboardInsights | null;
  insightsLoading: boolean;
  insightsUnavailable: boolean;
}

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function formatRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatDay(startIso);
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth();
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
  if (sameMonth) {
    return `${day.format(start)}–${day.format(end)} ${month.format(end)}`;
  }
  return `${day.format(start)} ${month.format(start)} – ${day.format(end)} ${month.format(end)}`;
}

function LeaveRow({ leave }: { leave: LeaveInsight }) {
  return (
    <tr className={styles.row}>
      <td className={styles.cell}>
        <div className={styles.worker}>
          <span className={styles.workerName}>{leave.workerName}</span>
        </div>
      </td>
      <td className={styles.cell}>{leave.leaveTypeName}</td>
      <td className={styles.cell}>{formatRange(leave.startDate, leave.endDate)}</td>
      <td className={styles.cell}>Approved</td>
    </tr>
  );
}

export default function DashboardLeftColumn({
  insights,
  insightsLoading,
  insightsUnavailable,
}: DashboardLeftColumnProps) {
  const upcomingLeave = insights?.upcomingLeave ?? [];

  return (
    <div className={styles.stack}>
      <section className={`glass ${styles.panel}`} aria-label="Upcoming leave">
        <div className={styles.panelHeader}>
          <Plane size={18} strokeWidth={1.75} aria-hidden="true" />
          <h2 className={styles.panelTitle}>Upcoming Leave</h2>
          <span className={styles.panelSub}>
            Approved leave starting in the next 30 days
          </span>
        </div>
        {insightsLoading ? (
          <div className={styles.skeletonGrid}>
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLine} />
          </div>
        ) : insightsUnavailable ? (
          <div className={styles.stateCard}>
            <p className={styles.stateTitle}>Limited access</p>
            <p className={styles.stateText}>
              Team leave insights are limited to HR and managers.
            </p>
          </div>
        ) : upcomingLeave.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>No approved leave ahead</p>
            <p className={styles.emptyText}>Nothing scheduled for the next 30 days.</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Worker</th>
                  <th className={styles.th}>Leave type</th>
                  <th className={styles.th}>Dates</th>
                  <th className={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {upcomingLeave.slice(0, 10).map((leave) => (
                  <LeaveRow key={leave.id} leave={leave} />
                ))}
              </tbody>
            </table>
            {upcomingLeave.length > 10 && (
              <p className={styles.moreText}>
                Showing first 10 of {upcomingLeave.length} entries.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
