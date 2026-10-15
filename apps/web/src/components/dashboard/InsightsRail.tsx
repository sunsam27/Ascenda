'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cake,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plane,
} from 'lucide-react';
import type { DashboardInsights, LeaveInsight } from '@ascenda/types';
import styles from './InsightsRail.module.css';

interface InsightsRailProps {
  data: DashboardInsights | null;
  loading?: boolean;
  /** True when the viewer cannot access team leave/insight data. */
  unavailable?: boolean;
}

type Slide =
  | { kind: 'birthday'; key: string; title: string; date: string }
  | { kind: 'holiday'; key: string; title: string; date: string };

const ROTATE_MS = 5000;

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
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    timeZone: 'UTC',
  });
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });
  if (sameMonth) {
    return `${day.format(start)}–${day.format(end)} ${month.format(end)}`;
  }
  return `${day.format(start)} ${month.format(start)} – ${day.format(end)} ${month.format(end)}`;
}

function LeaveRow({ leave }: { leave: LeaveInsight }) {
  return (
    <li className={styles.item}>
      <span className={styles.itemIcon} aria-hidden="true">
        <Plane size={16} strokeWidth={1.75} />
      </span>
      <span className={styles.itemBody}>
        <span className={styles.itemName}>{leave.workerName}</span>
        <span className={styles.itemMeta}>
          {leave.leaveTypeName} · {formatRange(leave.startDate, leave.endDate)}
        </span>
      </span>
    </li>
  );
}

export default function InsightsRail({
  data,
  loading = false,
  unavailable = false,
}: InsightsRailProps) {
  const slides: Slide[] = useMemo(() => {
    if (!data) return [];
    const birthdays: Slide[] = data.upcomingBirthdays.map((birthday) => ({
      kind: 'birthday',
      key: `birthday-${birthday.workerId}-${birthday.date}`,
      title: birthday.workerName,
      date: birthday.date,
    }));
    const holidays: Slide[] = data.holidays.map((holiday) => ({
      kind: 'holiday',
      key: `holiday-${holiday.date}-${holiday.name}`,
      title: holiday.name,
      date: holiday.date,
    }));
    return [...birthdays, ...holidays];
  }, [data]);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (paused || reducedMotion.current || slides.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  useEffect(() => {
    setIndex(0);
  }, [slides.length]);

  const onLeaveNow = data?.onLeaveNow ?? [];
  const upcomingLeave = data?.upcomingLeave ?? [];
  const activeSlide = slides.length > 0 ? slides[index % slides.length] : null;

  const go = (delta: number) => {
    if (slides.length === 0) return;
    setIndex((current) => (current + delta + slides.length) % slides.length);
  };

  if (unavailable) {
    return (
      <section className={`glass ${styles.card}`} aria-label="Team insights">
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Team insights</h2>
          <p className={styles.empty}>
            Team leave and holiday insights are limited to HR and managers.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={`glass ${styles.card}`} aria-label="Team insights">
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>On leave now</h2>
        {loading ? (
          <div className={styles.skeletonList} aria-hidden="true">
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLine} />
          </div>
        ) : onLeaveNow.length === 0 ? (
          <p className={styles.empty}>No one is on leave right now.</p>
        ) : (
          <ul className={`${styles.list} ${styles.scroll}`} role="list">
            {onLeaveNow.map((leave) => (
              <LeaveRow key={leave.id} leave={leave} />
            ))}
          </ul>
        )}
      </div>

      <div className={styles.divider} role="separator" />

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Upcoming leave</h2>
        {loading ? (
          <div className={styles.skeletonList} aria-hidden="true">
            <span className={styles.skeletonLine} />
          </div>
        ) : upcomingLeave.length === 0 ? (
          <p className={styles.empty}>No approved leave in the next 30 days.</p>
        ) : (
          <ul className={`${styles.list} ${styles.scroll}`} role="list">
            {upcomingLeave.map((leave) => (
              <LeaveRow key={leave.id} leave={leave} />
            ))}
          </ul>
        )}
      </div>

      <div className={styles.divider} role="separator" />

      <div
        className={styles.carousel}
        aria-roledescription="carousel"
        aria-label="Upcoming birthdays and holidays"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <h2 className={styles.sectionTitle}>Coming up</h2>

        {loading ? (
          <div className={styles.skeletonSlide} aria-hidden="true">
            <span className={styles.skeletonIcon} />
            <div className={styles.skeletonList}>
              <span className={styles.skeletonLine} />
              <span className={styles.skeletonLineShort} />
            </div>
          </div>
        ) : !activeSlide ? (
          <p className={styles.empty}>Nothing coming up this month.</p>
        ) : (
          <div className={styles.slide} key={activeSlide.key}>
            <span
              className={`${styles.slideIcon} ${
                activeSlide.kind === 'birthday'
                  ? styles.slideIconBirthday
                  : styles.slideIconHoliday
              }`}
              aria-hidden="true"
            >
              {activeSlide.kind === 'birthday' ? (
                <Cake size={18} strokeWidth={1.75} />
              ) : (
                <CalendarDays size={18} strokeWidth={1.75} />
              )}
            </span>
            <div className={styles.slideBody}>
              <p className={styles.slideTitle}>
                {activeSlide.kind === 'birthday'
                  ? `${activeSlide.title}'s birthday`
                  : activeSlide.title}
              </p>
              <p className={styles.slideMeta}>
                {activeSlide.kind === 'birthday' ? 'Birthday · ' : 'Public holiday · '}
                {formatDay(activeSlide.date)}
              </p>
            </div>
          </div>
        )}

        {!loading && slides.length > 1 && (
          <div className={styles.controls}>
            <div className={styles.dots}>
              {slides.map((slide, i) => (
                <button
                  key={slide.key}
                  type="button"
                  className={`${styles.dot} ${
                    i === index % slides.length ? styles.dotActive : ''
                  }`}
                  aria-label={`Show slide ${i + 1} of ${slides.length}`}
                  aria-current={i === index % slides.length}
                  onClick={() => setIndex(i)}
                />
              ))}
            </div>
            <div className={styles.arrows}>
              <button
                type="button"
                className={styles.arrowBtn}
                aria-label="Previous"
                onClick={() => go(-1)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.arrowBtn}
                aria-label="Next"
                onClick={() => go(1)}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
