import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, NotificationType, Prisma } from '@ascenda/db';
import type {
  ApprovePayrollRunDto,
  CreatePayrollItemDto,
  CreatePayrollRunDto,
  PayComponent,
  PayrollItem,
  PayrollRun,
  PayrollRunApproval,
  PayrollRunStatus,
  RejectPayrollRunDto,
  ReversePayrollRunDto,
  RunValidationIssue,
  RunValidationResult,
  SystemRole,
  UpdatePayrollItemDto,
} from '@ascenda/types';
import { PaymentBatchStatus, SystemRole as Role } from '@ascenda/types';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { CompensationService } from '../people/compensation.service';
import { LeaveRequestsService } from '../time-leave/leave-requests.service';
import { AttendanceService } from '../time-leave/attendance.service';
import { parseDateOnly } from '../time-leave/holidays.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  payPeriodsForYear,
  type PayCalendarConfig,
} from './domain/pay-calendar';
import {
  foldWorkerLines,
  PreparedLine,
  prepareWorker,
  reverseLines,
  RunItemType,
  RunRecurringInput,
} from './domain/run-calc';
import { runActionError, type RunStatus } from './domain/run-state';
import {
  applyStatutoryToWorker,
  type StatutoryRule,
} from './domain/statutory';
import {
  DEFAULT_VALIDATION_THRESHOLDS,
  validateRun,
  type RunValidationThresholds,
  type WorkerValidationInput,
} from './domain/run-validation';
import { PayrollConfigService } from './payroll-config.service';
import { StatutoryRulePacksService } from './statutory-rule-packs.service';
import { PayslipsService } from './payslips.service';
import { ExpenseClaimsService } from './expense-claims.service';
import {
  ApprovePayrollRunDto as ApproveDto,
  CreatePayrollItemDto as CreateItemDto,
  CreatePayrollRunDto as CreateDto,
  ListPayrollRunsQueryDto as ListQueryDto,
  RejectPayrollRunDto as RejectDto,
  ReversePayrollRunDto as ReverseDto,
  UpdatePayrollItemDto as UpdateItemDto,
} from './dto/payroll-run.dto';

type RunRow = Prisma.PayrollRunGetPayload<Record<string, never>>;
type ItemRow = Prisma.PayrollItemGetPayload<Record<string, never>>;
type ApprovalRow = Prisma.PayrollRunApprovalGetPayload<Record<string, never>>;

/** Worker statuses included in a pay run; everything else is excluded + flagged. */
const PAYROLL_ELIGIBLE_STATUSES = [
  'ACTIVE',
  'ON_LEAVE',
  'PROBATION',
  // A resigned worker still gets a final run when their end date falls inside
  // the period; the date filters below exclude anyone who left earlier.
  'RESIGNED',
] as const;

// Payroll prep/validation does a per-worker N+1 sweep (compensation, bank
// accounts, leave, absences) against a remote pooled Postgres. That can blow
// Prisma's 20s interactive-transaction default, so these paths get a wider
// budget.
const HEAVY_TX = { timeoutMs: 120_000 } as const;

export function toPayrollRun(row: RunRow): PayrollRun {
  return {
    id: row.id,
    organisationId: row.organisationId,
    payCalendarId: row.payCalendarId,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    status: row.status as PayrollRunStatus,
    preparedById: row.preparedById,
    approvedById: row.approvedById ?? undefined,
    approvedAt: row.approvedAt?.toISOString(),
    lockedAt: row.lockedAt?.toISOString(),
    submittedById: row.submittedById ?? undefined,
    submittedAt: row.submittedAt?.toISOString(),
    validationAcknowledgedAt: row.validationAcknowledgedAt?.toISOString(),
    validationAcknowledgedById: row.validationAcknowledgedById ?? undefined,
    reversalOfRunId: row.reversalOfRunId ?? undefined,
    reversedAt: row.reversedAt?.toISOString(),
    totalGrossMinorUnits: row.totalGrossMinorUnits,
    totalNetMinorUnits: row.totalNetMinorUnits,
    totalDeductionsMinorUnits: row.totalDeductionsMinorUnits,
    currency: row.currency,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPayrollItem(
  row: ItemRow,
  workerName?: string,
): PayrollItem {
  return {
    id: row.id,
    organisationId: row.organisationId,
    payrollRunId: row.payrollRunId,
    workerId: row.workerId,
    workerName,
    type: row.type as PayrollItem['type'],
    description: row.description,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    overrideReason: row.overrideReason ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toApproval(row: ApprovalRow): PayrollRunApproval {
  return {
    id: row.id,
    payrollRunId: row.payrollRunId,
    stepNumber: row.stepNumber,
    role: row.role as SystemRole,
    status: row.status as PayrollRunApproval['status'],
    actorId: row.actorId ?? undefined,
    comment: row.comment ?? undefined,
  };
}

/**
 * Payroll runs (PRD PAY-05 … PAY-11): prepare (proration, leave, absences,
 * recurring items), review, item overrides, validation, the approval chain,
 * payment creation, locking, and reversal. Money is integer minor units;
 * totals always equal the sum of the item lines. Approved runs are immutable —
 * corrections go through a reversal run or the next period.
 */
@Injectable()
export class PayrollRunsService {
  private readonly logger = new Logger(PayrollRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly compensation: CompensationService,
    private readonly leaveRequests: LeaveRequestsService,
    private readonly attendance: AttendanceService,
    private readonly config: PayrollConfigService,
    private readonly statutory: StatutoryRulePacksService,
    private readonly payslips: PayslipsService,
    private readonly expenseClaims: ExpenseClaimsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Read ───────────────────────────────────────────────────────────────────

  async list(query: ListQueryDto): Promise<{
    data: PayrollRun[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.PayrollRunWhereInput = {
        ...(query.status ? { status: query.status } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.payrollRun.findMany({
          where,
          orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.payrollRun.count({ where }),
      ]);
      return {
        data: rows.map(toPayrollRun),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<PayrollRun & { approvals: PayrollRunApproval[] }> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payrollRun.findFirst({
        where: { id },
        include: { approvals: { orderBy: { stepNumber: 'asc' } } },
      });
      if (!row) throw new NotFoundException('Payroll run not found');
      return { ...toPayrollRun(row), approvals: row.approvals.map(toApproval) };
    });
  }

  async items(id: string): Promise<PayrollItem[]> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!run) throw new NotFoundException('Payroll run not found');
      const rows = await tx.payrollItem.findMany({
        where: { payrollRunId: id },
        orderBy: [{ workerId: 'asc' }, { createdAt: 'asc' }],
      });
      const names = await this.workerNameMap(
        tx,
        rows.map((r) => r.workerId),
      );
      return rows.map((row) => toPayrollItem(row, names.get(row.workerId)));
    });
  }

  /** Resolve worker display names for a set of ids (denormalised for the UI). */
  private async workerNameMap(
    tx: Prisma.TransactionClient,
    workerIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(workerIds)];
    if (unique.length === 0) return new Map();
    const workers = await tx.worker.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      workers.map((w) => [
        w.id,
        `${w.firstName} ${w.lastName}`.trim() || w.id.slice(0, 8),
      ]),
    );
  }

  /**
   * Recompute the run totals from every persisted line. Shared by the item
   * override and one-off add paths so totals always reconcile to the lines.
   */
  private async recomputeRunTotals(
    tx: Prisma.TransactionClient,
    runId: string,
  ): Promise<void> {
    const rows = await tx.payrollItem.findMany({
      where: { payrollRunId: runId },
    });
    const byWorker = new Map<string, PreparedLine[]>();
    for (const row of rows) {
      const lines = byWorker.get(row.workerId) ?? [];
      lines.push({
        itemType: row.type as RunItemType,
        description: row.description,
        amountMinorUnits: row.amountMinorUnits,
      });
      byWorker.set(row.workerId, lines);
    }
    const totals = { gross: 0, deductions: 0, net: 0 };
    for (const [workerId, lines] of byWorker) {
      const folded = foldWorkerLines(workerId, lines);
      totals.gross += folded.grossMinorUnits;
      totals.deductions += folded.deductionsMinorUnits;
      totals.net += folded.netMinorUnits;
    }
    await tx.payrollRun.update({
      where: { id: runId },
      data: {
        totalGrossMinorUnits: totals.gross,
        totalDeductionsMinorUnits: totals.deductions,
        totalNetMinorUnits: totals.net,
      },
    });
  }

  // ── Create / prepare / review ──────────────────────────────────────────────

  async create(dto: CreateDto): Promise<PayrollRun> {
    const { organisationId, userId } = this.requireContext();
    const periodStart = parseDateOnly(dto.periodStart);
    const periodEnd = parseDateOnly(dto.periodEnd);
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException('periodEnd must be on or after periodStart');
    }

    return this.prisma.withRequestContext(async (tx) => {
      const calendar = await tx.payCalendar.findFirst({
        where: { id: dto.payCalendarId },
      });
      if (!calendar) throw new NotFoundException('Pay calendar not found');

      this.assertPeriodMatchesCalendar(
        {
          frequency: calendar.frequency,
          dayOfMonth: calendar.dayOfMonth,
          dayOfWeek: calendar.dayOfWeek,
        },
        periodStart,
        periodEnd,
      );

      const duplicate = await tx.payrollRun.findFirst({
        where: {
          payCalendarId: calendar.id,
          periodStart,
          periodEnd,
          reversalOfRunId: null,
          reversedAt: null,
          status: {
            in: ['PENDING_APPROVAL', 'APPROVED', 'PROCESSED', 'LOCKED'],
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(
          'Another payroll run already exists for this calendar and period',
        );
      }

      const org = await tx.organisation.findUnique({
        where: { id: organisationId },
        select: { currency: true },
      });

      const row = await tx.payrollRun.create({
        data: {
          organisationId,
          payCalendarId: calendar.id,
          periodStart,
          periodEnd,
          preparedById: userId,
          createdBy: userId,
          currency: org?.currency ?? 'USD',
          notes: dto.notes ?? null,
        },
      });
      return toPayrollRun(row);
    });
  }

  /**
   * (Re)compute every item line and the run totals (PAY-05 / PAY-08). Leaves
   * DRAFT runs in DRAFT and IN_REVIEW runs in IN_REVIEW. Re-preparing replaces
   * previous lines — including any manual overrides (each was audit-logged).
   */
  async prepare(id: string): Promise<PayrollRun> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('prepare', run, {
        isReversal: run.reversalOfRunId != null,
      });

      const periodStart = run.periodStart;
      const periodEnd = run.periodEnd;

      const [workers, recurringRows, org] = await Promise.all([
        tx.worker.findMany({
          where: { organisationId: run.organisationId },
          select: {
            id: true,
            employeeNumber: true,
            firstName: true,
            lastName: true,
            status: true,
            startDate: true,
            endDate: true,
          },
          orderBy: { employeeNumber: 'asc' },
        }),
        tx.recurringPayItem.findMany({
          where: {
            organisationId: run.organisationId,
            isActive: true,
            // Employee-side types only; employer costs are not run lines.
            type: { in: ['DEDUCTION', 'TAX', 'EMPLOYEE_PENSION'] },
            validFrom: { lte: periodEnd },
            OR: [{ validTo: null }, { validTo: { gte: periodStart } }],
          },
        }),
        tx.organisation.findUnique({
          where: { id: run.organisationId },
          select: { currency: true, country: true },
        }),
      ]);

      const eligible = workers.filter(
        (w) =>
          (PAYROLL_ELIGIBLE_STATUSES as readonly string[]).includes(w.status) &&
          w.startDate.getTime() <= periodEnd.getTime() &&
          (w.endDate == null || w.endDate.getTime() >= periodStart.getTime()),
      );
      if (eligible.length === 0) {
        const start = periodStart.toISOString().slice(0, 10);
        const end = periodEnd.toISOString().slice(0, 10);
        throw new BadRequestException(
          `No eligible workers for the ${start} to ${end} pay period. Workers must be ACTIVE or ON_LEAVE and employed during that period.`,
        );
      }
      const workerIds = eligible.map((w) => w.id);

      // M3a: the org's effective statutory pack for this country + period.
      // Never invented — null when the org has configured none.
      const statutoryRules: StatutoryRule[] =
        (org?.country
          ? await this.statutory.activePackFor(
              tx,
              run.organisationId,
              org.country,
              periodEnd,
            )
          : null) ?? [];

      // M3d: fold finance-approved reimbursements into this run as earnings.
      const reimbursementsByWorker =
        await this.expenseClaims.consumeApprovedForRun(
          tx,
          { id: run.id, organisationId: run.organisationId },
          workerIds,
          periodEnd,
        );
      const employerCostsByWorker = new Map<string, number>();

      const payrollConfig = await this.config.get();
      const [leaveByWorker, absenceByWorker, overtimeByWorker] = await Promise.all([
        this.leaveRequests.leaveForPayroll({
          periodStart,
          periodEnd,
          workerIds,
        }),
        this.attendance.absenceDaysInPeriod({
          periodStart,
          periodEnd,
          workerIds,
        }),
        payrollConfig.overtimeEnabled
          ? this.attendance.overtimeMinutesInPeriod({
              periodStart,
              periodEnd,
              workerIds,
              standardDailyMinutes: payrollConfig.standardDailyMinutes,
            })
          : Promise.resolve({} as Record<string, number>),
      ]);

      const recurringByWorker = new Map<string, RunRecurringInput[]>();
      for (const row of recurringRows) {
        const list = recurringByWorker.get(row.workerId) ?? [];
        list.push({
          name: row.name,
          type: row.type as RunRecurringInput['type'],
          calculation: row.calculation as RunRecurringInput['calculation'],
          amountMinorUnits: row.amountMinorUnits,
          rateBps: row.rateBps,
        });
        recurringByWorker.set(row.workerId, list);
      }

      let currency = org?.currency ?? 'USD';
      let currencySet = false;
      const itemRows: Prisma.PayrollItemUncheckedCreateInput[] = [];
      const totals = { gross: 0, deductions: 0, net: 0 };

      for (const worker of eligible) {
        const leave = leaveByWorker[worker.id] ?? {
          workingDays: 0,
          unpaidLeaveDays: 0,
        };

        // PAY-05 joiner/leaver proration: working days actually employed.
        const clipped =
          worker.startDate.getTime() > periodStart.getTime() ||
          (worker.endDate != null &&
            worker.endDate.getTime() < periodEnd.getTime());
        let employedWorkingDays = leave.workingDays;
        if (clipped) {
          const clipStart =
            worker.startDate.getTime() > periodStart.getTime()
              ? worker.startDate
              : periodStart;
          const clipEnd =
            worker.endDate != null && worker.endDate.getTime() < periodEnd.getTime()
              ? worker.endDate
              : periodEnd;
          const clippedLeave = await this.leaveRequests.leaveForPayroll({
            periodStart: clipStart,
            periodEnd: clipEnd,
            workerIds: [worker.id],
          });
          employedWorkingDays = clippedLeave[worker.id]?.workingDays ?? 0;
        }

        const rate = await this.compensation.getCurrentForPayroll(
          worker.id,
          periodEnd,
        );
        if (rate) currency = rate.currency;
        currencySet = currencySet || rate != null;

        let components = (rate?.components ?? []).map((c: PayComponent) => ({
          code: c.code,
          description: c.label,
          amountMinorUnits: c.amountMinorUnits,
        }));
        if (components.length === 0) {
          // No compensation on file — leave a visible zero line so PAY-08
          // validations can flag this worker (MISSING_SALARY).
          components = [
            {
              code: 'BASIC_SALARY',
              description: 'Basic salary (no compensation on file)',
              amountMinorUnits: rate?.grossAmountMinorUnits ?? 0,
            },
          ];
        }

        const baseGross = components.reduce((s,comp)=>s+Math.max(0,Math.round(comp.amountMinorUnits)),0);
        const rateDaily = leave.workingDays>0?Math.round(baseGross/leave.workingDays):0;
        const result = prepareWorker({
          workerId: worker.id,
          components,
          periodWorkingDays: leave.workingDays,
          employedWorkingDays,
          unpaidLeaveDays: leave.unpaidLeaveDays,
          absenceDays: absenceByWorker[worker.id] ?? 0,
          recurring: recurringByWorker.get(worker.id) ?? [],
          overtimeEnabled: payrollConfig.overtimeEnabled,
          overtimeMinutes: overtimeByWorker[worker.id] ?? 0,
          overtimeMultiplierBps: payrollConfig.overtimeMultiplierBps,
          standardDailyMinutes: payrollConfig.standardDailyMinutes,
          dailyRateMinorUnits: rateDaily,
        });

        // M3d: finance-approved reimbursements for this worker are extra
        // earnings folded into the run.
        for (const reimbursement of reimbursementsByWorker.get(worker.id) ?? []) {
          result.lines.push({
            itemType: 'REIMBURSEMENT',
            description: reimbursement.description,
            amountMinorUnits: reimbursement.amountMinorUnits,
          });
        }

        // M3a: apply the statutory pack (rules-as-data). The base for banded
        // rules is the gross of earnings *before* statutory lines.
        if (statutoryRules.length > 0) {
          const grossBeforeStatutory = result.lines
            .filter((l) => l.amountMinorUnits > 0)
            .reduce((sum, l) => sum + l.amountMinorUnits, 0);
          const basicSalary = result.lines
            .filter((l) => l.itemType === 'BASIC_SALARY')
            .reduce((sum, l) => sum + l.amountMinorUnits, 0);
          const applied = applyStatutoryToWorker(
            worker.id,
            {
              workerId: worker.id,
              grossMinorUnits: grossBeforeStatutory,
              basicSalaryMinorUnits: basicSalary,
            },
            statutoryRules,
          );
          for (const line of applied.lines) {
            // Employee-side lines reduce net; employer-side lines are a cost,
            // tracked separately and not part of the worker's pay lines.
            if (line.amountMinorUnits < 0) {
              result.lines.push({
                itemType: line.itemType as RunItemType,
                description: line.description,
                amountMinorUnits: line.amountMinorUnits,
              });
            }
          }
          if (applied.employerMinorUnits > 0) {
            employerCostsByWorker.set(worker.id, applied.employerMinorUnits);
          }
        }

        // Recompute footer totals from the final line set so they reconcile.
        const folded = foldWorkerLines(worker.id, result.lines);
        totals.gross += folded.grossMinorUnits;
        totals.deductions += folded.deductionsMinorUnits;
        totals.net += folded.netMinorUnits;

        for (const line of result.lines) {
          itemRows.push({
            organisationId: run.organisationId,
            payrollRunId: run.id,
            workerId: worker.id,
            type: line.itemType,
            description: line.description,
            amountMinorUnits: line.amountMinorUnits,
            currency: rate?.currency ?? org?.currency ?? 'USD',
          });
        }
      }

      // `currencySet` documents that per-item currency follows each worker's
      // compensation; the run-level currency stays the org default unless a
      // single compensation currency is present.
      void currencySet;

      await tx.payrollItem.deleteMany({ where: { payrollRunId: run.id } });
      if (itemRows.length > 0) {
        await tx.payrollItem.createMany({ data: itemRows });
      }
      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          currency,
          totalGrossMinorUnits: totals.gross,
          totalDeductionsMinorUnits: totals.deductions,
          totalNetMinorUnits: totals.net,
        },
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_RUN_CREATED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: {
          prepared: true,
          workerCount: eligible.length,
          itemCount: itemRows.length,
          totalGrossMinorUnits: totals.gross,
          totalDeductionsMinorUnits: totals.deductions,
          totalNetMinorUnits: totals.net,
        },
      });
      return toPayrollRun(updated);
    }, HEAVY_TX);
  }

  async review(id: string): Promise<PayrollRun> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('review', run);
      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: 'IN_REVIEW' },
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_RUN_CREATED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: { review: true, status: 'IN_REVIEW' },
      });
      return toPayrollRun(updated);
    });
  }

  // ── Item overrides (PAY-09) ────────────────────────────────────────────────

  async updateItem(
    runId: string,
    itemId: string,
    dto: UpdateItemDto,
  ): Promise<PayrollItem> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, runId);
      this.assertAction('override', run);
      const item = await tx.payrollItem.findFirst({
        where: { id: itemId, payrollRunId: runId },
      });
      if (!item) throw new NotFoundException('Payroll item not found');

      const previousAmount = item.amountMinorUnits;
      await tx.payrollItem.update({
        where: { id: item.id },
        data: {
          amountMinorUnits: dto.amountMinorUnits,
          overrideReason: dto.overrideReason,
        },
      });

      // Recompute totals from every line so they keep reconciling exactly.
      await this.recomputeRunTotals(tx, runId);

      await this.audit.record({
        action: AuditAction.PAYROLL_ITEM_OVERRIDDEN,
        targetType: 'payroll_item',
        targetId: item.id,
        newValue: {
          previousAmountMinorUnits: previousAmount,
          amountMinorUnits: dto.amountMinorUnits,
          overrideReason: dto.overrideReason,
          workerId: item.workerId,
          payrollRunId: runId,
        },
      });
      const names = await this.workerNameMap(tx, [item.workerId]);
      const updated = await tx.payrollItem.findFirst({
        where: { id: item.id },
      });
      return toPayrollItem(updated!, names.get(item.workerId));
    });
  }

  /**
   * PAY-09: add a one-off earning or deduction line to a worker mid-run (e.g.
   * a manual deduction or a spot bonus). Allowed only while the run is DRAFT or
   * IN_REVIEW; the reason is mandatory and the change is audit-logged. The
   * worker must already be part of the run.
   */
  async createItem(runId: string, dto: CreateItemDto): Promise<PayrollItem> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, runId);
      this.assertAction('override', run);

      const exists = await tx.payrollItem.findFirst({
        where: { payrollRunId: runId, workerId: dto.workerId },
        select: { id: true },
      });
      if (!exists) {
        throw new BadRequestException(
          'Worker is not part of this run — prepare the run first',
        );
      }

      const created = await tx.payrollItem.create({
        data: {
          organisationId: run.organisationId,
          payrollRunId: runId,
          workerId: dto.workerId,
          type: dto.type as ItemRow['type'],
          description: dto.description,
          amountMinorUnits: dto.amountMinorUnits,
          currency: run.currency,
          overrideReason: dto.overrideReason,
        },
      });

      await this.recomputeRunTotals(tx, runId);

      await this.audit.record({
        action: AuditAction.PAYROLL_ITEM_CREATED,
        targetType: 'payroll_item',
        targetId: created.id,
        newValue: {
          workerId: dto.workerId,
          type: dto.type,
          description: dto.description,
          amountMinorUnits: dto.amountMinorUnits,
          overrideReason: dto.overrideReason,
          payrollRunId: runId,
        },
      });

      const names = await this.workerNameMap(tx, [dto.workerId]);
      return toPayrollItem(created, names.get(dto.workerId));
    });
  }

  // ── Validation (PAY-08 / PAY-10) ───────────────────────────────────────────

  async validations(id: string): Promise<RunValidationResult> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      const items = await tx.payrollItem.findMany({
        where: { payrollRunId: run.id },
      });

      const workerIds = [...new Set(items.map((i) => i.workerId))];
      const grossByWorker = new Map<string, number>();
      const deductionsByWorker = new Map<string, number>();
      const netByWorker = new Map<string, number>();
      for (const workerId of workerIds) {
        grossByWorker.set(workerId, 0);
        deductionsByWorker.set(workerId, 0);
        netByWorker.set(workerId, 0);
      }
      for (const item of items) {
        netByWorker.set(
          item.workerId,
          (netByWorker.get(item.workerId) ?? 0) + item.amountMinorUnits,
        );
        if (item.amountMinorUnits >= 0) {
          grossByWorker.set(
            item.workerId,
            (grossByWorker.get(item.workerId) ?? 0) + item.amountMinorUnits,
          );
        } else {
          deductionsByWorker.set(
            item.workerId,
            (deductionsByWorker.get(item.workerId) ?? 0) - item.amountMinorUnits,
          );
        }
      }

      const workers = await tx.worker.findMany({
        where: {
          organisationId: run.organisationId,
          ...(workerIds.length > 0 ? { id: { in: workerIds } } : { id: '__none__' }),
        },
        select: {
          id: true,
          employeeNumber: true,
          firstName: true,
          lastName: true,
          status: true,
          startDate: true,
          endDate: true,
        },
      });

      const allWorkers = await tx.worker.findMany({
        where: { organisationId: run.organisationId },
        select: { id: true, status: true, startDate: true, endDate: true },
      });
      const excluded = allWorkers
        .filter(
          (w) =>
            !(
              (PAYROLL_ELIGIBLE_STATUSES as readonly string[]).includes(
                w.status,
              ) &&
              w.startDate.getTime() <= run.periodEnd.getTime() &&
              (w.endDate == null ||
                w.endDate.getTime() >= run.periodStart.getTime())
            ),
        )
        .map((w) => ({ workerId: w.id, status: w.status }));
      const eligibleCount = allWorkers.length - excluded.length;

      const previousRun = await tx.payrollRun.findFirst({
        where: {
          organisationId: run.organisationId,
          payCalendarId: run.payCalendarId,
          periodEnd: { lt: run.periodEnd },
          reversalOfRunId: null,
          status: { in: ['APPROVED', 'PROCESSED', 'LOCKED'] },
        },
        orderBy: { periodEnd: 'desc' },
      });
      const previousGross = new Map<string, number>();
      if (previousRun) {
        const prevItems = await tx.payrollItem.findMany({
          where: { payrollRunId: previousRun.id },
        });
        for (const item of prevItems) {
          if (item.amountMinorUnits >= 0) {
            previousGross.set(
              item.workerId,
              (previousGross.get(item.workerId) ?? 0) + item.amountMinorUnits,
            );
          }
        }
      }

      const workerInputs: WorkerValidationInput[] = [];
      for (const worker of workers) {
        const rate = await this.compensation.getCurrentForPayroll(
          worker.id,
          run.periodEnd,
        );
        const [bankCount, unreviewedBank] = await Promise.all([
          tx.bankAccount.count({ where: { workerId: worker.id } }),
          tx.bankAccount.findFirst({
            where: { workerId: worker.id, requiresPayrollReview: true },
            select: { id: true },
          }),
        ]);
        const identifier = `${worker.employeeNumber} (${worker.firstName} ${worker.lastName})`;
        workerInputs.push({
          workerId: worker.id,
          identifier,
          hasCompensation:
            rate != null &&
            (rate.grossAmountMinorUnits > 0 ||
              (rate.components?.length ?? 0) > 0),
          hasBankAccount: bankCount > 0,
          bankDetailsAwaitingReview: unreviewedBank != null,
          grossMinorUnits: grossByWorker.get(worker.id) ?? 0,
          deductionMinorUnits: deductionsByWorker.get(worker.id) ?? 0,
          netMinorUnits: netByWorker.get(worker.id) ?? 0,
          previousGrossMinorUnits: previousGross.get(worker.id) ?? null,
        });
      }

      const duplicateRun = await tx.payrollRun.findFirst({
        where: {
          organisationId: run.organisationId,
          payCalendarId: run.payCalendarId,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          id: { not: run.id },
          reversalOfRunId: null,
          reversedAt: null,
          status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PROCESSED', 'LOCKED'] },
        },
        select: { id: true },
      });

      const thresholds = await this.config.thresholds();
      const result = validateRun({
        workers: workerInputs,
        itemCount: items.length,
        duplicateRunExists: duplicateRun != null,
        // Duplicate WORKER rows are detected below from repeated base-salary
        // lines — the run-validator contract is fed [] here.
        duplicateWorkerIds: [],
        thresholds: thresholds as RunValidationThresholds,
      });

      // A worker may legitimately have many lines (earnings + deductions), but
      // never more than one base-salary line — that means a duplicated seed.
      const baseLines = items.filter((i) => i.type === 'BASIC_SALARY');
      const baseCounts = new Map<string, number>();
      for (const line of baseLines) {
        baseCounts.set(line.workerId, (baseCounts.get(line.workerId) ?? 0) + 1);
      }
      for (const [workerId, count] of baseCounts) {
        if (count > 1) {
          result.errors.push({
            code: 'DUPLICATE_WORKER',
            workerId,
            message: 'Worker appears more than once in this run',
          });
        }
      }

      const notices: RunValidationIssue[] = [];
      if (eligibleCount === 0) {
        // An empty run with nobody to pay is an expected state, not an error:
        // surface it as a neutral notice instead of the blocking NO_ITEMS error.
        result.errors = result.errors.filter(
          (issue) => issue.code !== 'NO_ITEMS',
        );
        notices.push({
          code: 'NO_ELIGIBLE_WORKERS',
          message: 'No eligible workers for this month',
        });
      }

      return {
        errors: result.errors,
        warnings: result.warnings,
        notices,
        excluded,
        thresholds: thresholds ?? DEFAULT_VALIDATION_THRESHOLDS,
        acknowledgedAt: run.validationAcknowledgedAt?.toISOString(),
        acknowledgedById: run.validationAcknowledgedById ?? undefined,
      } satisfies RunValidationResult;
    }, HEAVY_TX);
  }

  // ── Submit / acknowledge / approve / reject (PAY-07 / PAY-11) ─────────────

  async submit(id: string): Promise<PayrollRun> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('submit', run, {
        isReversal: run.reversalOfRunId != null,
      });

      const items = await tx.payrollItem.findMany({
        where: { payrollRunId: run.id },
        select: { id: true },
      });
      const issues = await this.validations(id);
      if (issues.errors.length > 0 || items.length === 0) {
        throw new BadRequestException({
          message: 'Run has blocking validation errors and cannot be submitted',
          errors: issues.errors,
        });
      }

      const config = await this.config.get();
      await tx.payrollRunApproval.deleteMany({
        where: { payrollRunId: run.id },
      });
      await tx.payrollRunApproval.createMany({
        data: config.approvalChain.map((role, index) => ({
          organisationId: run.organisationId,
          payrollRunId: run.id,
          stepNumber: index + 1,
          role,
        })),
      });

      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: 'PENDING_APPROVAL',
          submittedById: userId,
          submittedAt: new Date(),
          // A rejected run re-submits against fresh validations.
          validationAcknowledgedAt: null,
          validationAcknowledgedById: null,
        },
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_RUN_SUBMITTED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: {
          approvalChain: config.approvalChain,
          totalNetMinorUnits: run.totalNetMinorUnits,
          warningCount: issues.warnings.length,
        },
      });
      await this.notify({
        organisationId: run.organisationId,
        actorUserId: userId,
        roles: config.approvalChain.slice(0, 1),
        intent: {
          type: NotificationType.PAYROLL_RUN_SUBMITTED,
          title: 'Payroll run awaiting approval',
          body: `A payroll run for ${this.periodLabel(
            run.periodStart,
            run.periodEnd,
          )} was submitted for approval.`,
          link: '/payroll',
          metadata: { payrollRunId: run.id },
        },
      });
      return toPayrollRun(updated);
    }, HEAVY_TX);
  }

  async acknowledge(id: string): Promise<RunValidationResult> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('acknowledge', run);
      await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          validationAcknowledgedAt: new Date(),
          validationAcknowledgedById: userId,
        },
      });
      return this.validations(id);
    });
  }

  async approve(id: string, dto: ApproveDto): Promise<PayrollRun> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('approve', run);
      if (run.preparedById === userId) {
        throw new ForbiddenException(
          'Separation of duties: the preparer cannot approve their own run',
        );
      }

      const issues = await this.validations(id);
      if (issues.errors.length > 0) {
        throw new ConflictException({
          message: 'Run has blocking validation errors',
          errors: issues.errors,
        });
      }
      if (
        issues.warnings.length > 0 &&
        run.validationAcknowledgedAt == null
      ) {
        throw new ConflictException(
          'Warnings must be acknowledged before approval (POST /payroll/runs/:id/acknowledge)',
        );
      }

      const role = await this.actorRole(tx, organisationId, userId);
      const steps = await tx.payrollRunApproval.findMany({
        where: { payrollRunId: run.id },
        orderBy: { stepNumber: 'asc' },
      });
      const next = steps.find((s) => s.status === 'PENDING');
      if (!next) throw new ConflictException('Run has no pending approval step');

      const isOwnerOverride = role === Role.OWNER;
      if (!isOwnerOverride && role !== (next.role as SystemRole)) {
        throw new ForbiddenException(
          `Step ${next.stepNumber} requires the ${next.role} role (your role: ${role})`,
        );
      }

      await tx.payrollRunApproval.update({
        where: { id: next.id },
        data: {
          status: 'APPROVED',
          actorId: userId,
          comment: dto.comment ?? null,
        },
      });
      const remaining = steps.filter(
        (s) => s.id !== next.id && s.status === 'PENDING',
      );
      const fullyApproved = remaining.length === 0;

      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: fullyApproved
          ? {
              status: 'APPROVED',
              approvedById: userId,
              approvedAt: new Date(),
            }
          : {},
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_RUN_APPROVED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: {
          stepNumber: next.stepNumber,
          role: next.role,
          actorRole: role,
          fullyApproved,
          comment: dto.comment ?? null,
        },
      });
      await this.notify({
        organisationId: run.organisationId,
        actorUserId: userId,
        roles: fullyApproved
          ? [Role.PAYROLL_ADMINISTRATOR]
          : remaining
              .filter((s) => s.status === 'PENDING')
              .map((s) => s.role as SystemRole)
              .slice(0, 1),
        userIds: [run.submittedById].filter(Boolean) as string[],
        intent: {
          type: NotificationType.PAYROLL_RUN_APPROVED,
          title: fullyApproved
            ? 'Payroll run approved'
            : 'Payroll approval step completed',
          body: fullyApproved
            ? `The payroll run for ${this.periodLabel(
                run.periodStart,
                run.periodEnd,
              )} is fully approved and ready to process.`
            : `Step ${next.stepNumber} of the payroll approval chain was completed.`,
          link: '/payroll',
          metadata: { payrollRunId: run.id, fullyApproved },
        },
      });
      return toPayrollRun(updated);
    }, HEAVY_TX);
  }

  async reject(id: string, dto: RejectDto): Promise<PayrollRun> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('reject', run);
      if (run.preparedById === userId) {
        throw new ForbiddenException(
          'Separation of duties: the preparer cannot reject their own run',
        );
      }
      const role = await this.actorRole(tx, organisationId, userId);
      await tx.payrollRunApproval.updateMany({
        where: { payrollRunId: run.id, status: 'PENDING' },
        data: { status: 'REJECTED', actorId: userId, comment: dto.comment },
      });
      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: 'IN_REVIEW',
          submittedById: null,
          submittedAt: null,
          validationAcknowledgedAt: null,
          validationAcknowledgedById: null,
        },
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_RUN_REJECTED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: { comment: dto.comment, actorRole: role },
      });
      await this.notify({
        organisationId: run.organisationId,
        actorUserId: userId,
        roles: [Role.PAYROLL_ADMINISTRATOR],
        userIds: [run.submittedById].filter(Boolean) as string[],
        intent: {
          type: NotificationType.PAYROLL_RUN_REJECTED,
          title: 'Payroll run rejected',
          body: `The payroll run for ${this.periodLabel(
            run.periodStart,
            run.periodEnd,
          )} was rejected.${dto.comment ? ` Note: ${dto.comment}` : ''}`,
          link: '/payroll',
          metadata: { payrollRunId: run.id },
        },
      });
      return toPayrollRun(updated);
    }, HEAVY_TX);
  }

  // ── Process / lock / reverse (PAY-06 / PAY-07) ─────────────────────────────

  async process(id: string): Promise<{
    run: PayrollRun;
    paymentsCreated: number;
    totalPaidMinorUnits: number;
  }> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('process', run);

      const items = await tx.payrollItem.findMany({
        where: { payrollRunId: run.id },
      });
      const byWorker = new Map<string, PreparedLine[]>();
      for (const item of items) {
        const lines = byWorker.get(item.workerId) ?? [];
        lines.push({
          itemType: item.type as RunItemType,
          description: item.description,
          amountMinorUnits: item.amountMinorUnits,
        });
        byWorker.set(item.workerId, lines);
      }

      const existing = await tx.payment.count({
        where: { payrollRunId: run.id },
      });
      if (existing > 0) {
        throw new ConflictException('Payments already exist for this run');
      }

      // M3a: recompute employer-side statutory costs for the payslips (these
      // are a workforce cost, not a pay line, so they are not stored as items).
      const org = await tx.organisation.findUnique({
        where: { id: run.organisationId },
        select: { country: true },
      });
      const statutoryRules: StatutoryRule[] =
        (org?.country
          ? await this.statutory.activePackFor(
              tx,
              run.organisationId,
              org.country,
              run.periodEnd,
            )
          : null) ?? [];
      const employerCostsByWorker = new Map<string, number>();
      if (statutoryRules.length > 0) {
        for (const [workerId, lines] of byWorker) {
          const gross = lines
            .filter((l) => l.amountMinorUnits > 0)
            .reduce((sum, l) => sum + l.amountMinorUnits, 0);
          const basicSalary = lines
            .filter((l) => l.itemType === 'BASIC_SALARY')
            .reduce((sum, l) => sum + l.amountMinorUnits, 0);
          const applied = applyStatutoryToWorker(
            workerId,
            {
              workerId,
              grossMinorUnits: gross,
              basicSalaryMinorUnits: basicSalary,
            },
            statutoryRules,
          );
          if (applied.employerMinorUnits > 0) {
            employerCostsByWorker.set(workerId, applied.employerMinorUnits);
          }
        }
      }

      let paymentsCreated = 0;
      let totalPaid = 0;
      for (const [workerId, lines] of byWorker) {
        const folded = foldWorkerLines(workerId, lines);
        if (folded.netMinorUnits === 0) continue;
        await tx.payment.create({
          data: {
            organisationId: run.organisationId,
            payrollRunId: run.id,
            workerId,
            amountMinorUnits: folded.netMinorUnits,
            currency: run.currency,
            reference: `PAY-${run.id}-${workerId}`,
            description: `Payroll run ${run.periodStart.toISOString().slice(0, 10)}–${run.periodEnd.toISOString().slice(0, 10)}`,
            createdBy: userId,
          },
        });
        paymentsCreated += 1;
        totalPaid += folded.netMinorUnits;
      }

      // PAY-12: payments are assembled into a draft bank batch immediately so
      // finance can review, approve and export them as one audited artefact.
      let paymentBatchId: string | null = null;
      if (paymentsCreated > 0) {
        const batchReference = `PB-${run.periodEnd
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
        const batch = await tx.paymentBatch.create({
          data: {
            organisationId: run.organisationId,
            payrollRunId: run.id,
            reference: batchReference,
            label: `Payroll ${run.periodStart
              .toISOString()
              .slice(0, 10)} – ${run.periodEnd.toISOString().slice(0, 10)}`,
            status: PaymentBatchStatus.DRAFT,
            currency: run.currency,
            totalMinorUnits: totalPaid,
            paymentCount: paymentsCreated,
            createdBy: userId,
          },
        });
        await tx.payment.updateMany({
          where: { payrollRunId: run.id, paymentBatchId: null },
          data: { paymentBatchId: batch.id },
        });
        paymentBatchId = batch.id;
        await this.audit.record({
          action: AuditAction.PAYMENT_BATCH_CREATED,
          targetType: 'payment_batch',
          targetId: batch.id,
          newValue: {
            reference: batchReference,
            payrollRunId: run.id,
            paymentCount: paymentsCreated,
            totalMinorUnits: totalPaid,
          },
        });
      }

      // M3b: freeze one payslip per worker from the run's item lines.
      const periodLabel = this.periodLabel(run.periodStart, run.periodEnd);
      const payslipsCreated = await this.payslips.generateForRun(
        tx,
        {
          id: run.id,
          organisationId: run.organisationId,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          currency: run.currency,
        },
        byWorker,
        employerCostsByWorker,
        periodLabel,
      );

      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: 'PROCESSED' },
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_RUN_PROCESSED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: {
          paymentsCreated,
          totalPaidMinorUnits: totalPaid,
          payslipsCreated,
          paymentBatchId,
        },
      });
      await this.notify({
        organisationId: run.organisationId,
        actorUserId: userId,
        roles: [Role.PAYROLL_ADMINISTRATOR, Role.FINANCE_APPROVER],
        intent: {
          type: NotificationType.PAYROLL_RUN_PROCESSED,
          title: 'Payroll run processed',
          body: `The payroll run for ${this.periodLabel(
            run.periodStart,
            run.periodEnd,
          )} was processed (${paymentsCreated} payments). Payslips are available.`,
          link: '/payroll',
          metadata: { payrollRunId: run.id, paymentBatchId },
        },
      });
      return {
        run: toPayrollRun(updated),
        paymentsCreated,
        totalPaidMinorUnits: totalPaid,
      };
    }, HEAVY_TX);
  }

  async lock(id: string): Promise<PayrollRun> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('lock', run);
      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: 'LOCKED', lockedAt: new Date() },
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_RUN_LOCKED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: { locked: true },
      });
      return toPayrollRun(updated);
    }, HEAVY_TX);
  }

  /**
   * PAY-06: reverse a post-approval run. The original is only stamped with
   * `reversedAt` (never mutated); a new DRAFT reversal run carries negated
   * mirrors of every line and flows through the normal lifecycle, so
   * processing it creates equal and opposite payments.
   */
  async reverse(id: string, dto: ReverseDto): Promise<PayrollRun> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const run = await this.loadRun(tx, id);
      this.assertAction('reverse', run, { isReversed: run.reversedAt != null });

      const items = await tx.payrollItem.findMany({
        where: { payrollRunId: run.id },
        orderBy: [{ workerId: 'asc' }, { createdAt: 'asc' }],
      });

      const reversal = await tx.payrollRun.create({
        data: {
          organisationId,
          payCalendarId: run.payCalendarId,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          preparedById: userId,
          createdBy: userId,
          currency: run.currency,
          reversalOfRunId: run.id,
          notes: `Reversal of run ${run.id}: ${dto.reason}`,
          totalGrossMinorUnits: -run.totalGrossMinorUnits,
          totalDeductionsMinorUnits: -run.totalDeductionsMinorUnits,
          totalNetMinorUnits: -run.totalNetMinorUnits,
        },
      });
      if (items.length > 0) {
        await tx.payrollItem.createMany({
          data: reverseLines(
            items.map((i) => ({
              itemType: i.type as RunItemType,
              description: i.description,
              amountMinorUnits: i.amountMinorUnits,
            })),
          ).map((line, index) => ({
            organisationId,
            payrollRunId: reversal.id,
            workerId: items[index]!.workerId,
            type: line.itemType,
            description: line.description,
            amountMinorUnits: line.amountMinorUnits,
            currency: run.currency,
            overrideReason: 'REVERSAL',
          })),
        });
      }
      await tx.payrollRun.update({
        where: { id: run.id },
        data: { reversedAt: new Date() },
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_RUN_REVERSED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: {
          reversalRunId: reversal.id,
          reason: dto.reason,
          totalNetMinorUnits: -run.totalNetMinorUnits,
        },
      });
      return toPayrollRun(reversal);
    }, HEAVY_TX);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Human pay-period label, e.g. "September 2026". */
  private periodLabel(periodStart: Date, periodEnd: Date): string {
    const start = periodStart.toISOString().slice(0, 10);
    const end = periodEnd.toISOString().slice(0, 10);
    const sameMonth =
      periodStart.getUTCFullYear() === periodEnd.getUTCFullYear() &&
      periodStart.getUTCMonth() === periodEnd.getUTCMonth();
    if (sameMonth) {
      const month = periodStart.toLocaleString('en-US', {
        month: 'long',
        timeZone: 'UTC',
      });
      return `${month} ${periodStart.getUTCFullYear()}`;
    }
    return `${start} – ${end}`;
  }

  private async loadRun(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<RunRow> {
    const run = await tx.payrollRun.findFirst({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  private assertAction(
    action: Parameters<typeof runActionError>[0],
    run: RunRow,
    extra: { isReversal?: boolean; isReversed?: boolean } = {},
  ): void {
    const error = runActionError(
      action,
      run.status as RunStatus,
      extra,
    );
    if (error) throw new ConflictException(error);
  }

  private assertPeriodMatchesCalendar(
    config: PayCalendarConfig,
    periodStart: Date,
    periodEnd: Date,
  ): void {
    const years = [
      periodStart.getUTCFullYear(),
      periodEnd.getUTCFullYear(),
      periodEnd.getUTCFullYear() - 1,
    ];
    const match = years.some((year) =>
      payPeriodsForYear(config, year).some(
        (p) =>
          p.periodStart.getTime() === periodStart.getTime() &&
          p.periodEnd.getTime() === periodEnd.getTime(),
      ),
    );
    if (!match) {
      throw new BadRequestException(
        'periodStart/periodEnd must exactly match a generated period of this pay calendar',
      );
    }
  }

  private async actorRole(
    tx: Prisma.TransactionClient,
    organisationId: string,
    userId: string,
  ): Promise<SystemRole> {
    const membership = await tx.membership.findFirst({
      where: { organisationId, userId },
      select: { role: true },
    });
    if (!membership) {
      throw new UnauthorizedException('No membership for this organisation');
    }
    return membership.role as SystemRole;
  }

  private async notify(input: {
    organisationId: string;
    actorUserId: string;
    roles?: SystemRole[];
    userIds?: string[];
    intent: {
      type: NotificationType;
      title: string;
      body: string;
      link?: string;
      metadata?: Record<string, unknown>;
    };
  }): Promise<void> {
    try {
      const recipients = new Set<string>(input.userIds ?? []);
      if (input.roles && input.roles.length > 0) {
        const members = await this.prisma.withRequestContext((tx) =>
          tx.membership.findMany({
            where: {
              organisationId: input.organisationId,
              isActive: true,
              role: { in: input.roles },
            },
            select: { userId: true },
          }),
        );
        for (const member of members) recipients.add(member.userId);
      }
      recipients.delete(input.actorUserId);
      if (recipients.size === 0) return;
      await this.notifications.emit({
        organisationId: input.organisationId,
        actorUserId: input.actorUserId,
        intents: [...recipients].map((recipientUserId) => ({
          recipientUserId,
          ...input.intent,
        })),
      });
    } catch (error) {
      this.logger.warn(
        `Payroll notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
