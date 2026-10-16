import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import type {
  LeaveAccrualMethod as LeaveAccrualMethodType,
  LeaveType as LeaveTypeDto,
  LeaveTypeCategory as LeaveTypeCategoryType,
  PaginationMeta,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { ListLeaveTypesQueryDto } from './dto/list-leave-types.dto';

type LeaveTypeRow = Prisma.LeaveTypeGetPayload<Record<string, never>>;

export function toLeaveType(row: LeaveTypeRow): LeaveTypeDto {
  return {
    id: row.id,
    organisationId: row.organisationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    name: row.name,
    category: row.category as unknown as LeaveTypeCategoryType,
    defaultBalance: Number(row.defaultBalance),
    isPaid: row.isPaid,
    requiresApproval: row.requiresApproval,
    isActive: row.isActive,
    accrualMethod: row.accrualMethod as unknown as LeaveAccrualMethodType,
    carryOverEnabled: row.carryOverEnabled,
    carryOverMaxDays:
      row.carryOverMaxDays == null ? undefined : Number(row.carryOverMaxDays),
    carryOverExpiryMonths: row.carryOverExpiryMonths ?? undefined,
  };
}

function isReferenceViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

/** Leave types (PRD LVE-01): the catalogue of leave a worker can request. */
@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListLeaveTypesQueryDto,
  ): Promise<{ data: LeaveTypeDto[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.LeaveTypeWhereInput = {};
      if (query.activeOnly) where.isActive = true;
      const search = query.search?.trim();
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [total, rows] = await Promise.all([
        tx.leaveType.count({ where }),
        tx.leaveType.findMany({
          where,
          orderBy: [{ name: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map(toLeaveType),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<LeaveTypeDto> {
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.leaveType.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Leave type not found');
      return toLeaveType(row);
    });
  }

  async create(dto: CreateLeaveTypeDto): Promise<LeaveTypeDto> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertNameFree(tx, dto.name);

      const row = await tx.leaveType.create({
        data: {
          organisationId,
          createdBy: userId,
          name: dto.name.trim(),
          category: dto.category,
          defaultBalance: new Prisma.Decimal(dto.defaultBalance),
          isPaid: dto.isPaid,
          requiresApproval: dto.requiresApproval ?? true,
          isActive: dto.isActive ?? true,
          accrualMethod: dto.accrualMethod as unknown as Prisma.LeaveTypeCreateInput['accrualMethod'],
          carryOverEnabled: dto.carryOverEnabled ?? false,
          carryOverMaxDays:
            dto.carryOverMaxDays == null
              ? null
              : new Prisma.Decimal(dto.carryOverMaxDays),
          carryOverExpiryMonths: dto.carryOverExpiryMonths ?? null,
        },
      });

      await this.audit.record({
        action: AuditAction.LEAVE_TYPE_CHANGED,
        targetType: 'leave_types',
        targetId: row.id,
        newValue: { name: row.name, category: row.category },
      });

      return toLeaveType(row);
    });
  }

  async update(id: string, dto: UpdateLeaveTypeDto): Promise<LeaveTypeDto> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.leaveType.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Leave type not found');

      if (dto.name !== undefined) await this.assertNameFree(tx, dto.name, id);

      const row = await tx.leaveType.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.defaultBalance !== undefined
            ? { defaultBalance: new Prisma.Decimal(dto.defaultBalance) }
            : {}),
          ...(dto.isPaid !== undefined ? { isPaid: dto.isPaid } : {}),
          ...(dto.requiresApproval !== undefined
            ? { requiresApproval: dto.requiresApproval }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.accrualMethod !== undefined
            ? {
                accrualMethod:
                  dto.accrualMethod as unknown as Prisma.LeaveTypeUpdateInput['accrualMethod'],
              }
            : {}),
          ...(dto.carryOverEnabled !== undefined
            ? { carryOverEnabled: dto.carryOverEnabled }
            : {}),
          ...(dto.carryOverMaxDays !== undefined
            ? {
                carryOverMaxDays:
                  dto.carryOverMaxDays == null
                    ? null
                    : new Prisma.Decimal(dto.carryOverMaxDays),
              }
            : {}),
          ...(dto.carryOverExpiryMonths !== undefined
            ? { carryOverExpiryMonths: dto.carryOverExpiryMonths ?? null }
            : {}),
        },
      });

      await this.audit.record({
        action: AuditAction.LEAVE_TYPE_CHANGED,
        targetType: 'leave_types',
        targetId: row.id,
        previousValue: {
          name: existing.name,
          defaultBalance: Number(existing.defaultBalance),
          isActive: existing.isActive,
        },
        newValue: {
          name: row.name,
          defaultBalance: Number(row.defaultBalance),
          isActive: row.isActive,
        },
      });

      return toLeaveType(row);
    });
  }

  async remove(id: string): Promise<LeaveTypeDto> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.leaveType.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Leave type not found');

      try {
        const row = await tx.leaveType.delete({ where: { id } });
        await this.audit.record({
          action: AuditAction.LEAVE_TYPE_CHANGED,
          targetType: 'leave_types',
          targetId: id,
          previousValue: { name: existing.name, deleted: true },
        });
        return toLeaveType(row);
      } catch (error) {
        if (isReferenceViolation(error)) {
          throw new ConflictException(
            'This leave type is in use — deactivate it instead of deleting.',
          );
        }
        throw error;
      }
    });
  }

  private async assertNameFree(
    tx: Prisma.TransactionClient,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await tx.leaveType.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A leave type with that name already exists');
    }
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
