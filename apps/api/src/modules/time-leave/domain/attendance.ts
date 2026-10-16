// ─────────────────────────────────────────────────────────────────────────────
// ATTENDANCE MATH (PRD ATT-01 / ATT-02)
// Pure functions — no I/O, no Prisma. Times are simple "HH:mm" strings and are
// interpreted against the record's UTC clock, matching `domain/working-days.ts`.
// Scheduled start/end/grace resolution follows the same org-default-with-
// per-location-override rule used by leave.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_WORK_SCHEDULE, WorkSchedule } from './working-days';

/** Mirrors the ATT-02 statuses (kept local so the domain stays dependency-free). */
export type AttendanceStatusValue =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'REMOTE'
  | 'ON_LEAVE'
  | 'HALF_DAY'
  | 'OFF_DAY';

export interface AttendanceSchedule extends WorkSchedule {
  lateGraceMinutes: number;
}

/** Organisation-level schedule input (all fields required). */
export interface OrganisationScheduleInput {
  workDays: number[];
  workDayStart: string;
  workDayEnd: string;
  lateGraceMinutes: number;
}

/** Per-location overrides; `null`/empty means "inherit the organisation". */
export interface LocationScheduleInput {
  workDays: number[];
  workDayStart: string | null;
  workDayEnd: string | null;
  lateGraceMinutes: number | null;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_ATTENDANCE_SCHEDULE: AttendanceSchedule = {
  ...DEFAULT_WORK_SCHEDULE,
  lateGraceMinutes: 0,
};

/** Parse "HH:mm" into minutes since midnight (throws on malformed input). */
export function parseTimeToMinutes(value: string): number {
  const match = HHMM_RE.exec(value);
  if (!match) throw new Error(`Invalid HH:mm time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Resolve the effective work schedule: organisation defaults, overridden by any
 * per-location values that are present (PRD ATT-02).
 */
export function resolveSchedule(
  org: OrganisationScheduleInput | null,
  location: LocationScheduleInput | null,
): AttendanceSchedule {
  const base: AttendanceSchedule = org
    ? {
        workDays: org.workDays.length
          ? org.workDays
          : DEFAULT_WORK_SCHEDULE.workDays,
        workDayStart: org.workDayStart,
        workDayEnd: org.workDayEnd,
        lateGraceMinutes: org.lateGraceMinutes,
      }
    : { ...DEFAULT_ATTENDANCE_SCHEDULE };

  if (!location) return base;
  return {
    workDays: location.workDays.length ? location.workDays : base.workDays,
    workDayStart: location.workDayStart ?? base.workDayStart,
    workDayEnd: location.workDayEnd ?? base.workDayEnd,
    lateGraceMinutes: location.lateGraceMinutes ?? base.lateGraceMinutes,
  };
}

/** Contracted minutes in a standard working day (never negative). */
export function scheduledMinutes(schedule: AttendanceSchedule): number {
  return Math.max(
    0,
    parseTimeToMinutes(schedule.workDayEnd) -
      parseTimeToMinutes(schedule.workDayStart),
  );
}

/** Minutes elapsed since UTC midnight for a timestamp. */
export function minutesSinceMidnight(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

/** True when a clock-in is later than the scheduled start plus the grace period. */
export function isLate(clockIn: Date, schedule: AttendanceSchedule): boolean {
  return (
    minutesSinceMidnight(clockIn) >
    parseTimeToMinutes(schedule.workDayStart) + schedule.lateGraceMinutes
  );
}

/** Minutes past the scheduled start (0 when on time or early). */
export function lateMinutes(clockIn: Date, schedule: AttendanceSchedule): number {
  return Math.max(
    0,
    minutesSinceMidnight(clockIn) - parseTimeToMinutes(schedule.workDayStart),
  );
}

/**
 * Derive the status for a clock-in (PRD ATT-02): a non-working day is OFF_DAY,
 * a late arrival is LATE, otherwise PRESENT.
 */
export function clockInStatus(input: {
  clockIn: Date;
  isWorkingDay: boolean;
  schedule: AttendanceSchedule;
}): AttendanceStatusValue {
  if (!input.isWorkingDay) return 'OFF_DAY';
  return isLate(input.clockIn, input.schedule) ? 'LATE' : 'PRESENT';
}

/** Hours between two timestamps, rounded to 2dp (0 when not positive). */
export function computeHoursWorked(clockIn: Date, clockOut: Date): number {
  const ms = clockOut.getTime() - clockIn.getTime();
  if (ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}
