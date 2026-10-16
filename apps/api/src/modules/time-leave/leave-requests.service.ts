import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  AuditAction,
  LeaveStatus,
  LeaveTypeCategory,
  Prisma,
  SystemRole,
} from '@ascenda/db';
import { PermissionScope } from '@ascenda/types';
import type {
  LeaveCalendarDay,
  LeaveCalendarEntry,
  LeaveCalendarView,
  LeaveRequestApprovalStep,
  LeaveRequestSummary,
  PaginationMeta,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { getEffectiveScope } from '../../common/rbac/permissions';
import { resolveReadScope, scopeWhereRestricts } from '../../common/rbac/worker-scope';
import { AuditService } from '../audit/audit.service';
import {
  ApprovalPlanStep,
  buildApprovalPlan,
  canActOnStep,
  computeDueAt,
  isFinalStep,
} from './domain/approval';
import {
  HolidayLike,
  WorkSchedule,
  DEFAULT_WORK_SCHEDULE,
  countLeaveDays,
  roundHalf,
} from './domain/working-days';
import {
  InsufficientLeaveBalanceError,
  leaveYear,
} from './domain/leave-balance';
import { buildCalendar, isoDate } from './domain/leave-calendar';
import { blackoutApplies } from './domain/blackout';
import { applyApprovedLeave, reverseApprovedLeave } from './leave-balance-ops';
import { parseDateOnly } from './holidays.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';
import { DelegateLeaveRequestDto } from './dto/delegate-leave-request.dto';
import { ListLeaveRequestsQueryDto } from './dto/list-leave-requests.dto';
import { LeaveCalendarQueryDto } from './dto/leave-calendar-query.dto';

/** Hard cap on a single calendar request (one leap year + slack). */
const MAX_CALENDAR_DAYS = 400;

/** Auto-escalation default: 48 hours (LVE-04) when a request omits a window. */
const DEFAULT_ESCALATION_MINUTES = 60 * 48;
const EPSILON = 1e-9;

const REQUEST_INCLUDE = {
  worker: {
    select: {
      firstName: true,
      lastName: true,
      userId: true,
      managerId: true,
      locationId: true,
    },
  },
  leaveType: {
    select: {
      name: true,
      category: true,
      defaultBalance: true,
      requiresApproval: true,
      isActive: true,
    },
  },
  approvalWorkflow: {
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  },
} satisfies Prisma.LeaveRequestInclude;

type RequestRow = Prisma.LeaveRequestGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;

type ApproverNames = Map<string, string>;

export function toSummary(
  row: RequestRow,
  approverNames?: ApproverNames,
): LeaveRequestSummary {
  const wf = row.approvalWorkflow;
  const steps = wf?.steps.map(
    (s): LeaveRequestApprovalStep => ({
      id: s.id,
      stepOrder: s.stepOrder,
      approverId: s.approverId,
      approverName: approverNames?.get(s.approverId),
      status: s.status as unknown as LeaveRequestApprovalStep['status'],
      actedAt: s.actedAt?.toISOString(),
      note: s.note ?? undefined,
      delegatedToId: s.delegatedToId ?? undefined,
      escalatedToId: s.escalatedToId ?? undefined,
      escalateAfterMinutes: s.escalateAfterMinutes ?? undefined,
      dueAt: s.dueAt?.toISOString() ?? undefined,
      escalatedAt: s.escalatedAt?.toISOString() ?? undefined,
    }),
  );

  return {
    id: row.id,
    organisationId: row.organisationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    workerId: row.workerId,
    workerName: `${row.worker.firstName} ${row.worker.lastName}`.trim(),
    leaveTypeId: row.leaveTypeId,
    leaveTypeName: row.leaveType.name,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    startHalfDay: row.startHalfDay,
    endHalfDay: row.endHalfDay,
    days: Number(row.days),
    status: row.status as unknown as LeaveRequestSummary['status'],
    reason: row.reasonEncrypted ?? undefined,
    submittedAt: row.submittedAt?.toISOString(),
    decidedAt: row.decidedAt?.toISOString(),
    decidedById: row.decidedById ?? undefined,
    approvalWorkflowId: row.approvalWorkflowId ?? undefined,
    createdBy: row.createdBy,
    steps,
    currentStepOrder:
      wf && wf.status === ApprovalStatus.PENDING ? wf.currentStep : undefined,
  };
}

/**
 * Leave requests and the manager → HR approval workflow (PRD LVE-02 / LVE-04).
 * Day counts are working days only (LVE-03); balances move only on final
 * approval and are restored if an approved request is later cancelled.
 */
@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateLeaveRequestDto): Promise<LeaveRequestSummary> {
    const { organisationId, userId, role } = this.requireContext();

    return this.prisma.withRequestContext(async (tx) => {
      const callerWorker = await tx.worker.findFirst({
        where: { userId },
        select: { id: true },
      });
      const targetId = dto.workerId ?? callerWorker?.id;
      if (!targetId) {
        throw new BadRequestException(
          'workerId is required (no worker is linked to your account)',
        );
      }

      const scope = await resolveReadScope(tx, 'leave', 'create');
      const worker = await tx.worker.findFirst({
        where: scopeWhereRestricts(scope.where)
          ? { AND: [scope.where, { id: targetId }] }
          : { id: targetId },
        select: { id: true, firstName: true, lastName: true, managerId: true, locationId: true },
      });
      if (!worker) {
        throw new ForbiddenException('Worker is outside your scope');
      }

      const leaveType = await tx.leaveType.findFirst({
        where: { id: dto.leaveTypeId },
        select: {
          id: true,
          name: true,
          category: true,
          defaultBalance: true,
          requiresApproval: true,
          isActive: true,
        },
      });
      if (!leaveType) throw new NotFoundException('Leave type not found');
      if (!leaveType.isActive) {
        throw new BadRequestException('This leave type is not active');
      }

      const start = parseDateOnly(dto.startDate);
      const end = parseDateOnly(dto.endDate);
      if (end.getTime() < start.getTime()) {
        throw new BadRequestException('endDate must be on or after startDate');
      }

      const { schedule, holidays } = await this.loadScheduleAndHolidays(
        tx,
        worker.locationId,
        start,
        end,
      );
      const days = countLeaveDays({
        start,
        end,
        startHalfDay: dto.startHalfDay,
        endHalfDay: dto.endHalfDay,
        schedule,
        holidays,
      });
      if (days <= 0) {
        throw new BadRequestException('The selected range contains no working days');
      }

      const blackouts = await tx.blackoutPeriod.findMany({
        where: {
          AND: [
            {
              OR: [
                { isRecurring: true },
                { startDate: { lte: end }, endDate: { gte: start } },
              ],
            },
            {
              OR: [
                { locationId: null },
                ...(worker.locationId ? [{ locationId: worker.locationId }] : []),
              ],
            },
            { OR: [{ leaveTypeId: null }, { leaveTypeId: leaveType.id }] },
          ],
        },
        select: { name: true, startDate: true, endDate: true, isRecurring: true },
      });
      const blackout = blackouts.find((b) => blackoutApplies(b, start, end));
      if (blackout) {
        const canOverride =
          dto.overrideBlackout === true &&
          getEffectiveScope(role, 'leave', 'approve') ===
            PermissionScope.ORGANISATION;
        if (!canOverride) {
          throw new ConflictException(
            `The dates fall within a blackout period (${blackout.name})`,
          );
        }
      }

      const year = leaveYear(start);
      const enforce = leaveType.category !== LeaveTypeCategory.UNPAID;
      if (enforce) {
        const balance = await tx.leaveBalance.findUnique({
          where: {
            organisationId_workerId_leaveTypeId_year: {
              organisationId,
              workerId: worker.id,
              leaveTypeId: leaveType.id,
              year,
            },
          },
          select: { accrued: true, used: true },
        });
        const available = balance
          ? Number(balance.accrued) - Number(balance.used)
          : Number(leaveType.defaultBalance);
        if (days > available + EPSILON) {
          throw new ConflictException(
            `Insufficient ${leaveType.name} balance: ${days} requested, ${available} available`,
          );
        }
      }

      const managerUserId = worker.managerId
        ? ((
            await tx.worker.findFirst({
              where: { id: worker.managerId },
              select: { userId: true },
            })
          )?.userId ?? null)
        : null;
      const hrUserId = await this.orgApproverUserId(tx);
      const plan = buildApprovalPlan({
        managerUserId,
        hrUserId,
        requiresApproval: leaveType.requiresApproval,
        requireHrApproval: dto.requireHrApproval,
        escalateAfterMinutes:
          dto.escalateAfterMinutes ?? DEFAULT_ESCALATION_MINUTES,
      });

      const submit = dto.submit ?? true;
      const now = new Date();
      const autoApprove = submit && plan.length === 0;

      let request = await tx.leaveRequest.create({
        data: {
          organisationId,
          createdBy: userId,
          workerId: worker.id,
          leaveTypeId: leaveType.id,
          startDate: start,
          endDate: end,
          startHalfDay: dto.startHalfDay ?? false,
          endHalfDay: dto.endHalfDay ?? false,
          days: new Prisma.Decimal(days),
          reasonEncrypted: dto.reason ?? null,
          status: !submit
            ? LeaveStatus.DRAFT
            : autoApprove
              ? LeaveStatus.APPROVED
              : LeaveStatus.PENDING,
          submittedAt: submit ? now : null,
          decidedAt: autoApprove ? now : null,
          decidedById: autoApprove ? userId : null,
        },
      });

      if (plan.length > 0) {
        const workflow = await tx.approvalWorkflow.create({
          data: {
            organisationId,
            createdBy: userId,
            name: `Leave request — ${worker.firstName} ${worker.lastName}`.trim(),
            resourceType: 'leave_request',
            resourceId: request.id,
            currentStep: 0,
            status: ApprovalStatus.PENDING,
          },
        });
        await this.createSteps(tx, workflow.id, plan, now, submit);
        request = await tx.leaveRequest.update({
          where: { id: request.id },
          data: { approvalWorkflowId: workflow.id },
        });
      } else if (autoApprove) {
        await this.applyBalanceFor(tx, {
          organisationId,
          workerId: worker.id,
          leaveTypeId: leaveType.id,
          defaultBalance: Number(leaveType.defaultBalance),
          category: leaveType.category,
          year,
          days,
        });
      }

      await this.audit.record({
        action: AuditAction.LEAVE_REQUEST_CREATED,
        targetType: 'leave_requests',
        targetId: request.id,
        newValue: {
          workerId: worker.id,
          leaveTypeId: leaveType.id,
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          days,
          status: request.status,
        },
      });
      if (autoApprove) {
        await this.audit.record({
          action: AuditAction.LEAVE_REQUEST_APPROVED,
          targetType: 'leave_requests',
          targetId: request.id,
          newValue: { autoApproved: true },
        });
      }

      return this.loadSummary(tx, request.id);
    });
  }

  async submit(id: string): Promise<LeaveRequestSummary> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await this.findInScope(tx, id, 'create');
      if (existing.status !== LeaveStatus.DRAFT) {
        throw new ConflictException('Only draft requests can be submitted');
      }

      const now = new Date();
      const steps = existing.approvalWorkflow?.steps ?? [];
      if (steps.length === 0) {
        await this.applyBalanceFor(tx, {
          organisationId: existing.organisationId,
          workerId: existing.workerId,
          leaveTypeId: existing.leaveTypeId,
          defaultBalance: Number(existing.leaveType.defaultBalance),
          category: existing.leaveType.category,
          year: leaveYear(existing.startDate),
          days: Number(existing.days),
        });
        await tx.leaveRequest.update({
          where: { id },
          data: {
            status: LeaveStatus.APPROVED,
            submittedAt: now,
            decidedAt: now,
            decidedById: userId,
          },
        });
        await this.audit.record({
          action: AuditAction.LEAVE_REQUEST_APPROVED,
          targetType: 'leave_requests',
          targetId: id,
          newValue: { autoApproved: true },
        });
      } else {
        const first = steps[0]!;
        await tx.leaveRequest.update({
          where: { id },
          data: { status: LeaveStatus.PENDING, submittedAt: now },
        });
        await tx.approvalStep.update({
          where: { id: first.id },
          data: { dueAt: computeDueAt(now, first.escalateAfterMinutes) },
        });
      }

      return this.loadSummary(tx, id);
    });
  }

  async list(
    query: ListLeaveRequestsQueryDto,
  ): Promise<{ data: LeaveRequestSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    return this.prisma.withRequestContext(async (tx) => {
      const scope = await resolveReadScope(tx, 'leave', 'read');

      const where: Prisma.LeaveRequestWhereInput = {};
      if (query.status) where.status = query.status;
      if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
      if (query.workerId) where.workerId = query.workerId;
      if (query.mine && scope.caller) where.workerId = scope.caller.id;
      if (query.from) where.endDate = { gte: parseDateOnly(query.from) };
      if (query.to) where.startDate = { lte: parseDateOnly(query.to) };

      if (scopeWhereRestricts(scope.where)) {
        where.worker = scope.where;
      } else if (query.mine && !scope.caller) {
        where.workerId = '__ascenda_no_access__';
      }

      const [total, rows] = await Promise.all([
        tx.leaveRequest.count({ where }),
        tx.leaveRequest.findMany({
          where,
          include: REQUEST_INCLUDE,
          orderBy: [{ startDate: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map((r) => toSummary(r)),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  /**
   * Team leave calendar (PRD LVE-05). Returns the leave spans overlapping the
   * requested range (APPROVED + PENDING by default), scoped to the caller, plus
   * one bucket per day so the UI can render a head-count and the people away.
   */
  async calendar(query: LeaveCalendarQueryDto): Promise<LeaveCalendarView> {
    const from = parseDateOnly(query.from);
    const to = parseDateOnly(query.to);
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('to must be on or after from');
    }
    const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (spanDays > MAX_CALENDAR_DAYS) {
      throw new BadRequestException(
        `Calendar range too large (max ${MAX_CALENDAR_DAYS} days)`,
      );
    }

    return this.prisma.withRequestContext(async (tx) => {
      const scope = await resolveReadScope(tx, 'leave', 'read');

      const where: Prisma.LeaveRequestWhereInput = {
        status: query.status
          ? query.status
          : { in: [LeaveStatus.APPROVED, LeaveStatus.PENDING] },
        startDate: { lte: to },
        endDate: { gte: from },
      };
      if (query.leaveTypeId) where.leaveTypeId = query.leaveTypeId;
      if (query.workerId) where.workerId = query.workerId;

      const workerFilters: Prisma.WorkerWhereInput[] = [];
      if (scopeWhereRestricts(scope.where)) workerFilters.push(scope.where);
      if (query.locationId) workerFilters.push({ locationId: query.locationId });
      if (query.departmentId) {
        workerFilters.push({ departmentId: query.departmentId });
      }
      if (workerFilters.length === 1) where.worker = workerFilters[0]!;
      else if (workerFilters.length > 1) where.worker = { AND: workerFilters };

      const rows = await tx.leaveRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: [{ startDate: 'asc' }, { workerId: 'asc' }],
      });

      const entries: LeaveCalendarEntry[] = rows.map((row) => ({
        requestId: row.id,
        workerId: row.workerId,
        workerName: `${row.worker.firstName} ${row.worker.lastName}`.trim(),
        leaveTypeId: row.leaveTypeId,
        leaveTypeName: row.leaveType.name,
        startDate: isoDate(row.startDate),
        endDate: isoDate(row.endDate),
        startHalfDay: row.startHalfDay,
        endHalfDay: row.endHalfDay,
        days: Number(row.days),
        status: row.status as unknown as LeaveCalendarEntry['status'],
      }));

      const { schedule, holidays } = await this.loadScheduleAndHolidays(
        tx,
        null,
        from,
        to,
      );
      const buckets = buildCalendar(
        from,
        to,
        rows.map((row) => ({ start: row.startDate, end: row.endDate })),
        schedule,
        holidays,
      );
      const days: LeaveCalendarDay[] = buckets.map((bucket) => ({
        date: isoDate(bucket.date),
        isWorkingDay: bucket.isWorkingDay,
        onLeaveCount: bucket.onLeaveCount,
        requestIds: bucket.entryIndexes.map((i) => entries[i]!.requestId),
      }));

      return { from: isoDate(from), to: isoDate(to), entries, days };
    });
  }

  /**
   * Payroll inputs from leave (PRD LVE-06 / PAY-05): for each worker, the
   * working days in the pay period and the number of APPROVED unpaid-leave days
   * that fall inside it (spans clipped to the period). Org-scoped by RLS; it
   * deliberately does NOT apply the caller's read-scope filter, because it backs
   * a trusted payroll calculation.
   */
  async leaveForPayroll(params: {
    periodStart: Date;
    periodEnd: Date;
    workerIds: string[];
  }): Promise<Record<string, { workingDays: number; unpaidLeaveDays: number }>> {
    return this.prisma.withRequestContext(async (tx) => {
      const result: Record<
        string,
        { workingDays: number; unpaidLeaveDays: number }
      > = {};
      for (const id of params.workerIds) {
        result[id] = { workingDays: 0, unpaidLeaveDays: 0 };
      }
      if (params.workerIds.length === 0) return result;

      const [workers, requests] = await Promise.all([
        tx.worker.findMany({
          where: { id: { in: params.workerIds } },
          select: { id: true, locationId: true },
        }),
        tx.leaveRequest.findMany({
          where: {
            workerId: { in: params.workerIds },
            status: LeaveStatus.APPROVED,
            startDate: { lte: params.periodEnd },
            endDate: { gte: params.periodStart },
            leaveType: { category: LeaveTypeCategory.UNPAID },
          },
          select: {
            workerId: true,
            startDate: true,
            endDate: true,
            startHalfDay: true,
            endHalfDay: true,
          },
          orderBy: { startDate: 'asc' },
        }),
      ]);

      const byWorker = new Map<string, typeof requests>();
      for (const request of requests) {
        const list = byWorker.get(request.workerId) ?? [];
        list.push(request);
        byWorker.set(request.workerId, list);
      }

      for (const worker of workers) {
        const entry =
          result[worker.id] ??
          (result[worker.id] = { workingDays: 0, unpaidLeaveDays: 0 });
        const { schedule, holidays } = await this.loadScheduleAndHolidays(
          tx,
          worker.locationId,
          params.periodStart,
          params.periodEnd,
        );
        entry.workingDays = countLeaveDays({
          start: params.periodStart,
          end: params.periodEnd,
          schedule,
          holidays,
        });

        let unpaid = 0;
        for (const request of byWorker.get(worker.id) ?? []) {
          const clippedStart =
            request.startDate > params.periodStart
              ? request.startDate
              : params.periodStart;
          const clippedEnd =
            request.endDate < params.periodEnd
              ? request.endDate
              : params.periodEnd;
          if (clippedEnd < clippedStart) continue;
          const unclipped =
            clippedStart.getTime() === request.startDate.getTime() &&
            clippedEnd.getTime() === request.endDate.getTime();
          unpaid += countLeaveDays({
            start: clippedStart,
            end: clippedEnd,
            startHalfDay: unclipped ? request.startHalfDay : false,
            endHalfDay: unclipped ? request.endHalfDay : false,
            schedule,
            holidays,
          });
        }
        entry.unpaidLeaveDays = roundHalf(unpaid);
      }

      return result;
    });
  }

  async get(id: string): Promise<LeaveRequestSummary> {
    return this.prisma.withRequestContext(async (tx) => {
      const row = await this.findInScope(tx, id, 'read');
      if (row.status === LeaveStatus.PENDING) {
        await this.escalateOverdueTx(tx);
      }
      return this.loadSummary(tx, id);
    });
  }

  async decide(
    id: string,
    dto: DecideLeaveRequestDto,
  ): Promise<LeaveRequestSummary> {
    const { userId, role } = this.requireContext();

    return this.prisma.withRequestContext(async (tx) => {
      const request = await this.findInScope(tx, id, 'approve');
      if (request.status !== LeaveStatus.PENDING) {
        throw new ConflictException('This request is not awaiting approval');
      }

      const wf = request.approvalWorkflow;
      const steps = wf?.steps ?? [];
      const step =
        steps.find(
          (s) =>
            s.stepOrder === (wf?.currentStep ?? 0) &&
            s.status === ApprovalStatus.PENDING,
        ) ?? steps.find((s) => s.status === ApprovalStatus.PENDING);
      if (!wf || !step) {
        throw new ConflictException('No pending approval step for this request');
      }

      const orgApprover =
        getEffectiveScope(role, 'leave', 'approve') ===
        PermissionScope.ORGANISATION;
      if (!orgApprover && !canActOnStep(step, userId)) {
        throw new ForbiddenException('You are not the approver for this step');
      }

      const now = new Date();

      if (!dto.approve) {
        await tx.approvalStep.update({
          where: { id: step.id },
          data: {
            status: ApprovalStatus.REJECTED,
            actedAt: now,
            note: dto.note ?? null,
          },
        });
        await tx.approvalWorkflow.update({
          where: { id: wf.id },
          data: { status: ApprovalStatus.REJECTED },
        });
        await tx.leaveRequest.update({
          where: { id },
          data: {
            status: LeaveStatus.REJECTED,
            decidedAt: now,
            decidedById: userId,
          },
        });
        await this.audit.record({
          action: AuditAction.LEAVE_REQUEST_REJECTED,
          targetType: 'leave_requests',
          targetId: id,
          newValue: { step: step.stepOrder, approverId: userId, note: dto.note },
        });
        return this.loadSummary(tx, id);
      }

      await tx.approvalStep.update({
        where: { id: step.id },
        data: {
          status: ApprovalStatus.APPROVED,
          actedAt: now,
          note: dto.note ?? null,
        },
      });

      if (isFinalStep(step.stepOrder, steps.length)) {
        await tx.approvalWorkflow.update({
          where: { id: wf.id },
          data: { status: ApprovalStatus.APPROVED },
        });
        await this.applyBalanceFor(tx, {
          organisationId: request.organisationId,
          workerId: request.workerId,
          leaveTypeId: request.leaveTypeId,
          defaultBalance: Number(request.leaveType.defaultBalance),
          category: request.leaveType.category,
          year: leaveYear(request.startDate),
          days: Number(request.days),
        });
        await tx.leaveRequest.update({
          where: { id },
          data: {
            status: LeaveStatus.APPROVED,
            decidedAt: now,
            decidedById: userId,
          },
        });
        await this.audit.record({
          action: AuditAction.LEAVE_REQUEST_APPROVED,
          targetType: 'leave_requests',
          targetId: id,
          newValue: { step: step.stepOrder, approverId: userId, final: true },
        });
      } else {
        const next = steps[step.stepOrder + 1]!;
        await tx.approvalWorkflow.update({
          where: { id: wf.id },
          data: { currentStep: next.stepOrder },
        });
        await tx.approvalStep.update({
          where: { id: next.id },
          data: { dueAt: computeDueAt(now, next.escalateAfterMinutes) },
        });
      }

      return this.loadSummary(tx, id);
    });
  }

  async delegate(
    id: string,
    dto: DelegateLeaveRequestDto,
  ): Promise<LeaveRequestSummary> {
    const { userId } = this.requireContext();

    return this.prisma.withRequestContext(async (tx) => {
      const request = await this.findInScope(tx, id, 'approve');
      if (request.status !== LeaveStatus.PENDING) {
        throw new ConflictException('This request is not awaiting approval');
      }

      const wf = request.approvalWorkflow;
      const step = wf?.steps.find(
        (s) =>
          s.stepOrder === wf.currentStep && s.status === ApprovalStatus.PENDING,
      );
      if (!wf || !step) {
        throw new ConflictException('No pending approval step for this request');
      }
      if (!canActOnStep(step, userId)) {
        throw new ForbiddenException('You are not the approver for this step');
      }

      const delegate = await tx.membership.findFirst({
        where: { userId: dto.toUserId, isActive: true },
        select: { userId: true },
      });
      if (!delegate) {
        throw new BadRequestException('Delegate is not an active member');
      }

      await tx.approvalStep.update({
        where: { id: step.id },
        data: { delegatedToId: dto.toUserId },
      });
      await this.audit.record({
        action: AuditAction.LEAVE_REQUEST_DELEGATED,
        targetType: 'leave_requests',
        targetId: id,
        newValue: {
          step: step.stepOrder,
          fromUserId: userId,
          toUserId: dto.toUserId,
          note: dto.note,
        },
      });

      return this.loadSummary(tx, id);
    });
  }

  async cancel(id: string): Promise<LeaveRequestSummary> {
    const { userId, role } = this.requireContext();

    return this.prisma.withRequestContext(async (tx) => {
      const request = await this.findInScope(tx, id, 'read');
      if (
        request.status === LeaveStatus.REJECTED ||
        request.status === LeaveStatus.CANCELLED
      ) {
        throw new ConflictException('This request is already closed');
      }

      const callerWorker = await tx.worker.findFirst({
        where: { userId },
        select: { id: true },
      });
      const orgApprover =
        getEffectiveScope(role, 'leave', 'update') ===
          PermissionScope.ORGANISATION ||
        getEffectiveScope(role, 'leave', 'approve') ===
          PermissionScope.ORGANISATION;
      const isSelf = callerWorker?.id === request.workerId;
      if (!isSelf && !orgApprover) {
        throw new ForbiddenException('You cannot cancel this request');
      }

      const now = new Date();
      if (request.status === LeaveStatus.APPROVED) {
        await reverseApprovedLeave(
          tx,
          {
            organisationId: request.organisationId,
            workerId: request.workerId,
            leaveTypeId: request.leaveTypeId,
            year: leaveYear(request.startDate),
          },
          Number(request.leaveType.defaultBalance),
          Number(request.days),
        );
      }

      const wf = request.approvalWorkflow;
      if (wf) {
        await tx.approvalStep.updateMany({
          where: { approvalWorkflowId: wf.id, status: ApprovalStatus.PENDING },
          data: { status: ApprovalStatus.REJECTED, actedAt: new Date() },
        });
        await tx.approvalWorkflow.update({
          where: { id: wf.id },
          data: { status: ApprovalStatus.REJECTED },
        });
      }

      await tx.leaveRequest.update({
        where: { id },
        data: { status: LeaveStatus.CANCELLED, decidedAt: now, decidedById: userId },
      });
      await this.audit.record({
        action: AuditAction.LEAVE_REQUEST_CANCELLED,
        targetType: 'leave_requests',
        targetId: id,
        newValue: { previousStatus: request.status },
      });

      return this.loadSummary(tx, id);
    });
  }

  /** Sweep every overdue pending step and hand it to the escalation target. */
  async escalateOverdue(): Promise<{ escalated: number }> {
    return this.prisma.withRequestContext(async (tx) => ({
      escalated: await this.escalateOverdueTx(tx),
    }));
  }

  private async escalateOverdueTx(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const now = new Date();
    const workflows = await tx.approvalWorkflow.findMany({
      where: {
        status: ApprovalStatus.PENDING,
        resourceType: 'leave_request',
      },
      select: { id: true },
    });
    if (workflows.length === 0) return 0;

    const steps = await tx.approvalStep.findMany({
      where: {
        status: ApprovalStatus.PENDING,
        dueAt: { not: null, lt: now },
        approvalWorkflowId: { in: workflows.map((w) => w.id) },
      },
      select: {
        id: true,
        approverId: true,
        approvalWorkflowId: true,
      },
    });

    let escalated = 0;
    for (const step of steps) {
      const target = await this.resolveEscalationTarget(tx, step.approverId);
      if (!target || target === step.approverId) continue;

      await tx.approvalStep.update({
        where: { id: step.id },
        data: {
          status: ApprovalStatus.ESCALATED,
          escalatedAt: now,
          escalatedToId: target,
        },
      });
      await this.audit.record({
        action: AuditAction.LEAVE_REQUEST_ESCALATED,
        targetType: 'approval_steps',
        targetId: step.id,
        newValue: {
          approvalWorkflowId: step.approvalWorkflowId,
          fromUserId: step.approverId,
          escalatedToId: target,
        },
      });
      escalated += 1;
    }
    return escalated;
  }

  private async resolveEscalationTarget(
    tx: Prisma.TransactionClient,
    approverUserId: string,
  ): Promise<string | null> {
    const approver = await tx.worker.findFirst({
      where: { userId: approverUserId },
      select: { managerId: true },
    });
    if (approver?.managerId) {
      const manager = await tx.worker.findFirst({
        where: { id: approver.managerId },
        select: { userId: true },
      });
      if (manager?.userId && manager.userId !== approverUserId) {
        return manager.userId;
      }
    }
    return this.orgApproverUserId(tx, approverUserId);
  }

  private async orgApproverUserId(
    tx: Prisma.TransactionClient,
    excludeUserId?: string,
  ): Promise<string | null> {
    const membership = await tx.membership.findFirst({
      where: {
        isActive: true,
        role: { in: [SystemRole.HR_ADMINISTRATOR, SystemRole.OWNER] },
        ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      },
      orderBy: { role: 'asc' },
      select: { userId: true },
    });
    return membership?.userId ?? null;
  }

  private async createSteps(
    tx: Prisma.TransactionClient,
    workflowId: string,
    plan: ApprovalPlanStep[],
    from: Date,
    submitted: boolean,
  ): Promise<void> {
    await tx.approvalStep.createMany({
      data: plan.map((step, index) => ({
        approvalWorkflowId: workflowId,
        stepOrder: step.stepOrder,
        approverId: step.approverId,
        status: ApprovalStatus.PENDING,
        escalateAfterMinutes: step.escalateAfterMinutes,
        dueAt:
          submitted && index === 0
            ? computeDueAt(from, step.escalateAfterMinutes)
            : null,
      })),
    });
  }

  private async applyBalanceFor(
    tx: Prisma.TransactionClient,
    params: {
      organisationId: string;
      workerId: string;
      leaveTypeId: string;
      defaultBalance: number;
      category: LeaveTypeCategory;
      year: number;
      days: number;
    },
  ): Promise<void> {
    const allowNegative = params.category === LeaveTypeCategory.UNPAID;
    try {
      await applyApprovedLeave(
        tx,
        {
          organisationId: params.organisationId,
          workerId: params.workerId,
          leaveTypeId: params.leaveTypeId,
          year: params.year,
        },
        params.defaultBalance,
        params.days,
        allowNegative,
      );
    } catch (error) {
      if (error instanceof InsufficientLeaveBalanceError) {
        throw new ConflictException(
          'Insufficient leave balance for this request',
        );
      }
      throw error;
    }
  }

  private async loadScheduleAndHolidays(
    tx: Prisma.TransactionClient,
    locationId: string | null,
    start: Date,
    end: Date,
  ): Promise<{ schedule: WorkSchedule; holidays: HolidayLike[] }> {
    const org = await tx.organisation.findFirst({
      select: { workDays: true, workDayStart: true, workDayEnd: true },
    });
    let schedule: WorkSchedule = org
      ? {
          workDays: org.workDays,
          workDayStart: org.workDayStart,
          workDayEnd: org.workDayEnd,
        }
      : DEFAULT_WORK_SCHEDULE;

    if (locationId) {
      const location = await tx.location.findFirst({
        where: { id: locationId },
        select: { workDays: true, workDayStart: true, workDayEnd: true },
      });
      if (location) {
        schedule = {
          workDays: location.workDays.length
            ? location.workDays
            : schedule.workDays,
          workDayStart: location.workDayStart ?? schedule.workDayStart,
          workDayEnd: location.workDayEnd ?? schedule.workDayEnd,
        };
      }
    }

    const rangeStart = new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
    const rangeEnd = new Date(Date.UTC(end.getUTCFullYear(), 11, 31));
    const holidays = await tx.holiday.findMany({
      where: {
        AND: [
          {
            OR: [
              { date: { gte: rangeStart, lte: rangeEnd } },
              { isRecurring: true, date: { lte: rangeEnd } },
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

    return { schedule, holidays };
  }

  private async findInScope(
    tx: Prisma.TransactionClient,
    id: string,
    action: 'read' | 'create' | 'approve',
  ): Promise<RequestRow> {
    const scope = await resolveReadScope(tx, 'leave', action);
    const where: Prisma.LeaveRequestWhereInput = { id };
    if (scopeWhereRestricts(scope.where)) where.worker = scope.where;
    const row = await tx.leaveRequest.findFirst({
      where,
      include: REQUEST_INCLUDE,
    });
    if (!row) throw new NotFoundException('Leave request not found');
    return row;
  }

  private async loadSummary(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<LeaveRequestSummary> {
    const row = await tx.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: REQUEST_INCLUDE,
    });
    const names = await this.loadApproverNames(tx, row);
    return toSummary(row, names);
  }

  private async loadApproverNames(
    tx: Prisma.TransactionClient,
    row: RequestRow,
  ): Promise<ApproverNames> {
    const ids = new Set<string>();
    for (const step of row.approvalWorkflow?.steps ?? []) {
      ids.add(step.approverId);
      if (step.delegatedToId) ids.add(step.delegatedToId);
      if (step.escalatedToId) ids.add(step.escalatedToId);
    }
    if (ids.size === 0) return new Map();
    const users = await tx.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );
  }

  private requireContext(): {
    organisationId: string;
    userId: string;
    role: string | undefined;
  } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId, role: ctx.role };
  }
}
