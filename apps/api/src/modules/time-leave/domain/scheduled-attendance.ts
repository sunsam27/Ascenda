// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED ATTENDANCE (ANA-03)
// Pure functions — no I/O, no Prisma. Turns a worker's effective schedule,
// holidays, recorded attendance and approved leave into scheduled/attended
// day counts. All dates are treated as UTC-midnight civil dates, matching
// `domain/working-days.ts` and `@db.Date` columns.
// ─────────────────────────────────────────────────────────────────────────────
import type { AttendanceStatusValue } from './attendance';
import {
  eachDay,
  isWorkingDay,
  roundHalf,
  startOfUtcDay,
  type HolidayLike,
  type WorkSchedule,
} from './working-days';

/** Statuses that count as attendance on a scheduled working day. */
const ATTENDED_STATUSES: ReadonlySet<AttendanceStatusValue> = new Set([
  'PRESENT',
  'LATE',
  'REMOTE',
]);

export interface ScheduledAttendanceRecord {
  date: Date;
  status: AttendanceStatusValue;
}

export interface ScheduledAttendanceLeave {
  startDate: Date;
  endDate: Date;
  startHalfDay: boolean;
  endHalfDay: boolean;
}

export interface ScheduledAttendanceWorkerInput {
  workerId: string;
  startDate: Date;
  endDate: Date | null;
  schedule: WorkSchedule;
  holidays: HolidayLike[];
  attendance: ScheduledAttendanceRecord[];
  leave: ScheduledAttendanceLeave[];
}

export interface ScheduledAttendanceWorkerResult {
  workerId: string;
  /** Scheduled working days in range, net of approved leave (half days allowed). */
  scheduledDays: number;
  /** Days with PRESENT/LATE/REMOTE records, or 0.5 for HALF_DAY, capped by scheduled days. */
  attendedDays: number;
}

function time(value: Date): number {
  return startOfUtcDay(value).getTime();
}

/**
 * Fraction of a scheduled working day covered by approved leave requests:
 * 1 for a full day, 0.5 for a half-day marker. Complementary half-day requests
 * combine to a full day; overlapping requests never remove more than the day
 * itself.
 */
function leaveDeduction(day: Date, leave: ScheduledAttendanceLeave[]): number {
  let deduction = 0;
  const target = time(day);
  for (const request of leave) {
    const start = time(request.startDate);
    const end = time(request.endDate);
    if (target < start || target > end) continue;
    const half =
      (request.startHalfDay && target === start) || (request.endHalfDay && target === end);
    deduction += half ? 0.5 : 1;
  }
  return Math.min(1, deduction);
}

/** Attendance fraction for a single day from its record status. */
function attendanceCredit(status: AttendanceStatusValue): number {
  if (ATTENDED_STATUSES.has(status)) return 1;
  return status === 'HALF_DAY' ? 0.5 : 0;
}

/**
 * Count scheduled and attended days for one worker over an inclusive date range.
 * Weekends/holidays and days outside the worker's recorded employment dates are
 * excluded. Approved leave is removed from the denominator; a scheduled day
 * with no qualifying record is counted as not attended.
 */
export function scheduledAttendanceForWorker(
  input: ScheduledAttendanceWorkerInput,
  rangeStart: Date,
  rangeEndInclusive: Date,
): ScheduledAttendanceWorkerResult {
  const first = time(rangeStart);
  const last = time(rangeEndInclusive);
  const employmentStart = time(input.startDate);
  const employmentEnd = input.endDate ? time(input.endDate) : null;

  const records = new Map<number, AttendanceStatusValue>();
  for (const record of input.attendance) records.set(time(record.date), record.status);

  let scheduledDays = 0;
  let attendedDays = 0;
  for (const day of eachDay(rangeStart, rangeEndInclusive)) {
    if (!isWorkingDay(day, input.schedule, input.holidays)) continue;
    const current = time(day);
    if (current < first || current > last) continue;
    if (current < employmentStart || (employmentEnd !== null && current > employmentEnd)) continue;

    const available = 1 - leaveDeduction(day, input.leave);
    if (available <= 0) continue;
    scheduledDays += available;
    attendedDays += Math.min(available, attendanceCredit(records.get(current) ?? 'ABSENT'));
  }

  return {
    workerId: input.workerId,
    scheduledDays: roundHalf(scheduledDays),
    attendedDays: roundHalf(attendedDays),
  };
}
