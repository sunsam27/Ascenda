import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@ascenda/db';
import { AuditAction } from '@ascenda/db';
import type {
  CreateRecurringPayItemDto,
  RecurringPayItem,
  UpdateRecurringPayItemDto,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { ListRecurringPayItemsQueryDto } from './dto/recurring-pay-item.dto';
import {
  validateRecurringItem,
  type RecurringPayItemInput,
} from './domain/recurring-pay-item';

type RecurringPayItemRow = Prisma.RecurringPayItemGetPayload<Record<string, never>>;

export function toRecurringPayItem(row: RecurringPayItemRow): RecurringPayItem {
  return {
    id: row.id,
    organisationId: row.organisationId,
    workerId: row.workerId,
    type: row.type as RecurringPayItem['type'],
    name: row.name,
    calculation: row.calculation as unknown as RecurringPayItem['calculation'],
    amountMinorUnits: row.amountMinorUnits ?? undefined,
    rateBps: row.rateBps ?? undefined,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo ? row.validTo.toISOString() : undefined,
    isActive: row.isActive,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/**
 * Recurring per-worker deductions and employer costs (PRD PAY-02 / PAY-03).
 * Amounts are positive magnitudes; the payroll run engine (M2) applies signs.
 * Statutory rates are organisation-configured data — never invented here.
 * Every write emits a RECURRING_PAY_ITEM_CHANGED audit event.
 */
@Injectable()
export class RecurringPayItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListRecurringPayItemsQueryDto): Promise<{
    data: RecurringPayItem[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.RecurringPayItemWhereInput = {
        ...(query.workerId ? { workerId: query.workerId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.active !== undefined ? { isActive: query.active } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.recurringPayItem.findMany({
          where,
          orderBy: [{ workerId: 'asc' }, { validFrom: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.recurringPayItem.count({ where }),
      ]);
      return {
        data: rows.map(toRecurringPayItem),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<RecurringPayItem> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.recurringPayItem.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Recurring pay item not found');
      return toRecurringPayItem(row);
    });
  }

  async create(dto: CreateRecurringPayItemDto): Promise<RecurringPayItem> {
    const { organisationId } = this.requireContext();
    this.assertMoneyFields({
      calculation: dto.calculation as RecurringPayItemInput['calculation'],
      amountMinorUnits: dto.amountMinorUnits,
      rateBps: dto.rateBps,
    });
    this.assertPeriod(dto.validFrom, dto.validTo);

    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerExists(tx, dto.workerId);
      const row = await tx.recurringPayItem.create({
        data: {
          organisationId,
          workerId: dto.workerId,
          createdBy: this.actorId(),
          type: dto.type,
          name: dto.name,
          calculation: dto.calculation,
          amountMinorUnits: dto.amountMinorUnits ?? null,
          rateBps: dto.rateBps ?? null,
          validFrom: new Date(dto.validFrom),
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          isActive: dto.isActive ?? true,
          notes: dto.notes ?? null,
        },
      });
      await this.audit.record({
        action: AuditAction.RECURRING_PAY_ITEM_CHANGED,
        targetType: 'recurring_pay_item',
        targetId: row.id,
        newValue: {
          created: true,
          workerId: row.workerId,
          type: row.type,
          name: row.name,
          calculation: row.calculation,
          amountMinorUnits: row.amountMinorUnits,
          rateBps: row.rateBps,
        },
      });
      return toRecurringPayItem(row);
    });
  }

  async update(
    id: string,
    dto: UpdateRecurringPayItemDto,
  ): Promise<RecurringPayItem> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.recurringPayItem.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Recurring pay item not found');

      // When the calculation method changes the previous amount form is
      // cleared so a FIXED amount can never ride along with a PERCENTAGE.
      const switching =
        dto.calculation !== undefined && dto.calculation !== existing.calculation;
      const calculation = dto.calculation ?? existing.calculation;
      const amountMinorUnits =
        dto.amountMinorUnits ??
        (switching ? null : existing.amountMinorUnits);
      const rateBps = dto.rateBps ?? (switching ? null : existing.rateBps);

      this.assertMoneyFields({
        calculation: calculation as RecurringPayItemInput['calculation'],
        amountMinorUnits,
        rateBps,
      });

      const validFrom =
        dto.validFrom !== undefined ? dto.validFrom : existing.validFrom.toISOString();
      const validTo =
        dto.validTo !== undefined
          ? dto.validTo
          : existing.validTo
            ? existing.validTo.toISOString()
            : null;
      this.assertPeriod(validFrom, validTo);

      const row = await tx.recurringPayItem.update({
        where: { id },
        data: {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          calculation,
          amountMinorUnits,
          rateBps,
          validFrom: new Date(validFrom),
          validTo: validTo ? new Date(validTo) : null,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
      await this.audit.record({
        action: AuditAction.RECURRING_PAY_ITEM_CHANGED,
        targetType: 'recurring_pay_item',
        targetId: row.id,
        newValue: {
          updated: true,
          workerId: row.workerId,
          type: row.type,
          name: row.name,
          calculation: row.calculation,
          amountMinorUnits: row.amountMinorUnits,
          rateBps: row.rateBps,
          isActive: row.isActive,
        },
      });
      return toRecurringPayItem(row);
    });
  }

  async remove(id: string): Promise<void> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.recurringPayItem.findFirst({
        where: { id },
        select: { id: true, workerId: true, name: true },
      });
      if (!existing) throw new NotFoundException('Recurring pay item not found');
      await tx.recurringPayItem.delete({ where: { id } });
      await this.audit.record({
        action: AuditAction.RECURRING_PAY_ITEM_CHANGED,
        targetType: 'recurring_pay_item',
        targetId: id,
        newValue: { deleted: true, workerId: existing.workerId, name: existing.name },
      });
    });
  }

  private assertMoneyFields(input: RecurringPayItemInput): void {
    const errors = validateRecurringItem(input);
    if (errors.length > 0) {
      throw new BadRequestException(errors.join('; '));
    }
  }

  private assertPeriod(validFrom: string, validTo?: string | null): void {
    if (!validTo) return;
    if (new Date(validTo).getTime() <= new Date(validFrom).getTime()) {
      throw new BadRequestException('validTo must be after validFrom');
    }
  }

  private async assertWorkerExists(
    tx: Prisma.TransactionClient,
    workerId: string,
  ): Promise<void> {
    const worker = await tx.worker.findFirst({
      where: { id: workerId },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Worker not found');
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
