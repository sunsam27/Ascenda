import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import type { BlackoutPeriod as BlackoutPeriodDto, PaginationMeta } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { parseDateOnly } from './holidays.service';
import { CreateBlackoutPeriodDto } from './dto/create-blackout-period.dto';
import { UpdateBlackoutPeriodDto } from './dto/update-blackout-period.dto';
import { ListBlackoutPeriodsQueryDto } from './dto/list-blackout-periods.dto';

const BLACKOUT_INCLUDE = {
  location: { select: { name: true } },
  leaveType: { select: { name: true } },
} satisfies Prisma.BlackoutPeriodInclude;

type BlackoutRow = Prisma.BlackoutPeriodGetPayload<{
  include: typeof BLACKOUT_INCLUDE;
}>;

export function toBlackoutPeriod(row: BlackoutRow): BlackoutPeriodDto {
  return {
    id: row.id,
    organisationId: row.organisationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    isRecurring: row.isRecurring,
    locationId: row.locationId ?? undefined,
    leaveTypeId: row.leaveTypeId ?? undefined,
    reason: row.reason ?? undefined,
  };
}

/**
 * Blackout periods (PRD LVE-05): date windows when leave may not normally be
 * taken. Org-wide when location/leave-type are unset; scoped when provided.
 */
@Injectable()
export class BlackoutPeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListBlackoutPeriodsQueryDto,
  ): Promise<{ data: BlackoutPeriodDto[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    return this.prisma.withRequestContext(async (tx) => {
      const and: Prisma.BlackoutPeriodWhereInput[] = [];
      if (query.from) {
        and.push({ endDate: { gte: parseDateOnly(query.from) } });
      }
      if (query.to) {
        and.push({ startDate: { lte: parseDateOnly(query.to) } });
      }
      if (query.locationId) {
        and.push({
          OR: [{ locationId: null }, { locationId: query.locationId }],
        });
      }
      if (query.leaveTypeId) {
        and.push({
          OR: [{ leaveTypeId: null }, { leaveTypeId: query.leaveTypeId }],
        });
      }
      const where: Prisma.BlackoutPeriodWhereInput = and.length
        ? { AND: and }
        : {};

      const [total, rows] = await Promise.all([
        tx.blackoutPeriod.count({ where }),
        tx.blackoutPeriod.findMany({
          where,
          include: BLACKOUT_INCLUDE,
          orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map(toBlackoutPeriod),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<BlackoutPeriodDto> {
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.blackoutPeriod.findFirst({
        where: { id },
        include: BLACKOUT_INCLUDE,
      });
      if (!row) throw new NotFoundException('Blackout period not found');
      return toBlackoutPeriod(row);
    });
  }

  async create(dto: CreateBlackoutPeriodDto): Promise<BlackoutPeriodDto> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertLocation(tx, dto.locationId ?? null);
      await this.assertLeaveType(tx, dto.leaveTypeId ?? null);
      const { start, end } = this.parseRange(dto.startDate, dto.endDate);
      this.assertRecurringWindow(start, end, dto.isRecurring ?? false);

      const row = await tx.blackoutPeriod.create({
        data: {
          organisationId,
          createdBy: userId,
          name: dto.name.trim(),
          startDate: start,
          endDate: end,
          isRecurring: dto.isRecurring ?? false,
          reason: dto.reason ?? null,
          locationId: dto.locationId ?? null,
          leaveTypeId: dto.leaveTypeId ?? null,
        },
        include: BLACKOUT_INCLUDE,
      });

      await this.audit.record({
        action: AuditAction.BLACKOUT_PERIOD_CHANGED,
        targetType: 'blackout_periods',
        targetId: row.id,
        newValue: {
          name: row.name,
          startDate: toBlackoutPeriod(row).startDate,
          endDate: toBlackoutPeriod(row).endDate,
          locationId: row.locationId,
          leaveTypeId: row.leaveTypeId,
        },
      });

      return toBlackoutPeriod(row);
    });
  }

  async update(
    id: string,
    dto: UpdateBlackoutPeriodDto,
  ): Promise<BlackoutPeriodDto> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.blackoutPeriod.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Blackout period not found');

      if (dto.locationId !== undefined) {
        await this.assertLocation(tx, dto.locationId);
      }
      if (dto.leaveTypeId !== undefined) {
        await this.assertLeaveType(tx, dto.leaveTypeId);
      }

      const start = dto.startDate ? parseDateOnly(dto.startDate) : existing.startDate;
      const end = dto.endDate ? parseDateOnly(dto.endDate) : existing.endDate;
      if (end.getTime() < start.getTime()) {
        throw new BadRequestException('endDate must be on or after startDate');
      }
      const recurring = dto.isRecurring ?? existing.isRecurring;
      this.assertRecurringWindow(start, end, recurring);

      const row = await tx.blackoutPeriod.update({
        where: { id },
        data: {
          name: dto.name !== undefined ? dto.name.trim() : undefined,
          startDate: dto.startDate ? start : undefined,
          endDate: dto.endDate ? end : undefined,
          isRecurring: dto.isRecurring,
          reason: dto.reason !== undefined ? dto.reason : undefined,
          locationId: dto.locationId !== undefined ? dto.locationId : undefined,
          leaveTypeId:
            dto.leaveTypeId !== undefined ? dto.leaveTypeId : undefined,
        },
        include: BLACKOUT_INCLUDE,
      });

      await this.audit.record({
        action: AuditAction.BLACKOUT_PERIOD_CHANGED,
        targetType: 'blackout_periods',
        targetId: row.id,
        previousValue: {
          name: existing.name,
          startDate: existing.startDate.toISOString().slice(0, 10),
          endDate: existing.endDate.toISOString().slice(0, 10),
        },
        newValue: {
          name: row.name,
          startDate: toBlackoutPeriod(row).startDate,
          endDate: toBlackoutPeriod(row).endDate,
        },
      });

      return toBlackoutPeriod(row);
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.blackoutPeriod.findFirst({
        where: { id },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundException('Blackout period not found');

      await tx.blackoutPeriod.delete({ where: { id } });

      await this.audit.record({
        action: AuditAction.BLACKOUT_PERIOD_CHANGED,
        targetType: 'blackout_periods',
        targetId: id,
        previousValue: { name: existing.name, deleted: true },
      });

      return { id };
    });
  }

  private parseRange(
    startValue: string,
    endValue: string,
  ): { start: Date; end: Date } {
    const start = parseDateOnly(startValue);
    const end = parseDateOnly(endValue);
    if (end.getTime() < start.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
    return { start, end };
  }

  private assertRecurringWindow(
    start: Date,
    end: Date,
    isRecurring: boolean,
  ): void {
    if (!isRecurring) return;
    const startKey = start.getUTCMonth() * 100 + start.getUTCDate();
    const endKey = end.getUTCMonth() * 100 + end.getUTCDate();
    if (endKey < startKey) {
      throw new BadRequestException(
        'A recurring blackout must not span the new year; split it into two windows',
      );
    }
  }

  private async assertLocation(
    tx: Prisma.TransactionClient,
    locationId: string | null,
  ): Promise<void> {
    if (!locationId) return;
    const found = await tx.location.findFirst({
      where: { id: locationId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Location not found');
  }

  private async assertLeaveType(
    tx: Prisma.TransactionClient,
    leaveTypeId: string | null,
  ): Promise<void> {
    if (!leaveTypeId) return;
    const found = await tx.leaveType.findFirst({
      where: { id: leaveTypeId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Leave type not found');
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
