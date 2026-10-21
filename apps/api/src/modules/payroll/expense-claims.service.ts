import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import {
  ExpenseClaimStatus,
  PermissionScope,
  SystemRole,
  type ExpenseClaim,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { getEffectiveScope } from '../../common/rbac/permissions';
import { AuditService } from '../audit/audit.service';
import {
  CreateExpenseClaimDto,
  DecideExpenseClaimDto,
  ListExpenseClaimsQueryDto,
} from './dto/expense-claim.dto';

type ExpenseClaimRow = Prisma.ExpenseClaimGetPayload<Record<string, never>>;

const NO_ACCESS_WHERE = { id: '__ascenda_no_access__' } as const;

/** Roles that may act on the finance step of the reimbursement chain. */
const FINANCE_ROLES: SystemRole[] = [
  SystemRole.FINANCE_APPROVER,
  SystemRole.PAYROLL_ADMINISTRATOR,
];

export function toExpenseClaim(row: ExpenseClaimRow): ExpenseClaim {
  return {
    id: row.id,
    organisationId: row.organisationId,
    workerId: row.workerId,
    type: row.type,
    description: row.description,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    receiptUrl: row.receiptUrl ?? undefined,
    status: row.status as ExpenseClaimStatus,
    managerDecidedById: row.managerDecidedById ?? undefined,
    managerDecidedAt: row.managerDecidedAt?.toISOString(),
    managerComment: row.managerComment ?? undefined,
    financeDecidedById: row.financeDecidedById ?? undefined,
    financeDecidedAt: row.financeDecidedAt?.toISOString(),
    financeComment: row.financeComment ?? undefined,
    paidPayrollRunId: row.paidPayrollRunId ?? undefined,
    paidAt: row.paidAt?.toISOString(),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Reimbursements / expense claims (PRD PAY-14). Lifecycle: SUBMITTED → manager
 * review → finance approval → folded into the next payroll run as a
 * REIMBURSEMENT line (PAID). Employees see only their own; managers act for
 * their team; finance roles act on the finance step. Every transition is
 * audit-logged.
 */
@Injectable()
export class ExpenseClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListExpenseClaimsQueryDto): Promise<{
    data: ExpenseClaim[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const scopeWhere = await this.resolveScopeWhere(tx);
      const where: Prisma.ExpenseClaimWhereInput = {
        AND: [
          scopeWhere,
          {
            ...(query.workerId ? { workerId: query.workerId } : {}),
            ...(query.status ? { status: query.status } : {}),
          },
        ],
      };
      const [rows, total] = await Promise.all([
        tx.expenseClaim.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.expenseClaim.count({ where }),
      ]);
      return {
        data: rows.map(toExpenseClaim),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<ExpenseClaim> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await this.findScoped(tx, id);
      return toExpenseClaim(row);
    });
  }

  async create(dto: CreateExpenseClaimDto): Promise<ExpenseClaim> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const worker = await tx.worker.findFirst({
        where: { id: dto.workerId },
        select: { id: true },
      });
      if (!worker) throw new NotFoundException('Worker not found');

      const org = await tx.organisation.findUnique({
        where: { id: organisationId },
        select: { currency: true },
      });

      const row = await tx.expenseClaim.create({
        data: {
          organisationId,
          workerId: dto.workerId,
          type: dto.type,
          description: dto.description,
          amountMinorUnits: dto.amountMinorUnits,
          currency: org?.currency ?? 'USD',
          receiptUrl: dto.receiptUrl ?? null,
          createdBy: userId,
        },
      });
      await this.audit.record({
        action: AuditAction.EXPENSE_CLAIM_CREATED,
        targetType: 'expense_claim',
        targetId: row.id,
        newValue: {
          workerId: row.workerId,
          type: row.type,
          amountMinorUnits: row.amountMinorUnits,
          status: row.status,
        },
      });
      return toExpenseClaim(row);
    });
  }

  /** Manager step: SUBMITTED → MANAGER_APPROVED / MANAGER_REJECTED. */
  async managerDecide(
    id: string,
    dto: DecideExpenseClaimDto,
  ): Promise<ExpenseClaim> {
    const { organisationId, userId } = this.requireContext();
    const role = await this.actorRole(organisationId, userId);
    if (role !== SystemRole.MANAGER && role !== SystemRole.OWNER) {
      throw new ForbiddenException('Only a manager may decide the manager step');
    }
    return this.prisma.withRequestContext(async (tx) => {
      const row = await this.findScoped(tx, id);
      if (row.status !== 'SUBMITTED') {
        throw new ConflictException(
          `Claim is ${row.status}; manager decision only applies to SUBMITTED`,
        );
      }
      await this.assertManagerOf(tx, organisationId, userId, row.workerId, role);
      const status =
        dto.decision === 'APPROVE'
          ? ExpenseClaimStatus.MANAGER_APPROVED
          : ExpenseClaimStatus.MANAGER_REJECTED;
      const updated = await tx.expenseClaim.update({
        where: { id },
        data: {
          status,
          managerDecidedById: userId,
          managerDecidedAt: new Date(),
          managerComment: dto.comment ?? null,
        },
      });
      await this.audit.record({
        action: AuditAction.EXPENSE_CLAIM_STATUS_CHANGED,
        targetType: 'expense_claim',
        targetId: row.id,
        newValue: {
          step: 'MANAGER',
          status: row.status,
          newStatus: status,
          comment: dto.comment ?? null,
        },
      });
      return toExpenseClaim(updated);
    });
  }

  /** Finance step: MANAGER_APPROVED → FINANCE_APPROVED / FINANCE_REJECTED. */
  async financeDecide(
    id: string,
    dto: DecideExpenseClaimDto,
  ): Promise<ExpenseClaim> {
    const { organisationId, userId } = this.requireContext();
    const role = await this.actorRole(organisationId, userId);
    if (role !== SystemRole.OWNER && !FINANCE_ROLES.includes(role)) {
      throw new ForbiddenException('Only a finance role may decide the finance step');
    }
    return this.prisma.withRequestContext(async (tx) => {
      const row = await this.findScoped(tx, id);
      if (row.status !== 'MANAGER_APPROVED') {
        throw new ConflictException(
          `Claim is ${row.status}; finance decision requires MANAGER_APPROVED`,
        );
      }
      const status =
        dto.decision === 'APPROVE'
          ? ExpenseClaimStatus.FINANCE_APPROVED
          : ExpenseClaimStatus.FINANCE_REJECTED;
      const updated = await tx.expenseClaim.update({
        where: { id },
        data: {
          status,
          financeDecidedById: userId,
          financeDecidedAt: new Date(),
          financeComment: dto.comment ?? null,
        },
      });
      await this.audit.record({
        action: AuditAction.EXPENSE_CLAIM_STATUS_CHANGED,
        targetType: 'expense_claim',
        targetId: row.id,
        newValue: {
          step: 'FINANCE',
          status: row.status,
          newStatus: status,
          comment: dto.comment ?? null,
        },
      });
      return toExpenseClaim(updated);
    });
  }

  /** Withdraw a claim that has not yet been paid. */
  async cancel(id: string): Promise<ExpenseClaim> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await this.findScoped(tx, id);
      if (row.status === 'PAID' || row.status === 'CANCELLED') {
        throw new ConflictException(`Claim is ${row.status} and cannot be cancelled`);
      }
      const updated = await tx.expenseClaim.update({
        where: { id },
        data: { status: ExpenseClaimStatus.CANCELLED },
      });
      await this.audit.record({
        action: AuditAction.EXPENSE_CLAIM_STATUS_CHANGED,
        targetType: 'expense_claim',
        targetId: row.id,
        newValue: { status: row.status, newStatus: 'CANCELLED' },
      });
      return toExpenseClaim(updated);
    });
  }

  /**
   * Consume every FINANCE_APPROVED claim for the given workers, returning
   * REIMBURSEMENT pay lines per worker and stamping each claim PAID against the
   * run. Called by the run engine at `prepare`.
   */
  async consumeApprovedForRun(
    tx: Prisma.TransactionClient,
    run: { id: string; organisationId: string },
    workerIds: string[],
    periodEnd: Date,
  ): Promise<Map<string, { description: string; amountMinorUnits: number }[]>> {
    const byWorker = new Map<string, { description: string; amountMinorUnits: number }[]>();
    if (workerIds.length === 0) return byWorker;

    const claims = await tx.expenseClaim.findMany({
      where: {
        organisationId: run.organisationId,
        workerId: { in: workerIds },
        status: 'FINANCE_APPROVED',
        paidPayrollRunId: null,
        createdAt: { lte: periodEnd },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (claims.length === 0) return byWorker;

    for (const claim of claims) {
      const list = byWorker.get(claim.workerId) ?? [];
      list.push({
        description: `Reimbursement: ${claim.description}`,
        amountMinorUnits: claim.amountMinorUnits,
      });
      byWorker.set(claim.workerId, list);
    }

    await tx.expenseClaim.updateMany({
      where: { id: { in: claims.map((c) => c.id) } },
      data: {
        status: ExpenseClaimStatus.PAID,
        paidPayrollRunId: run.id,
        paidAt: new Date(),
      },
    });
    await this.audit.record({
      action: AuditAction.EXPENSE_CLAIM_STATUS_CHANGED,
      targetType: 'payroll_run',
      targetId: run.id,
      newValue: {
        paidClaimCount: claims.length,
        claimIds: claims.map((c) => c.id),
        newStatus: 'PAID',
      },
    });
    return byWorker;
  }

  private async assertManagerOf(
    tx: Prisma.TransactionClient,
    organisationId: string,
    userId: string,
    workerId: string,
    role: SystemRole,
  ): Promise<void> {
    if (role === SystemRole.OWNER) return;
    // The worker's manager is the worker's own `managerId`; a manager may also
    // decide their own claims only when they are not self-approving their own
    // submission (separation of duties).
    const worker = await tx.worker.findFirst({
      where: { id: workerId },
      select: { managerId: true, userId: true },
    });
    if (!worker) throw new NotFoundException('Worker not found');
    if (worker.userId === userId) {
      throw new ForbiddenException(
        'Separation of duties: you cannot decide your own expense claim',
      );
    }
    if (worker.managerId) {
      const manager = await tx.worker.findFirst({
        where: { id: worker.managerId },
        select: { userId: true },
      });
      if (manager?.userId === userId) return;
    }
    const ctx = getRequestContext();
    const scope = getEffectiveScope(ctx?.role, 'expense_claims', 'approve');
    if (scope === PermissionScope.ORGANISATION) return;
    throw new ForbiddenException('Only the worker’s manager may decide this claim');
  }

  private async findScoped(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<ExpenseClaimRow> {
    const scopeWhere = await this.resolveScopeWhere(tx);
    const row = await tx.expenseClaim.findFirst({
      where: { AND: [{ id }, scopeWhere] },
    });
    if (!row) throw new NotFoundException('Expense claim not found');
    return row;
  }

  private async resolveScopeWhere(
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.ExpenseClaimWhereInput> {
    const ctx = getRequestContext();
    const scope = getEffectiveScope(ctx?.role, 'expense_claims', 'read');
    if (scope === PermissionScope.ORGANISATION) return {};
    if (scope === PermissionScope.TEAM && ctx?.userId) {
      const manager = await tx.worker.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!manager) return { ...NO_ACCESS_WHERE };
      return {
        OR: [{ workerId: manager.id }, { worker: { managerId: manager.id } }],
      };
    }
    if (scope === PermissionScope.SELF && ctx?.userId) {
      const worker = await tx.worker.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      return worker ? { workerId: worker.id } : { ...NO_ACCESS_WHERE };
    }
    return { ...NO_ACCESS_WHERE };
  }

  private async actorRole(
    organisationId: string,
    userId: string,
  ): Promise<SystemRole> {
    return this.prisma.withRequestContext(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: { organisationId, userId },
        select: { role: true },
      });
      if (!membership) {
        throw new UnauthorizedException('No membership for this organisation');
      }
      return membership.role as SystemRole;
    });
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
