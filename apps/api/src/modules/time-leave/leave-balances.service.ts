import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import type {
  LeaveAccrualRunResult,
  LeaveBalanceSummary,
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
import { ensureBalance } from './leave-balance-ops';
import { roundHalf } from './domain/leave-balance';
import {
  computeAccrued,
  LeaveAccrualMethodValue,
} from './domain/leave-accrual';
import { ListLeaveBalancesQueryDto } from './dto/list-leave-balances.dto';
import { AdjustLeaveBalanceDto } from './dto/adjust-leave-balance.dto';
import { RunLeaveAccrualDto } from './dto/run-leave-accrual.dto';

const BALANCE_INCLUDE = {
  worker: { select: { firstName: true, lastName: true } },
  leaveType: { select: { name: true } },
} satisfies Prisma.LeaveBalanceInclude;

type BalanceRow = Prisma.LeaveBalanceGetPayload<{
  include: typeof BALANCE_INCLUDE;
}>;

export function toBalanceSummary(row: BalanceRow): LeaveBalanceSummary {
  return {
    id: row.id,
    organisationId: row.organisationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    workerId: row.workerId,
    workerName: `${row.worker.firstName} ${row.worker.lastName}`.trim(),
    leaveTypeId: row.leaveTypeId,
    leaveTypeName: row.leaveType.name,
    year: row.year,
    accrued: Number(row.accrued),
    used: Number(row.used),
    balance: Number(row.balance),
  };
}

/** Leave balances (PRD LVE-01 / LVE-05), per worker, leave type and year. */
@Injectable()
export class LeaveBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: ListLeaveBalancesQueryDto,
  ): Promise<{ data: LeaveBalanceSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const year = query.year ?? new Date().getUTCFullYear();

    return this.prisma.withRequestContext(async (tx) => {
      const { where: scopeWhere, caller } = await resolveReadScope(
        tx,
        'leave',
        'read',
      );

      // Materialise default entitlements for a specifically-targeted worker so
      // a brand-new worker's balance list is not empty (LVE-01). Broad listings
      // stay read-only to avoid unbounded writes on a GET.
      const targetWorkers = await this.resolveTargetWorkers(
        tx,
        query,
        scopeWhere,
        caller,
      );
      if (targetWorkers.length > 0) {
        await this.provisionDefaults(tx, targetWorkers, year);
      }

      const where: Prisma.LeaveBalanceWhereInput = { year };
      if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
      if (query.workerId) where.workerId = query.workerId;
      if (query.mine && caller) where.workerId = caller.id;

      if (scopeWhereRestricts(scopeWhere)) {
        where.worker = scopeWhere;
      } else if (query.mine && !caller) {
        where.worker = { ...NO_ACCESS_WHERE };
      }

      const [total, rows] = await Promise.all([
        tx.leaveBalance.count({ where }),
        tx.leaveBalance.findMany({
          where,
          include: BALANCE_INCLUDE,
          orderBy: [{ createdAt: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map(toBalanceSummary),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async adjust(dto: AdjustLeaveBalanceDto): Promise<LeaveBalanceSummary> {
    const { organisationId } = this.requireContext();
    const year = dto.year ?? new Date().getUTCFullYear();

    return this.prisma.withRequestContext(async (tx) => {
      const worker = await tx.worker.findFirst({
        where: { id: dto.workerId },
        select: { id: true },
      });
      if (!worker) throw new NotFoundException('Worker not found');

      const leaveType = await tx.leaveType.findFirst({
        where: { id: dto.leaveTypeId },
        select: { id: true, defaultBalance: true },
      });
      if (!leaveType) throw new NotFoundException('Leave type not found');

      const row = await ensureBalance(
        tx,
        {
          organisationId,
          workerId: dto.workerId,
          leaveTypeId: dto.leaveTypeId,
          year,
        },
        Number(leaveType.defaultBalance),
      );

      const used = Number(row.used);
      let accrued = Number(row.accrued);
      let balance = roundHalf(accrued - used);
      if (dto.accrued !== undefined) {
        accrued = roundHalf(dto.accrued);
        balance = roundHalf(accrued - used);
      }
      if (dto.balance !== undefined) {
        balance = roundHalf(dto.balance);
        accrued = roundHalf(used + balance);
      }

      const updated = await tx.leaveBalance.update({
        where: { id: row.id },
        data: {
          accrued: new Prisma.Decimal(accrued),
          balance: new Prisma.Decimal(balance),
        },
        include: BALANCE_INCLUDE,
      });

      await this.audit.record({
        action: AuditAction.LEAVE_BALANCE_ADJUSTED,
        targetType: 'leave_balances',
        targetId: row.id,
        previousValue: {
          accrued: Number(row.accrued),
          used,
          balance: Number(row.balance),
        },
        newValue: {
          accrued: Number(updated.accrued),
          used: Number(updated.used),
          balance: Number(updated.balance),
          note: dto.note,
        },
      });

      return toBalanceSummary(updated);
    });
  }

  /**
   * Recompute `accrued` (entitlement earned to date + carried-over days) for a
   * leave year (PRD LVE-05). Idempotent: a later run overwrites the value the
   * policy dictates, so manual `accrued` adjustments are superseded. Only
   * balances with a non-`NONE` accrual method are touched.
   */
  async runAccrual(dto: RunLeaveAccrualDto): Promise<LeaveAccrualRunResult> {
    const { organisationId } = this.requireContext();
    const year = dto.year ?? new Date().getUTCFullYear();
    const asOf = new Date();

    return this.prisma.withRequestContext(async (tx) => {
      const leaveTypes = await tx.leaveType.findMany({
        where: { isActive: true, accrualMethod: { not: 'NONE' } },
        select: {
          id: true,
          defaultBalance: true,
          accrualMethod: true,
          carryOverEnabled: true,
          carryOverMaxDays: true,
          carryOverExpiryMonths: true,
        },
      });
      if (leaveTypes.length === 0) return { year, updated: 0 };

      const workers = await tx.worker.findMany({
        where: dto.workerId ? { id: dto.workerId } : { status: 'ACTIVE' },
        select: { id: true },
      });
      if (dto.workerId && workers.length === 0) {
        throw new NotFoundException('Worker not found');
      }

      let updated = 0;
      for (const worker of workers) {
        for (const lt of leaveTypes) {
          const key = {
            organisationId_workerId_leaveTypeId_year: {
              organisationId,
              workerId: worker.id,
              leaveTypeId: lt.id,
              year,
            },
          };
          const [existing, priorRow] = await Promise.all([
            tx.leaveBalance.findUnique({
              where: key,
              select: { used: true },
            }),
            tx.leaveBalance.findUnique({
              where: {
                organisationId_workerId_leaveTypeId_year: {
                  organisationId,
                  workerId: worker.id,
                  leaveTypeId: lt.id,
                  year: year - 1,
                },
              },
              select: { accrued: true, used: true },
            }),
          ]);

          const accrued = computeAccrued(
            {
              method: lt.accrualMethod as unknown as LeaveAccrualMethodValue,
              annualEntitlement: Number(lt.defaultBalance),
              carryOverEnabled: lt.carryOverEnabled,
              carryOverMaxDays:
                lt.carryOverMaxDays == null ? null : Number(lt.carryOverMaxDays),
              carryOverExpiryMonths: lt.carryOverExpiryMonths ?? null,
            },
            year,
            asOf,
            priorRow
              ? { accrued: Number(priorRow.accrued), used: Number(priorRow.used) }
              : null,
          );
          const used = existing ? Number(existing.used) : 0;
          const accruedDecimal = new Prisma.Decimal(accrued);
          const balance = new Prisma.Decimal(roundHalf(accrued - used));

          await tx.leaveBalance.upsert({
            where: key,
            create: {
              organisationId,
              workerId: worker.id,
              leaveTypeId: lt.id,
              year,
              accrued: accruedDecimal,
              used: new Prisma.Decimal(0),
              balance,
            },
            update: { accrued: accruedDecimal, balance },
          });
          updated += 1;
        }
      }

      await this.audit.record({
        action: AuditAction.LEAVE_BALANCE_ADJUSTED,
        targetType: 'leave_balances',
        newValue: { accrualRun: true, year, updated, workerId: dto.workerId },
      });

      return { year, updated };
    });
  }

  /**
   * The worker ids whose balances were *explicitly* requested (`workerId` or
   * `mine`). Returns an empty list for broad listings, which are left
   * read-only. A `workerId` outside the caller's scope is a 404 so the caller
   * cannot probe for workers they cannot see.
   */
  private async resolveTargetWorkers(
    tx: Prisma.TransactionClient,
    query: ListLeaveBalancesQueryDto,
    scopeWhere: Prisma.WorkerWhereInput,
    caller: { id: string } | null,
  ): Promise<string[]> {
    if (query.workerId) {
      const worker = await tx.worker.findFirst({
        where: scopeWhereRestricts(scopeWhere)
          ? { AND: [scopeWhere, { id: query.workerId }] }
          : { id: query.workerId },
        select: { id: true },
      });
      if (!worker) throw new NotFoundException('Worker not found');
      return [worker.id];
    }
    if (query.mine) {
      return caller ? [caller.id] : [];
    }
    return [];
  }

  /**
   * Create the opening balance rows for every active leave type with a default
   * entitlement. Idempotent (`skipDuplicates`), so repeat reads are safe.
   */
  private async provisionDefaults(
    tx: Prisma.TransactionClient,
    workerIds: string[],
    year: number,
  ): Promise<void> {
    const { organisationId } = this.requireContext();
    const leaveTypes = await tx.leaveType.findMany({
      where: { isActive: true, defaultBalance: { gt: 0 } },
      select: { id: true, defaultBalance: true },
    });
    if (leaveTypes.length === 0) return;

    const data = workerIds.flatMap((workerId) =>
      leaveTypes.map((lt) => ({
        organisationId,
        workerId,
        leaveTypeId: lt.id,
        year,
        accrued: lt.defaultBalance,
        used: new Prisma.Decimal(0),
        balance: lt.defaultBalance,
      })),
    );
    await tx.leaveBalance.createMany({ data, skipDuplicates: true });
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
