import { Injectable } from '@nestjs/common';
import { Prisma } from '@ascenda/db';
import { resolveSchedule } from './domain/attendance';
import {
  scheduledAttendanceForWorker,
  type ScheduledAttendanceLeave,
  type ScheduledAttendanceRecord,
} from './domain/scheduled-attendance';

/** ANA-03 aggregate interface. Never selects leave reasons or clock-in locations. */
@Injectable()
export class TimeLeaveAnalyticsReader {
  attendance(
    tx: Prisma.TransactionClient,
    organisationId: string,
    scope: Prisma.WorkerWhereInput,
    start: Date,
    endExclusive: Date,
  ) {
    return tx.attendanceRecord.groupBy({
      by: ['workerId', 'status'],
      where: { organisationId, worker: { is: scope }, date: { gte: start, lt: endExclusive } },
      _count: true,
    });
  }

  leave(
    tx: Prisma.TransactionClient,
    organisationId: string,
    scope: Prisma.WorkerWhereInput,
    start: Date,
    endExclusive: Date,
  ) {
    // Frozen booked duration, not a recalculation using today's schedule/holidays.
    return tx.leaveRequest.groupBy({
      by: ['workerId'],
      where: {
        organisationId,
        worker: { is: scope },
        status: 'APPROVED',
        startDate: { gte: start, lt: endExclusive },
      },
      _sum: { days: true },
      _count: true,
    });
  }

  /** Projected by leave type without reasons, medical details or clock locations. */
  async leaveByType(
    tx: Prisma.TransactionClient,
    organisationId: string,
    scope: Prisma.WorkerWhereInput,
    start: Date,
    endExclusive: Date,
  ) {
    const rows = await tx.leaveRequest.findMany({
      where: {
        organisationId,
        worker: { is: scope },
        status: 'APPROVED',
        startDate: { gte: start, lt: endExclusive },
      },
      select: {
        workerId: true,
        leaveTypeId: true,
        days: true,
        leaveType: { select: { name: true, category: true } },
      },
    });
    return rows.map((row) => ({
      leaveTypeId: row.leaveTypeId,
      label: row.leaveType.name,
      category: row.leaveType.category,
      workerId: row.workerId,
      days: Number(row.days),
    }));
  }

  /**
   * ANA-03 scheduled-working-day denominator. All reads use the caller's RLS
   * transaction and explicit organisation predicates; only aggregate day counts
   * leave this method. Schedule/holiday resolution reuses the ATT-02/LVE-03
   * domain rules rather than duplicating them in analytics.
   */
  async scheduledAttendance(
    tx: Prisma.TransactionClient,
    organisationId: string,
    scope: Prisma.WorkerWhereInput,
    start: Date,
    endExclusive: Date,
  ): Promise<{ workerId: string; scheduledDays: number; attendedDays: number }[]> {
    const endInclusive = new Date(endExclusive.getTime() - 86_400_000);
    const [workers, org, locations, holidays, attendance, leave] = await Promise.all([
      tx.worker.findMany({
        where: { AND: [{ organisationId }, scope, { status: { not: 'DRAFT' } }] },
        select: { id: true, startDate: true, endDate: true, locationId: true },
      }),
      tx.organisation.findFirst({
        where: { id: organisationId },
        select: {
          workDays: true,
          workDayStart: true,
          workDayEnd: true,
          lateGraceMinutes: true,
        },
      }),
      tx.location.findMany({
        where: { organisationId },
        select: {
          id: true,
          workDays: true,
          workDayStart: true,
          workDayEnd: true,
          lateGraceMinutes: true,
        },
      }),
      tx.holiday.findMany({
        where: {
          organisationId,
          AND: [
            {
              OR: [
                {
                  date: {
                    gte: new Date(Date.UTC(start.getUTCFullYear(), 0, 1)),
                    lte: new Date(Date.UTC(endInclusive.getUTCFullYear(), 11, 31)),
                  },
                },
                {
                  isRecurring: true,
                  date: { lte: new Date(Date.UTC(endInclusive.getUTCFullYear(), 11, 31)) },
                },
              ],
            },
          ],
        },
        select: { date: true, isRecurring: true, locationId: true },
      }),
      tx.attendanceRecord.findMany({
        where: { organisationId, worker: { is: scope }, date: { gte: start, lt: endExclusive } },
        select: { workerId: true, date: true, status: true },
      }),
      tx.leaveRequest.findMany({
        where: {
          organisationId,
          worker: { is: scope },
          status: 'APPROVED',
          startDate: { lte: endInclusive },
          endDate: { gte: start },
        },
        select: {
          workerId: true,
          startDate: true,
          endDate: true,
          startHalfDay: true,
          endHalfDay: true,
        },
      }),
    ]);

    const locationById = new Map(locations.map((location) => [location.id, location]));
    const attendanceByWorker = new Map<string, ScheduledAttendanceRecord[]>();
    for (const row of attendance) {
      const rows = attendanceByWorker.get(row.workerId) ?? [];
      rows.push({ date: row.date, status: row.status as ScheduledAttendanceRecord['status'] });
      attendanceByWorker.set(row.workerId, rows);
    }
    const leaveByWorker = new Map<string, ScheduledAttendanceLeave[]>();
    for (const row of leave) {
      const rows = leaveByWorker.get(row.workerId) ?? [];
      rows.push({
        startDate: row.startDate,
        endDate: row.endDate,
        startHalfDay: row.startHalfDay,
        endHalfDay: row.endHalfDay,
      });
      leaveByWorker.set(row.workerId, rows);
    }

    return workers.map((worker) => {
      const schedule = resolveSchedule(
        org,
        worker.locationId ? (locationById.get(worker.locationId) ?? null) : null,
      );
      return scheduledAttendanceForWorker(
        {
          workerId: worker.id,
          startDate: worker.startDate,
          endDate: worker.endDate,
          schedule,
          holidays: holidays.filter(
            (holiday) => holiday.locationId === null || holiday.locationId === worker.locationId,
          ),
          attendance: attendanceByWorker.get(worker.id) ?? [],
          leave: leaveByWorker.get(worker.id) ?? [],
        },
        start,
        endInclusive,
      );
    });
  }
}
