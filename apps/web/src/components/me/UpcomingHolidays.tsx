'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Loader2, Sparkles } from 'lucide-react';
import type { Holiday } from '@ascenda/types';
import { api } from '@/lib/api';
import styles from './me.module.css';

type LoadState = 'loading' | 'ready' | 'error';

/** Today in local time as YYYY-MM-DD. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Recurring holidays are stored once with their original date. The API returns
 * them for any requested year, so project the month/day onto the year we asked
 * for to get the correct upcoming occurrence.
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function projectYear(isoDate: string, year: number): string {
  const [, month, day] = isoDate.split('-');
  // 29 February only exists in leap years — clamp so the date stays valid.
  if (month === '02' && day === '29' && !isLeapYear(year)) {
    return `${year}-02-28`;
  }
  return `${year}-${month}-${day}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function relativeLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });

/**
 * The organisation's own public-holiday calendar, shown to employees. Holidays
 * are org data (never hard-coded here) — HR/admin maintain them under
 * Time & Leave → Public holidays.
 */
export default function UpcomingHolidays({ limit = 5 }: { limit?: number }) {
  const [state, setState] = useState<LoadState>('loading');
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  // Stable for the lifetime of the view.
  const [today] = useState(todayIso);

  useEffect(() => {
    let active = true;

    const currentYear = Number(today.slice(0, 4));

    async function loadYear(year: number): Promise<Holiday[]> {
      const res = await api.get<{ data: Holiday[] }>('/holidays', {
        params: { year, pageSize: 100 },
      });
      return res.data.data.map((holiday) =>
        holiday.isRecurring
          ? { ...holiday, date: projectYear(holiday.date, year) }
          : holiday,
      );
    }

    Promise.all([loadYear(currentYear), loadYear(currentYear + 1)])
      .then(([thisYear, nextYear]) => {
        if (!active) return;
        const seen = new Set<string>();
        const upcoming = [...thisYear, ...nextYear]
          .filter((holiday) => holiday.date >= today)
          .filter((holiday) => {
            const key = `${holiday.id}-${holiday.date}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, limit);
        setHolidays(upcoming);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });

    return () => {
      active = false;
    };
  }, [limit, today]);

  return (
    <section className={`glass ${styles.card}`} aria-labelledby="me-holidays">
      <div className={styles.cardHead}>
        <h2 id="me-holidays" className={styles.cardTitle}>
          Upcoming holidays
        </h2>
        <CalendarDays size={17} strokeWidth={1.9} className={styles.cardIcon} aria-hidden />
      </div>

      {state === 'loading' ? (
        <p className={styles.muted}>
          <Loader2 className={styles.spin} size={14} /> Loading the holiday calendar…
        </p>
      ) : state === 'error' ? (
        <p className={styles.muted}>
          Could not load the holiday calendar.
        </p>
      ) : holidays.length === 0 ? (
        <div className={styles.holidayEmpty}>
          <span className={styles.holidayEmptyIcon} aria-hidden="true">
            <Sparkles size={18} strokeWidth={1.9} />
          </span>
          <p className={styles.muted}>
            Your organisation hasn&apos;t published any upcoming holidays yet.
          </p>
        </div>
      ) : (
        <ul className={styles.holidayList}>
          {holidays.map((holiday, index) => {
            const date = new Date(`${holiday.date}T00:00:00Z`);
            const days = daysBetween(today, holiday.date);
            return (
              <li
                key={`${holiday.id}-${holiday.date}`}
                className={`${styles.holidayRow} ${index === 0 ? styles.holidayNext : ''}`}
              >
                <span className={styles.holidayDate} aria-hidden="true">
                  <span className={styles.holidayDay}>
                    {dayFmt.format(date)}
                  </span>
                  <span className={styles.holidayMonth}>
                    {monthFmt.format(date)}
                  </span>
                </span>
                <span className={styles.holidayBody}>
                  <span className={styles.holidayName}>{holiday.name}</span>
                  <span className={styles.holidayMeta}>
                    {weekdayFmt.format(date)}
                    {holiday.locationName ? ` · ${holiday.locationName}` : ''}
                  </span>
                </span>
                <span className={styles.holidayCountdown}>{relativeLabel(days)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <Link href="/time-leave" className={styles.holidayLink}>
        View full calendar
      </Link>
    </section>
  );
}
