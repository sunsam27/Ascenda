import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ascenda/db';
import { LeaveStatus, WorkerStatus } from '@ascenda/db';
import {
  type BirthdayInsight,
  type DashboardInsights,
  type DashboardPayrollRun,
  type DashboardSummary,
  type HolidayInsight,
  type LeaveInsight,
  PayrollRunStatus,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getHolidaysForMonth } from './ng-holidays';
import {
  addDays,
  calendarDateIn,
  compareCalendar,
  endOfDay,
  startOfDay,
  startOfMonth,
  startOfNextMonth,
  toIsoDate,
  type CalendarDate,
} from './dashboard.time';

/** Fallback when an organisation has no timezone configured. */
const DEFAULT_TIMEZONE = 'Africa/Lagos';
/** Birthdays are surfaced this many days ahead. */
const BIRTHDAY_HORIZON_DAYS = 60;
/** Upcoming approved leave is surfaced this many days ahead. */
const UPCOMING_LEAVE_HORIZON_DAYS = 30;

const LEAVE_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  worker: {
    select: { firstName: true, lastName: true, preferredName: true },
  },
  leaveType: { select: { name: true } },
} satisfies Prisma.LeaveRequestSelect;

interface WorkerNameParts {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}

function workerName(worker: WorkerNameParts): string {
  const preferred = worker.preferredName?.trim();
  if (preferred) return preferred;
  return `${worker.firstName} ${worker.lastName}`.trim();
}

function toLeaveInsight(
  row: Prisma.LeaveRequestGetPayload<{ select: typeof LEAVE_SELECT }>,
): LeaveInsight {
  return {
    id: row.id,
    workerName: workerName(row.worker),
    leaveTypeName: row.leaveType.name,
    startDate: toIsoDate(calendarDateIn(row.startDate, 'UTC')),
    endDate: toIsoDate(calendarDateIn(row.endDate, 'UTC')),
  };
}

/** The next occurrence of a birthday on/after `today`. */
function nextBirthday(dob: Date, today: CalendarDate): CalendarDate {
  const born = calendarDateIn(dob, 'UTC');
  const candidate: CalendarDate = {
    year: today.year,
    month: born.month,
    day: born.day,
  };
  return compareCalendar(candidate, today) < 0
    ? { ...candidate, year: today.year + 1 }
    : candidate;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Headline KPI numbers for the current organisation. */
  async getSummary(): Promise<DashboardSummary> {
    return this.prisma.withRequestContext(async (tx) => {
      const organisation = await tx.organisation.findFirst({
        select: { timezone: true },
      });
      const timeZone = organisation?.timezone || DEFAULT_TIMEZONE;

      const today = calendarDateIn(new Date(), timeZone);
      const monthStart = startOfDay(startOfMonth(today), timeZone);
      const nextMonthStart = startOfDay(startOfNextMonth(today), timeZone);

      const [totalWorkers, pendingLeaveRequests, newThisMonth, lastRun] =
        await Promise.all([
          tx.worker.count({ where: { status: WorkerStatus.ACTIVE } }),
          tx.leaveRequest.count({ where: { status: LeaveStatus.PENDING } }),
          tx.worker.count({
            where: { startDate: { gte: monthStart, lt: nextMonthStart } },
          }),
          tx.payrollRun.findFirst({
            orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
          }),
        ]);

      const lastPayrollRun: DashboardPayrollRun | null = lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status as unknown as PayrollRunStatus,
            periodLabel: new Intl.DateTimeFormat('en-GB', {
              month: 'long',
              year: 'numeric',
              timeZone,
            }).format(lastRun.periodStart),
            totalNetMinorUnits: lastRun.totalNetMinorUnits,
            currency: lastRun.currency,
            approvedAt: lastRun.approvedAt?.toISOString() ?? null,
          }
        : null;

      return {
        totalWorkers,
        pendingLeaveRequests,
        lastPayrollRun,
        newThisMonth,
      };
    });
  }

  /** Leave, birthdays and public holidays for the insights rail. */
  async getInsights(): Promise<DashboardInsights> {
    return this.prisma.withRequestContext(async (tx) => {
      const organisation = await tx.organisation.findFirst({
        select: { timezone: true, country: true },
      });
      const timeZone = organisation?.timezone || DEFAULT_TIMEZONE;
      const country = organisation?.country || 'NG';

      const today = calendarDateIn(new Date(), timeZone);
      const todayStart = startOfDay(today, timeZone);
      const todayEnd = endOfDay(today, timeZone);
      const leaveHorizonEnd = endOfDay(
        addDays(today, UPCOMING_LEAVE_HORIZON_DAYS),
        timeZone,
      );
      const birthdayHorizon = addDays(today, BIRTHDAY_HORIZON_DAYS);

      const [onLeaveNowRows, upcomingLeaveRows, workers] = await Promise.all([
        tx.leaveRequest.findMany({
          where: {
            status: LeaveStatus.APPROVED,
            startDate: { lte: todayEnd },
            endDate: { gte: todayStart },
          },
          orderBy: { endDate: 'asc' },
          select: LEAVE_SELECT,
        }),
        tx.leaveRequest.findMany({
          where: {
            status: LeaveStatus.APPROVED,
            startDate: { gt: todayEnd, lte: leaveHorizonEnd },
          },
          orderBy: { startDate: 'asc' },
          select: LEAVE_SELECT,
        }),
        tx.worker.findMany({
          where: {
            status: { not: WorkerStatus.TERMINATED },
            workerIdentity: { is: { dateOfBirth: { not: null } } },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            workerIdentity: { select: { dateOfBirth: true } },
          },
        }),
      ]);

      const upcomingBirthdays: BirthdayInsight[] = workers
        .map((worker) => {
          const dob = worker.workerIdentity?.dateOfBirth;
          if (!dob) return null;
          const next = nextBirthday(dob, today);
          const daysAway =
            Math.round(
              (Date.UTC(next.year, next.month - 1, next.day) -
                Date.UTC(today.year, today.month - 1, today.day)) /
                86_400_000,
            );
          if (daysAway < 0 || daysAway > BIRTHDAY_HORIZON_DAYS) return null;
          return {
            workerId: worker.id,
            workerName: workerName(worker),
            date: toIsoDate(next),
          } satisfies BirthdayInsight;
        })
        .filter((entry): entry is BirthdayInsight => entry !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      const holidays: HolidayInsight[] = getHolidaysForMonth(
        country,
        today.year,
        today.month,
      ).map((holiday) => ({ name: holiday.name, date: holiday.date }));

      return {
        onLeaveNow: onLeaveNowRows.map(toLeaveInsight),
        upcomingLeave: upcomingLeaveRows.map(toLeaveInsight),
        upcomingBirthdays,
        holidays,
      };
    });
  }
}
