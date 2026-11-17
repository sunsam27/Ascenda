import { Injectable } from '@nestjs/common';
import { Prisma } from '@ascenda/db';

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
}
