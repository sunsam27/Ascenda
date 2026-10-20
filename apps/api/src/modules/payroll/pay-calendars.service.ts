import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@ascenda/db';
import type { PayCalendar, PayCalendarPeriod } from '@ascenda/types';
import { AuditAction } from '@ascenda/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import {
  CreatePayCalendarDto,
  ListPayCalendarsQueryDto,
  UpdatePayCalendarDto,
} from './dto/pay-calendar.dto';
import {
  PayCalendarConfig,
  isBeforeCutOff,
  payPeriodsForYear,
  validateCalendarConfig,
} from './domain/pay-calendar';

type PayCalendarRow = Prisma.PayCalendarGetPayload<Record<string, never>>;

export function toPayCalendar(row: PayCalendarRow): PayCalendar {
  return {
    id: row.id,
    organisationId: row.organisationId,
    name: row.name,
    frequency: row.frequency as PayCalendar['frequency'],
    dayOfMonth: row.dayOfMonth ?? undefined,
    dayOfWeek: row.dayOfWeek ?? undefined,
    cutOffDayOfMonth: row.cutOffDayOfMonth ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/**
 * Pay calendars (PRD PAY-04). Period maths lives in the pure
 * `domain/pay-calendar.ts`; this service owns persistence, tenant scoping and
 * audit. Every write emits a PAY_CALENDAR_CHANGED audit event.
 */
@Injectable()
export class PayCalendarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListPayCalendarsQueryDto): Promise<{
    data: PayCalendar[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const where = {};
      const [rows, total] = await Promise.all([
        tx.payCalendar.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.payCalendar.count({ where }),
      ]);
      return {
        data: rows.map(toPayCalendar),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<PayCalendar> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payCalendar.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Pay calendar not found');
      return toPayCalendar(row);
    });
  }

  /** Every pay period that overlaps `year`, plus whether the cut-off is open. */
  async periods(id: string, year: number): Promise<PayCalendarPeriod[]> {
    const calendar = await this.get(id);
    const now = new Date();
    return payPeriodsForYear(
      {
        frequency: calendar.frequency,
        dayOfMonth: calendar.dayOfMonth ?? null,
        dayOfWeek: calendar.dayOfWeek ?? null,
        cutOffDayOfMonth: calendar.cutOffDayOfMonth ?? null,
      },
      year,
    ).map((period) => ({
      periodStart: period.periodStart.toISOString().slice(0, 10),
      periodEnd: period.periodEnd.toISOString().slice(0, 10),
      payDate: period.payDate.toISOString().slice(0, 10),
      beforeCutOff: isBeforeCutOff(
        {
          frequency: calendar.frequency,
          dayOfMonth: calendar.dayOfMonth ?? null,
          dayOfWeek: calendar.dayOfWeek ?? null,
          cutOffDayOfMonth: calendar.cutOffDayOfMonth ?? null,
        },
        period,
        now,
      ),
    }));
  }

  async create(dto: CreatePayCalendarDto): Promise<PayCalendar> {
    const { organisationId } = this.requireContext();
    this.assertValidConfig(dto);
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payCalendar.create({
        data: {
          organisationId,
          createdBy: this.actorId(),
          name: dto.name,
          frequency: dto.frequency,
          dayOfMonth: dto.dayOfMonth ?? null,
          dayOfWeek: dto.dayOfWeek ?? null,
          cutOffDayOfMonth: dto.cutOffDayOfMonth ?? null,
          isActive: dto.isActive ?? true,
        },
      });
      await this.audit.record({
        action: AuditAction.PAY_CALENDAR_CHANGED,
        targetType: 'pay_calendar',
        targetId: row.id,
        newValue: { created: true, name: row.name, frequency: row.frequency },
      });
      return toPayCalendar(row);
    });
  }

  async update(id: string, dto: UpdatePayCalendarDto): Promise<PayCalendar> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.payCalendar.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Pay calendar not found');

      this.assertValidConfig({
        frequency: dto.frequency ?? existing.frequency,
        dayOfMonth:
          dto.dayOfMonth !== undefined ? dto.dayOfMonth : existing.dayOfMonth,
        dayOfWeek:
          dto.dayOfWeek !== undefined ? dto.dayOfWeek : existing.dayOfWeek,
        cutOffDayOfMonth:
          dto.cutOffDayOfMonth !== undefined
            ? dto.cutOffDayOfMonth
            : existing.cutOffDayOfMonth,
      });

      const row = await tx.payCalendar.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
          ...(dto.dayOfMonth !== undefined
            ? { dayOfMonth: dto.dayOfMonth }
            : {}),
          ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek } : {}),
          ...(dto.cutOffDayOfMonth !== undefined
            ? { cutOffDayOfMonth: dto.cutOffDayOfMonth }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.audit.record({
        action: AuditAction.PAY_CALENDAR_CHANGED,
        targetType: 'pay_calendar',
        targetId: row.id,
        newValue: { updated: true, name: row.name, frequency: row.frequency },
      });
      return toPayCalendar(row);
    });
  }

  /** Refused while any payroll run still references the calendar. */
  async remove(id: string): Promise<void> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.payCalendar.findFirst({
        where: { id },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundException('Pay calendar not found');

      const runs = await tx.payrollRun.count({ where: { payCalendarId: id } });
      if (runs > 0) {
        throw new ConflictException(
          'This calendar has payroll runs and cannot be deleted — deactivate it instead',
        );
      }
      await tx.payCalendar.delete({ where: { id } });
      await this.audit.record({
        action: AuditAction.PAY_CALENDAR_CHANGED,
        targetType: 'pay_calendar',
        targetId: id,
        newValue: { deleted: true, name: existing.name },
      });
    });
  }

  private assertValidConfig(config: PayCalendarConfig): void {
    const errors = validateCalendarConfig(config);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }

  private actorId(): string {
    return this.requireContext().userId;
  }
}
