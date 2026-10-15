'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Cake,
  CheckCircle2,
  Clock,
  FilePlus2,
  Plane,
  Sparkles,
  Users,
} from 'lucide-react';
import type { DashboardInsights, LeaveInsight } from '@ascenda/types';
import styles from './UtilityPanel.module.css';

interface UtilityPanelProps {
  summaryPendingCount: number;
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

function LeaveCompact({ leave }: { leave: LeaveInsight }) {
  return (
    <li className={styles.compactItem}>
      <span className={styles.compactIcon} aria-hidden="true">
        <Plane size={14} strokeWidth={1.75} />
      </span>
      <div className={styles.compactBody}>
        <span className={styles.compactName}>{leave.workerName}</span>
        <span className={styles.compactMeta}>
          {leave.leaveTypeName} · {formatRange(leave.startDate, leave.endDate)}
        </span>
      </div>
    </li>
  );
}

export default function UtilityPanel({
  summaryPendingCount,
  insights,
  insightsLoading,
  insightsUnavailable,
}: UtilityPanelProps) {
  const onLeaveNow = insights?.onLeaveNow ?? [];
  const birthdays = insights?.upcomingBirthdays ?? [];
  const holidays = insights?.holidays ?? [];

  const upcomingEvents: Array<{
    key: string;
    kind: 'birthday' | 'holiday';
    title: string;
    date: string;
  }> = [
    ...birthdays.map((b) => ({
      key: `birthday-${b.workerId}-${b.date}`,
      kind: 'birthday' as const,
      title: b.workerName,
      date: b.date,
    })),
    ...holidays.map((h) => ({
      key: `holiday-${h.date}-${h.name}`,
      kind: 'holiday' as const,
      title: h.name,
      date: h.date,
    })),
  ].slice(0, 8);

  // Derive useful notifications from real signals (no filler)
  const notifications = [
    summaryPendingCount > 0
      ? {
          key: 'pending-leave',
          icon: CheckCircle2,
          message: `${summaryPendingCount} leave request${
            summaryPendingCount === 1 ? '' : 's'
          } awaiting approval`,
          link: '/time-leave',
        }
      : null,
    onLeaveNow.length > 0
      ? {
          key: 'on-leave',
          icon: Plane,
          message: `${onLeaveNow.length} worker${
            onLeaveNow.length === 1 ? '' : 's'
          } on leave today`,
          link: '/time-leave',
        }
      : null,
    upcomingEvents.length > 0
      ? {
          key: 'upcoming',
          icon: CalendarDays,
          message: `${upcomingEvents.length} upcoming event${
            upcomingEvents.length === 1 ? '' : 's'
          } this month`,
          link: '/time-leave',
        }
      : null,
    insights?.holidays && insights.holidays.length > 0
      ? {
          key: 'holidays',
          icon: CalendarDays,
          message: `${insights.holidays.length} public holiday${
            insights.holidays.length === 1 ? '' : 's'
          } this month`,
          link: '/time-leave',
        }
      : null,
  ].filter((n): n is NonNullable<typeof n> => n !== null)
    .slice(0, 4);

  return (
    <aside className={styles.rail} aria-label="Quick actions and team updates">
      {/* Quick Actions */}
      <section className={`glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
          <h2 className={styles.cardTitle}>Quick Actions</h2>
        </div>
        <nav className={styles.actionsGrid}>
          <Link href="/people?open=new" className={styles.actionBtn}>
            <Users size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>Add worker</span>
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link href="/people?open=import" className={styles.actionBtn}>
            <FilePlus2 size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>Import CSV</span>
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link href="/payroll" className={styles.actionBtn}>
            <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>Run payroll</span>
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link href="/time-leave" className={styles.actionBtn}>
            <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>Review leave</span>
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </nav>
      </section>

      {/* Pending Approvals */}
      <section className={`glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden="true" />
          <h2 className={styles.cardTitle}>Pending Approvals</h2>
          {summaryPendingCount > 0 && (
            <span className={styles.badge}>{summaryPendingCount}</span>
          )}
        </div>
        {summaryPendingCount === 0 ? (
          <p className={styles.empty}>All approvals cleared</p>
        ) : (
          <div className={styles.compactBlock}>
            <p className={styles.compactText}>
              {summaryPendingCount} leave request{summaryPendingCount === 1 ? '' : 's'} awaiting approval.
            </p>
            <Link href="/time-leave" className={styles.link}>
              Review in Time & Leave <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>

      {/* On Leave Now */}
      <section className={`glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <Plane size={16} strokeWidth={1.75} aria-hidden="true" />
          <h2 className={styles.cardTitle}>On Leave Now</h2>
        </div>
        {insightsLoading ? (
          <div className={styles.skeletonList} aria-hidden="true">
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLineShort} />
          </div>
        ) : insightsUnavailable ? (
          <p className={styles.empty}>Team leave insights are limited to HR and managers.</p>
        ) : onLeaveNow.length === 0 ? (
          <p className={styles.empty}>No one is on leave right now</p>
        ) : (
          <ul className={`${styles.compactList} ${styles.scroll}`}>
            {onLeaveNow.map((leave) => (
              <LeaveCompact key={leave.id} leave={leave} />
            ))}
          </ul>
        )}
        <Link href="/time-leave" className={styles.link}>
          View team calendar <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </section>

      {/* Upcoming Events */}
      <section className={`glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" />
          <h2 className={styles.cardTitle}>Upcoming Events</h2>
        </div>
        {insightsLoading ? (
          <div className={styles.skeletonList} aria-hidden="true">
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLineShort} />
          </div>
        ) : insightsUnavailable ? (
          <p className={styles.empty}>Upcoming events are limited to HR and managers.</p>
        ) : upcomingEvents.length === 0 ? (
          <p className={styles.empty}>Nothing coming up soon</p>
        ) : (
          <ul className={`${styles.compactList} ${styles.scroll}`}>
            {upcomingEvents.map((ev) => (
              <li key={ev.key} className={styles.compactItem}>
                <span
                  className={`${styles.compactIcon} ${
                    ev.kind === 'birthday'
                      ? styles.iconBirthday
                      : styles.iconHoliday
                  }`}
                  aria-hidden="true"
                >
                  {ev.kind === 'birthday' ? (
                    <Cake size={14} strokeWidth={1.75} />
                  ) : (
                    <CalendarDays size={14} strokeWidth={1.75} />
                  )}
                </span>
                <div className={styles.compactBody}>
                  <span className={styles.compactName}>
                    {ev.kind === 'birthday' ? `${ev.title}'s birthday` : ev.title}
                  </span>
                  <span className={styles.compactMeta}>
                    {ev.kind === 'birthday' ? 'Birthday · ' : 'Public holiday · '}
                    {formatDay(ev.date)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Notifications */}
      <section className={`glass ${styles.card}`}>
        <div className={styles.cardHeader}>
          <Bell size={16} strokeWidth={1.75} aria-hidden="true" />
          <h2 className={styles.cardTitle}>Notifications</h2>
        </div>
        {notifications.length === 0 ? (
          <p className={styles.empty}>You're all caught up</p>
        ) : (
          <ul className={styles.compactList}>
            {notifications.map((n) => (
              <li key={n.key} className={styles.compactItem}>
                <span className={styles.compactIcon} aria-hidden="true">
                  <n.icon size={14} strokeWidth={1.75} />
                </span>
                <Link href={n.link} className={styles.notificationLink}>
                  {n.message}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
