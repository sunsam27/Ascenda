import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import type { Holiday as HolidayDto, PaginationMeta } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { startOfUtcDay } from './domain/working-days';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { ListHolidaysQueryDto } from './dto/list-holidays.dto';

const HOLIDAY_INCLUDE = {
  location: { select: { name: true } },
} satisfies Prisma.HolidayInclude;

type HolidayRow = Prisma.HolidayGetPayload<{ include: typeof HOLIDAY_INCLUDE }>;

export function toHoliday(row: HolidayRow): HolidayDto {
  return {
    id: row.id,
    organisationId: row.organisationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    date: row.date.toISOString().slice(0, 10),
    isRecurring: row.isRecurring,
    locationId: row.locationId ?? undefined,
    locationName: row.location?.name ?? undefined,
  };
}

/** Parse an ISO date/datetime into a UTC-midnight civil date. */
export function parseDateOnly(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Invalid date: ${value}`);
  }
  return startOfUtcDay(date);
}

/**
 * Public-holiday calendar (PRD LVE-03). `locationId = null` holidays apply to
 * the whole organisation; leave-day maths then excludes them from any span.
 */
@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListHolidaysQueryDto,
  ): Promise<{ data: HolidayDto[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const year = query.year ?? new Date().getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));

    return this.prisma.withRequestContext(async (tx) => {
      const and: Prisma.HolidayWhereInput[] = [
        // Holidays in the requested year, plus recurring ones defined earlier.
        {
          OR: [
            { date: { gte: start, lte: end } },
            { isRecurring: true, date: { lte: end } },
          ],
        },
      ];
      if (query.locationId) {
        and.push({
          OR: [{ locationId: null }, { locationId: query.locationId }],
        });
      }

      const where: Prisma.HolidayWhereInput = { AND: and };
      const search = query.search?.trim();
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [total, rows] = await Promise.all([
        tx.holiday.count({ where }),
        tx.holiday.findMany({
          where,
          include: HOLIDAY_INCLUDE,
          orderBy: [{ date: 'asc' }, { name: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map(toHoliday),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<HolidayDto> {
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.holiday.findFirst({
        where: { id },
        include: HOLIDAY_INCLUDE,
      });
      if (!row) throw new NotFoundException('Holiday not found');
      return toHoliday(row);
    });
  }

  async create(dto: CreateHolidayDto): Promise<HolidayDto> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertLocation(tx, dto.locationId ?? null);

      const row = await tx.holiday.create({
        data: {
          organisationId,
          createdBy: userId,
          name: dto.name.trim(),
          date: parseDateOnly(dto.date),
          isRecurring: dto.isRecurring ?? false,
          locationId: dto.locationId ?? null,
        },
        include: HOLIDAY_INCLUDE,
      });

      await this.audit.record({
        action: AuditAction.HOLIDAY_CALENDAR_CHANGED,
        targetType: 'holidays',
        targetId: row.id,
        newValue: {
          name: row.name,
          date: toHoliday(row).date,
          locationId: row.locationId,
        },
      });

      return toHoliday(row);
    });
  }

  async update(id: string, dto: UpdateHolidayDto): Promise<HolidayDto> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.holiday.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Holiday not found');

      if (dto.locationId !== undefined) {
        await this.assertLocation(tx, dto.locationId ?? null);
      }

      const row = await tx.holiday.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.date !== undefined ? { date: parseDateOnly(dto.date) } : {}),
          ...(dto.isRecurring !== undefined
            ? { isRecurring: dto.isRecurring }
            : {}),
          ...(dto.locationId !== undefined
            ? { locationId: dto.locationId ?? null }
            : {}),
        },
        include: HOLIDAY_INCLUDE,
      });

      await this.audit.record({
        action: AuditAction.HOLIDAY_CALENDAR_CHANGED,
        targetType: 'holidays',
        targetId: row.id,
        previousValue: { name: existing.name, date: existing.date.toISOString().slice(0, 10) },
        newValue: { name: row.name, date: toHoliday(row).date },
      });

      return toHoliday(row);
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.holiday.findFirst({
        where: { id },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundException('Holiday not found');

      await tx.holiday.delete({ where: { id } });

      await this.audit.record({
        action: AuditAction.HOLIDAY_CALENDAR_CHANGED,
        targetType: 'holidays',
        targetId: id,
        previousValue: { name: existing.name },
      });

      return { id };
    });
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

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
