import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AttendanceSource, AttendanceStatus, AuditAction, Prisma } from '@ascenda/db';
import type {
  AttendanceSummary,
  EffectiveWorkSchedule,
  PaginationMeta,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import {
  NO_ACCESS_WHERE,
  resolveReadScope,
  scopeWhereRestricts,
} from '../../common/rbac/worker-scope';
import {
  AttendanceSchedule,
  clockInStatus,
  computeHoursWorked,
  lateMinutes,
  resolveSchedule,
} from './domain/attendance';
import {
  HolidayLike,
  isWorkingDay,
  startOfUtcDay,
} from './domain/working-days';
import { parseDateOnly } from './holidays.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance.dto';
import { ClockAttendanceDto } from './dto/clock-attendance.dto';
import { AttendanceScheduleQueryDto } from './dto/attendance-schedule.dto';


const ATTENDANCE_INCLUDE = {
  worker: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AttendanceRecordInclude;

type AttendanceRow = Prisma.AttendanceRecordGetPayload<{
  include: typeof ATTENDANCE_INCLUDE;
}>;

export function toAttendanceSummary(
  row: AttendanceRow,
  schedule?: AttendanceSchedule,
): AttendanceSummary {
  const summary: AttendanceSummary = {
    id: row.id,
    organisationId: row.organisationId,
    workerId: row.workerId,
    workerName: `${row.worker.firstName} ${row.worker.lastName}`,
    date: row.date.toISOString().slice(0, 10),
    status: row.status as unknown as AttendanceSummary['status'],
    source: row.source as unknown as AttendanceSummary['source'],
    clockIn: row.clockIn?.toISOString(),
    clockOut: row.clockOut?.toISOString(),
    hoursWorked: row.hoursWorked != null ? Number(row.hoursWorked) : undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (schedule && row.clockIn && row.status === AttendanceStatus.LATE) {
    summary.lateMinutes = lateMinutes(row.clockIn, schedule);
  }
  return summary;
}

const ORG_SCHEDULE_SELECT = {
  workDays: true,
  workDayStart: true,
  workDayEnd: true,
  lateGraceMinutes: true,
} satisfies Prisma.OrganisationSelect;

const LOCATION_SCHEDULE_SELECT = {
  id: true,
  name: true,
  workDays: true,
  workDayStart: true,
  workDayEnd: true,
  lateGraceMinutes: true,
} satisfies Prisma.LocationSelect;

/**
 * Attendance capture (PRD ATT-01) and workday configuration resolution
 * (PRD ATT-02). Balance-safe, tenant-scoped, fully audited.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListAttendanceQueryDto,
  ): Promise<{ data: AttendanceSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    return this.prisma.withRequestContext(async (tx) => {
      const { where: scopeWhere, caller } = await resolveReadScope(
        tx,
        'attendance',
        'read',
      );

      const where: Prisma.AttendanceRecordWhereInput = {};
      if (query.status) {
        where.status =
          query.status as unknown as Prisma.AttendanceRecordWhereInput['status'];
      }
      if (query.workerId) where.workerId = query.workerId;
      if (query.mine && caller) where.workerId = caller.id;

      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.from) dateFilter.gte = parseDateOnly(query.from);
      if (query.to) dateFilter.lte = parseDateOnly(query.to);
      if (Object.keys(dateFilter).length > 0) where.date = dateFilter;

      if (scopeWhereRestricts(scopeWhere)) {
        where.worker = scopeWhere;
      } else if (query.mine && !caller) {
        where.worker = { ...NO_ACCESS_WHERE };
      }

      const [total, rows] = await Promise.all([
        tx.attendanceRecord.count({ where }),
        tx.attendanceRecord.findMany({
          where,
          include: ATTENDANCE_INCLUDE,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map((row) => toAttendanceSummary(row)),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<AttendanceSummary> {
    return this.prisma.withRequestContext(async (tx) => {
      const { where } = await resolveReadScope(tx, 'attendance', 'read');
      const row = await tx.attendanceRecord.findFirst({
        where: scopeWhereRestricts(where) ? { id, worker: where } : { id },
        include: ATTENDANCE_INCLUDE,
      });
      if (!row) throw new NotFoundException('Attendance record not found');
      const schedule = await this.loadSchedule(tx, await this.workerLocation(tx, row.workerId));
      return toAttendanceSummary(row, schedule);
    });
  }

  /** Effective org + per-location work schedule (PRD ATT-02). */
  async getSchedule(query: AttendanceScheduleQueryDto): Promise<EffectiveWorkSchedule> {
    return this.prisma.withRequestContext(async (tx) => {
      let locationId: string | null = null;
      if (query.workerId) {
        const worker = await this.resolveWorker(tx, 'read', query.workerId);
        locationId = worker.locationId;
      }
      return this.resolveEffectiveSchedule(tx, locationId);
    });
  }

  /**
   * Absence days per worker over a pay period (PRD ATT-03): a full absence
   * counts as 1 day, a half day as 0.5. Org-scoped by RLS; it deliberately does
   * NOT apply the caller's read-scope filter, because it backs a trusted payroll
   * calculation.
   */
  async absenceDaysInPeriod(params: {
    periodStart: Date;
    periodEnd: Date;
    workerIds: string[];
  }): Promise<Record<string, number>> {
    return this.prisma.withRequestContext(async (tx) => {
      const result: Record<string, number> = {};
      for (const id of params.workerIds) result[id] = 0;
      if (params.workerIds.length === 0) return result;

      const rows = await tx.attendanceRecord.findMany({
        where: {
          workerId: { in: params.workerIds },
          date: { gte: params.periodStart, lte: params.periodEnd },
          status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.HALF_DAY] },
        },
        select: { workerId: true, status: true },
      });

      for (const row of rows) {
        const days = row.status === AttendanceStatus.ABSENT ? 1 : 0.5;
        result[row.workerId] = (result[row.workerId] ?? 0) + days;
      }
      return result;
    });
  }

  /** Manual attendance entry / upsert by a manager or HR (PRD ATT-01). */
  async record(dto: CreateAttendanceDto): Promise<AttendanceSummary> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const worker = await this.resolveWorker(tx, 'create', dto.workerId);
      const day = startOfUtcDay(parseDateOnly(dto.date));
      const schedule = await this.loadSchedule(tx, worker.locationId);
      const workingDay = await this.isWorkingDayFor(tx, worker.locationId, day);

      const clockIn = dto.clockIn ? new Date(dto.clockIn) : null;
      const clockOut = dto.clockOut ? new Date(dto.clockOut) : null;
      if (clockIn && clockOut && clockOut.getTime() < clockIn.getTime()) {
        throw new BadRequestException('clockOut cannot be before clockIn');
      }

      const status: AttendanceStatus =
        dto.status != null
          ? (dto.status as unknown as AttendanceStatus)
          : clockIn
            ? (clockInStatus({ clockIn, isWorkingDay: workingDay, schedule }) as unknown as AttendanceStatus)
            : workingDay
              ? AttendanceStatus.PRESENT
              : AttendanceStatus.OFF_DAY;

      let hours = dto.hoursWorked;
      if (hours === undefined && clockIn && clockOut) {
        hours = computeHoursWorked(clockIn, clockOut);
      }

      const existing = await tx.attendanceRecord.findUnique({
        where: {
          organisationId_workerId_date: {
            organisationId,
            workerId: worker.id,
            date: day,
          },
        },
        include: ATTENDANCE_INCLUDE,
      });

      const data = {
        status,
        source: AttendanceSource.MANUAL,
        clockIn,
        clockOut,
        hoursWorked: hours ?? null,
        notes: dto.notes ?? null,
      };

      const row = existing
        ? await tx.attendanceRecord.update({
            where: { id: existing.id },
            data,
            include: ATTENDANCE_INCLUDE,
          })
        : await tx.attendanceRecord.create({
            data: {
              organisationId,
              createdBy: userId,
              workerId: worker.id,
              date: day,
              ...data,
            },
            include: ATTENDANCE_INCLUDE,
          });

      await this.audit.record({
        action: AuditAction.ATTENDANCE_RECORDED,
        targetType: 'attendance_records',
        targetId: row.id,
        previousValue: existing ? this.auditValue(existing) : undefined,
        newValue: { ...this.auditValue(row), manual: true },
      });

      return toAttendanceSummary(row, schedule);
    });
  }

  async update(id: string, dto: UpdateAttendanceDto): Promise<AttendanceSummary> {
    return this.prisma.withRequestContext(async (tx) => {
      const { where } = await resolveReadScope(tx, 'attendance', 'update');
      const existing = await tx.attendanceRecord.findFirst({
        where: scopeWhereRestricts(where) ? { id, worker: where } : { id },
        include: ATTENDANCE_INCLUDE,
      });
      if (!existing) throw new NotFoundException('Attendance record not found');

      const clockIn = dto.clockIn !== undefined ? new Date(dto.clockIn) : existing.clockIn;
      const clockOut = dto.clockOut !== undefined ? new Date(dto.clockOut) : existing.clockOut;
      if (clockIn && clockOut && clockOut.getTime() < clockIn.getTime()) {
        throw new BadRequestException('clockOut cannot be before clockIn');
      }

      let hours = dto.hoursWorked;
      if (hours === undefined && clockIn && clockOut) {
        hours = computeHoursWorked(clockIn, clockOut);
      }

      const row = await tx.attendanceRecord.update({
        where: { id },
        data: {
          status:
            dto.status !== undefined
              ? (dto.status as unknown as AttendanceStatus)
              : undefined,
          clockIn: dto.clockIn !== undefined ? clockIn : undefined,
          clockOut: dto.clockOut !== undefined ? clockOut : undefined,
          hoursWorked: hours !== undefined ? hours : undefined,
          notes: dto.notes !== undefined ? dto.notes : undefined,
        },
        include: ATTENDANCE_INCLUDE,
      });

      await this.audit.record({
        action: AuditAction.ATTENDANCE_RECORDED,
        targetType: 'attendance_records',
        targetId: row.id,
        previousValue: this.auditValue(existing),
        newValue: this.auditValue(row),
      });

      const schedule = await this.loadSchedule(tx, await this.workerLocation(tx, row.workerId));
      return toAttendanceSummary(row, schedule);
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    return this.prisma.withRequestContext(async (tx) => {
      const { where } = await resolveReadScope(tx, 'attendance', 'delete');
      const existing = await tx.attendanceRecord.findFirst({
        where: scopeWhereRestricts(where) ? { id, worker: where } : { id },
        select: { id: true, workerId: true, date: true, status: true },
      });
      if (!existing) throw new NotFoundException('Attendance record not found');

      await tx.attendanceRecord.delete({ where: { id } });

      await this.audit.record({
        action: AuditAction.ATTENDANCE_RECORDED,
        targetType: 'attendance_records',
        targetId: id,
        previousValue: {
          workerId: existing.workerId,
          date: existing.date.toISOString().slice(0, 10),
          status: existing.status,
          deleted: true,
        },
      });

      return { id };
    });
  }

  /** Clock in for a day (self, or on behalf of a team worker). PRD ATT-01. */
  async clockIn(dto: ClockAttendanceDto): Promise<AttendanceSummary> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const worker = await this.resolveWorker(tx, 'create', dto.workerId);
      const at = this.parseInstant(dto.at);
      const day = startOfUtcDay(at);
      const schedule = await this.loadSchedule(tx, worker.locationId);
      const workingDay = await this.isWorkingDayFor(tx, worker.locationId, day);
      const status = clockInStatus({ clockIn: at, isWorkingDay: workingDay, schedule });

      const existing = await tx.attendanceRecord.findUnique({
        where: {
          organisationId_workerId_date: {
            organisationId,
            workerId: worker.id,
            date: day,
          },
        },
        include: ATTENDANCE_INCLUDE,
      });

      const row = existing
        ? await tx.attendanceRecord.update({
            where: { id: existing.id },
            data: {
              clockIn: at,
              source: AttendanceSource.CLOCK_IN_OUT,
              status: status as unknown as AttendanceStatus,
              notes: dto.notes ?? existing.notes,
            },
            include: ATTENDANCE_INCLUDE,
          })
        : await tx.attendanceRecord.create({
            data: {
              organisationId,
              createdBy: userId,
              workerId: worker.id,
              date: day,
              clockIn: at,
              source: AttendanceSource.CLOCK_IN_OUT,
              status: status as unknown as AttendanceStatus,
              notes: dto.notes ?? null,
            },
            include: ATTENDANCE_INCLUDE,
          });

      await this.audit.record({
        action: AuditAction.ATTENDANCE_RECORDED,
        targetType: 'attendance_records',
        targetId: row.id,
        previousValue: existing ? this.auditValue(existing) : undefined,
        newValue: { ...this.auditValue(row), event: 'CLOCK_IN' },
      });

      return toAttendanceSummary(row, schedule);
    });
  }

  /** Clock out for a day; requires an existing clock-in. PRD ATT-01. */
  async clockOut(dto: ClockAttendanceDto): Promise<AttendanceSummary> {
    const { organisationId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const worker = await this.resolveWorker(tx, 'create', dto.workerId);
      const at = this.parseInstant(dto.at);
      const day = startOfUtcDay(at);
      const schedule = await this.loadSchedule(tx, worker.locationId);

      const existing = await tx.attendanceRecord.findUnique({
        where: {
          organisationId_workerId_date: {
            organisationId,
            workerId: worker.id,
            date: day,
          },
        },
        include: ATTENDANCE_INCLUDE,
      });
      if (!existing || !existing.clockIn) {
        throw new ConflictException('No clock-in found for this day');
      }

      const hoursWorked = computeHoursWorked(existing.clockIn, at);
      const row = await tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          clockOut: at,
          hoursWorked,
          source: AttendanceSource.CLOCK_IN_OUT,
          notes: dto.notes ?? existing.notes,
        },
        include: ATTENDANCE_INCLUDE,
      });

      await this.audit.record({
        action: AuditAction.ATTENDANCE_RECORDED,
        targetType: 'attendance_records',
        targetId: row.id,
        previousValue: this.auditValue(existing),
        newValue: { ...this.auditValue(row), event: 'CLOCK_OUT' },
      });

      return toAttendanceSummary(row, schedule);
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private auditValue(row: AttendanceRow): Record<string, unknown> {
    return {
      workerId: row.workerId,
      date: row.date.toISOString().slice(0, 10),
      status: row.status,
      source: row.source,
      clockIn: row.clockIn?.toISOString() ?? null,
      clockOut: row.clockOut?.toISOString() ?? null,
      hoursWorked: row.hoursWorked != null ? Number(row.hoursWorked) : null,
    };
  }

  private parseInstant(value: string | undefined): Date {
    const at = value ? new Date(value) : new Date();
    if (Number.isNaN(at.getTime())) {
      throw new BadRequestException('at must be a valid ISO datetime');
    }
    return at;
  }

  private async workerLocation(
    tx: Prisma.TransactionClient,
    workerId: string,
  ): Promise<string | null> {
    const worker = await tx.worker.findFirst({
      where: { id: workerId },
      select: { locationId: true },
    });
    return worker?.locationId ?? null;
  }

  private async resolveEffectiveSchedule(
    tx: Prisma.TransactionClient,
    locationId: string | null,
  ): Promise<EffectiveWorkSchedule> {
    const org = await tx.organisation.findFirst({ select: ORG_SCHEDULE_SELECT });
    const location = locationId
      ? await tx.location.findFirst({
          where: { id: locationId },
          select: LOCATION_SCHEDULE_SELECT,
        })
      : null;

    const schedule = resolveSchedule(org, location);
    const hasOverride =
      !!location &&
      (location.workDays.length > 0 ||
        location.workDayStart !== null ||
        location.workDayEnd !== null ||
        location.lateGraceMinutes !== null);

    return {
      ...schedule,
      scope: hasOverride ? 'LOCATION' : 'ORGANISATION',
      locationId: location?.id,
      locationName: location?.name,
    };
  }

  private async loadSchedule(
    tx: Prisma.TransactionClient,
    locationId: string | null,
  ): Promise<AttendanceSchedule> {
    const schedule = await this.resolveEffectiveSchedule(tx, locationId);
    return {
      workDays: schedule.workDays,
      workDayStart: schedule.workDayStart,
      workDayEnd: schedule.workDayEnd,
      lateGraceMinutes: schedule.lateGraceMinutes,
    };
  }

  private async isWorkingDayFor(
    tx: Prisma.TransactionClient,
    locationId: string | null,
    day: Date,
  ): Promise<boolean> {
    const schedule = await this.loadSchedule(tx, locationId);
    const holidays = await this.loadHolidays(tx, locationId, day);
    return isWorkingDay(day, schedule, holidays);
  }

  private async loadHolidays(
    tx: Prisma.TransactionClient,
    locationId: string | null,
    day: Date,
  ): Promise<HolidayLike[]> {
    const rows = await tx.holiday.findMany({
      where: {
        AND: [
          {
            OR: [
              { isRecurring: true, date: { lte: day } },
              { isRecurring: false, date: day },
            ],
          },
          {
            OR: [
              { locationId: null },
              ...(locationId ? [{ locationId }] : []),
            ],
          },
        ],
      },
      select: { date: true, isRecurring: true },
    });
    return rows;
  }

  /**
   * Resolve which worker an operation targets. With an explicit `workerId` the
   * worker must be inside the caller's scope (per action); without one the
   * caller's own linked worker profile is used.
   */
  private async resolveWorker(
    tx: Prisma.TransactionClient,
    action: 'read' | 'create' | 'update',
    workerId: string | undefined,
  ): Promise<{ id: string; locationId: string | null }> {
    const { where, caller } = await resolveReadScope(tx, 'attendance', action);
    if (workerId) {
      const worker = await tx.worker.findFirst({
        where: scopeWhereRestricts(where)
          ? { AND: [where, { id: workerId }] }
          : { id: workerId },
        select: { id: true, locationId: true },
      });
      if (!worker) throw new ForbiddenException('Worker is outside your scope');
      return worker;
    }
    if (!caller) {
      throw new BadRequestException('No worker profile is linked to your account');
    }
    return { id: caller.id, locationId: caller.locationId };
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }

  async overtimeMinutesInPeriod(params: {
    periodStart: Date;
    periodEnd: Date;
    workerIds: string[];
    standardDailyMinutes?: number;
  }): Promise<Record<string, number>> {
    const standardDailyMinutes = params.standardDailyMinutes ?? 480;
    return this.prisma.withRequestContext(async (tx) => {
      const result: Record<string, number> = {};
      for (const id of params.workerIds) result[id] = 0;
      if (params.workerIds.length === 0) return result;

      const rows = await tx.attendanceRecord.findMany({
        where: {
          workerId: { in: params.workerIds },
          date: { gte: params.periodStart, lte: params.periodEnd },
          hoursWorked: { not: null },
        },
        select: { workerId: true, hoursWorked: true },
      });

      for (const row of rows) {
        const hours = row.hoursWorked ? Number(row.hoursWorked) : 0;
        if (hours <= 0) continue;
        const workedMinutes = Math.round(hours * 60);
        const overtime = workedMinutes - standardDailyMinutes;
        if (overtime > 0) {
          result[row.workerId] = (result[row.workerId] ?? 0) + overtime;
        }
      }
      return result;
    });
  }
}
