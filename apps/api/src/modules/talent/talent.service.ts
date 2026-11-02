import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AuditAction,
  ChecklistTaskStatus,
  OffboardingStatus,
  OnboardingStatus,
  Prisma,
} from '@ascenda/db';
import type {
  ChecklistTaskSummary,
  OffboardingCaseSummary,
  OnboardingChecklistSummary,
  PaginationMeta,
  ChecklistTaskStatus as ChecklistTaskStatusType,
  OffboardingStatus as OffboardingStatusType,
  OffboardingTaskType as OffboardingTaskTypeType,
  OnboardingStatus as OnboardingStatusType,
  OnboardingTaskType as OnboardingTaskTypeType,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { ListOnboardingQueryDto } from './dto/list-onboarding.dto';
import { ListOffboardingQueryDto } from './dto/list-offboarding.dto';
import { StartOffboardingDto } from './dto/start-offboarding.dto';
import { UpdateChecklistTaskDto } from './dto/update-checklist-task.dto';
import {
  createOnboardingForWorkers,
} from './domain/onboarding-defaults';
import { buildOffboardingTasks } from './domain/offboarding-defaults';
import {
  isChecklistComplete,
  summariseChecklist,
  workerStatusForExit,
} from './domain/checklist';

const WORKER_LIFECYCLE_SELECT = {
  firstName: true,
  lastName: true,
  preferredName: true,
  employeeNumber: true,
  jobTitle: true,
  startDate: true,
  department: { select: { name: true } },
} satisfies Prisma.WorkerSelect;

const ONBOARDING_INCLUDE = {
  worker: { select: WORKER_LIFECYCLE_SELECT },
  tasks: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.OnboardingChecklistInclude;

const OFFBOARDING_INCLUDE = {
  worker: { select: WORKER_LIFECYCLE_SELECT },
  tasks: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.OffboardingCaseInclude;

type OnboardingRow = Prisma.OnboardingChecklistGetPayload<{
  include: typeof ONBOARDING_INCLUDE;
}>;
type OffboardingRow = Prisma.OffboardingCaseGetPayload<{
  include: typeof OFFBOARDING_INCLUDE;
}>;

interface ChecklistTaskRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  isRequired: boolean;
  status: string;
  sortOrder: number;
  dueDate: Date | null;
  completedAt: Date | null;
  completedBy: string | null;
}

function workerName(worker: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return (
    worker.preferredName?.trim() ||
    `${worker.firstName} ${worker.lastName}`.trim()
  );
}

function toTaskSummary(task: ChecklistTaskRow): ChecklistTaskSummary {
  return {
    id: task.id,
    type: task.type as OnboardingTaskTypeType | OffboardingTaskTypeType,
    title: task.title,
    description: task.description ?? undefined,
    isRequired: task.isRequired,
    status: task.status as ChecklistTaskStatusType,
    sortOrder: task.sortOrder,
    dueDate: task.dueDate?.toISOString() ?? undefined,
    completedAt: task.completedAt?.toISOString() ?? undefined,
    completedBy: task.completedBy ?? undefined,
  };
}

function toOnboardingSummary(row: OnboardingRow): OnboardingChecklistSummary {
  const progress = summariseChecklist(row.tasks);
  return {
    id: row.id,
    organisationId: row.organisationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    workerId: row.workerId,
    workerName: workerName(row.worker),
    employeeNumber: row.worker.employeeNumber,
    jobTitle: row.worker.jobTitle,
    startDate: row.worker.startDate.toISOString(),
    status: row.status as unknown as OnboardingStatusType,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? undefined,
    ...progress,
    tasks: row.tasks.map(toTaskSummary),
  };
}

function toOffboardingSummary(row: OffboardingRow): OffboardingCaseSummary {
  const progress = summariseChecklist(row.tasks);
  return {
    id: row.id,
    organisationId: row.organisationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    workerId: row.workerId,
    workerName: workerName(row.worker),
    employeeNumber: row.worker.employeeNumber,
    jobTitle: row.worker.jobTitle,
    departmentName: row.worker.department?.name ?? undefined,
    exitReason: row.exitReason as OffboardingCaseSummary['exitReason'],
    reasonDetail: row.reasonDetail ?? undefined,
    lastWorkingDate: row.lastWorkingDate.toISOString(),
    noticeDate: row.noticeDate?.toISOString() ?? undefined,
    status: row.status as unknown as OffboardingStatusType,
    completedAt: row.completedAt?.toISOString() ?? undefined,
    ...progress,
    tasks: row.tasks.map(toTaskSummary),
  };
}

@Injectable()
export class TalentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listOnboarding(
    query: ListOnboardingQueryDto,
  ): Promise<{ data: OnboardingChecklistSummary[]; meta: PaginationMeta }> {
    const { organisationId, userId } = this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    let created = 0;

    const result = await this.prisma.withRequestContext(async (tx) => {
      // ONB-02: workers that pre-date the checklist feature have no record yet.
      // Backfill them here so the Onboarding tab lists every worker, not just
      // those created or imported since the feature shipped.
      const workers = await tx.worker.findMany({
        where: {
          organisationId,
          onboardingChecklist: { is: null },
          status: { notIn: ['TERMINATED', 'RESIGNED'] },
        },
        select: { id: true },
      });
      created = await createOnboardingForWorkers(
        tx,
        organisationId,
        workers.map((worker) => worker.id),
        userId,
      );

      const where: Prisma.OnboardingChecklistWhereInput = {};
      if (query.status) {
        where.status = query.status as unknown as OnboardingStatus;
      }

      const search = query.search?.trim();
      if (search) {
        where.worker = {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { preferredName: { contains: search, mode: 'insensitive' } },
            { employeeNumber: { contains: search, mode: 'insensitive' } },
          ],
        };
      }

      const [total, rows] = await Promise.all([
        tx.onboardingChecklist.count({ where }),
        tx.onboardingChecklist.findMany({
          where,
          include: ONBOARDING_INCLUDE,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map(toOnboardingSummary),
        meta: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    });

    if (created > 0) {
      await this.audit.record({
        action: AuditAction.ONBOARDING_CHECKLIST_CREATED,
        targetType: 'onboarding',
        newValue: { source: 'lazy_backfill', created },
      });
    }

    return result;
  }

  /**
   * Get a worker's checklist, lazily creating it for workers that pre-date
   * ONB-02 so the UI can backfill without a migration.
   */
  async getOnboarding(workerId: string): Promise<OnboardingChecklistSummary> {
    const { organisationId, userId } = this.requireContext();
    let created = 0;

    const summary = await this.prisma.withRequestContext(async (tx) => {
      const worker = await tx.worker.findFirst({
        where: { id: workerId },
        select: { id: true },
      });
      if (!worker) throw new NotFoundException('Worker not found');

      created = await createOnboardingForWorkers(
        tx,
        organisationId,
        [workerId],
        userId,
      );

      const row = await tx.onboardingChecklist.findUnique({
        where: { workerId },
        include: ONBOARDING_INCLUDE,
      });
      if (!row) throw new NotFoundException('Onboarding checklist not found');
      return toOnboardingSummary(row);
    });

    if (created > 0) {
      await this.audit.record({
        action: AuditAction.ONBOARDING_CHECKLIST_CREATED,
        targetType: 'onboarding',
        targetId: summary.id,
        newValue: { workerId, source: 'lazy_backfill' },
      });
    }

    return summary;
  }

  async updateOnboardingTask(
    taskId: string,
    dto: UpdateChecklistTaskDto,
  ): Promise<OnboardingChecklistSummary> {
    const { userId } = this.requireContext();

    const result = await this.prisma.withRequestContext(async (tx) => {
      const task = await tx.onboardingTask.findFirst({
        where: { id: taskId },
        select: {
          id: true,
          type: true,
          checklistId: true,
          checklist: { select: { workerId: true } },
        },
      });
      if (!task) throw new NotFoundException('Onboarding task not found');

      const completed = dto.status === ChecklistTaskStatus.COMPLETED;
      await tx.onboardingTask.update({
        where: { id: taskId },
        data: {
          status: dto.status as unknown as ChecklistTaskStatus,
          completedAt: completed ? new Date() : null,
          completedBy: completed ? userId : null,
        },
      });

      await this.syncOnboardingStatus(tx, task.checklistId);

      const row = await tx.onboardingChecklist.findUnique({
        where: { id: task.checklistId },
        include: ONBOARDING_INCLUDE,
      });
      if (!row) throw new NotFoundException('Onboarding checklist not found');

      return {
        summary: toOnboardingSummary(row),
        workerId: task.checklist.workerId,
        type: task.type,
      };
    });

    await this.audit.record({
      action: AuditAction.ONBOARDING_TASK_UPDATED,
      targetType: 'onboarding',
      targetId: result.summary.id,
      newValue: {
        workerId: result.workerId,
        taskType: result.type,
        status: dto.status,
      },
    });

    return result.summary;
  }

  async listOffboarding(
    query: ListOffboardingQueryDto,
  ): Promise<{ data: OffboardingCaseSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.OffboardingCaseWhereInput = {};
      if (query.status) {
        where.status = query.status as unknown as OffboardingStatus;
      }

      const search = query.search?.trim();
      if (search) {
        where.worker = {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { preferredName: { contains: search, mode: 'insensitive' } },
            { employeeNumber: { contains: search, mode: 'insensitive' } },
          ],
        };
      }

      const [total, rows] = await Promise.all([
        tx.offboardingCase.count({ where }),
        tx.offboardingCase.findMany({
          where,
          include: OFFBOARDING_INCLUDE,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map(toOffboardingSummary),
        meta: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    });
  }

  async getOffboarding(id: string): Promise<OffboardingCaseSummary> {
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.offboardingCase.findFirst({
        where: { id },
        include: OFFBOARDING_INCLUDE,
      });
      if (!row) throw new NotFoundException('Offboarding case not found');
      return toOffboardingSummary(row);
    });
  }

  async startOffboarding(
    dto: StartOffboardingDto,
  ): Promise<OffboardingCaseSummary> {
    const { organisationId, userId } = this.requireContext();

    const summary = await this.prisma.withRequestContext(async (tx) => {
      const worker = await tx.worker.findFirst({
        where: { id: dto.workerId },
        select: { id: true, startDate: true, status: true },
      });
      if (!worker) throw new NotFoundException('Worker not found');
      if (worker.status === 'RESIGNED' || worker.status === 'TERMINATED') {
        throw new ConflictException('Worker has already left the organisation');
      }

      const activeCase = await tx.offboardingCase.findFirst({
        where: {
          workerId: dto.workerId,
          status: OffboardingStatus.IN_PROGRESS,
        },
        select: { id: true },
      });
      if (activeCase) {
        throw new ConflictException(
          'An offboarding case is already in progress for this worker',
        );
      }

      const lastWorkingDate = new Date(dto.lastWorkingDate);
      if (lastWorkingDate.getTime() < worker.startDate.getTime()) {
        throw new BadRequestException(
          'The last working date cannot be before the worker start date',
        );
      }
      const noticeDate = dto.noticeDate ? new Date(dto.noticeDate) : null;
      if (noticeDate && noticeDate.getTime() > lastWorkingDate.getTime()) {
        throw new BadRequestException(
          'The notice date cannot be after the last working date',
        );
      }

      const caseId = randomUUID();
      await tx.offboardingCase.create({
        data: {
          id: caseId,
          organisationId,
          workerId: dto.workerId,
          exitReason: dto.exitReason as unknown as Prisma.OffboardingCaseCreateInput['exitReason'],
          reasonDetail: dto.reasonDetail?.trim() || null,
          lastWorkingDate,
          noticeDate,
          createdBy: userId,
        },
      });

      await tx.offboardingTask.createMany({
        data: buildOffboardingTasks(organisationId, caseId),
      });

      const row = await tx.offboardingCase.findUnique({
        where: { id: caseId },
        include: OFFBOARDING_INCLUDE,
      });
      if (!row) throw new NotFoundException('Offboarding case not found');
      return toOffboardingSummary(row);
    });

    await this.audit.record({
      action: AuditAction.OFFBOARDING_STARTED,
      targetType: 'offboarding',
      targetId: summary.id,
      newValue: {
        workerId: summary.workerId,
        exitReason: summary.exitReason,
        lastWorkingDate: summary.lastWorkingDate,
      },
    });

    return summary;
  }

  async updateOffboardingTask(
    taskId: string,
    dto: UpdateChecklistTaskDto,
  ): Promise<OffboardingCaseSummary> {
    const { userId } = this.requireContext();

    const result = await this.prisma.withRequestContext(async (tx) => {
      const task = await tx.offboardingTask.findFirst({
        where: { id: taskId },
        select: {
          id: true,
          type: true,
          offboardingCaseId: true,
          offboardingCase: { select: { status: true } },
        },
      });
      if (!task) throw new NotFoundException('Offboarding task not found');
      if (task.offboardingCase.status !== OffboardingStatus.IN_PROGRESS) {
        throw new BadRequestException(
          'Only in-progress offboarding cases can be changed',
        );
      }

      const completed = dto.status === ChecklistTaskStatus.COMPLETED;
      await tx.offboardingTask.update({
        where: { id: taskId },
        data: {
          status: dto.status as unknown as ChecklistTaskStatus,
          completedAt: completed ? new Date() : null,
          completedBy: completed ? userId : null,
        },
      });

      const row = await tx.offboardingCase.findUnique({
        where: { id: task.offboardingCaseId },
        include: OFFBOARDING_INCLUDE,
      });
      if (!row) throw new NotFoundException('Offboarding case not found');

      return { summary: toOffboardingSummary(row), type: task.type };
    });

    await this.audit.record({
      action: AuditAction.OFFBOARDING_TASK_UPDATED,
      targetType: 'offboarding',
      targetId: result.summary.id,
      newValue: {
        workerId: result.summary.workerId,
        taskType: result.type,
        status: dto.status,
      },
    });

    return result.summary;
  }

  async completeOffboarding(id: string): Promise<OffboardingCaseSummary> {
    const summary = await this.prisma.withRequestContext(async (tx) => {
      const row = await tx.offboardingCase.findFirst({
        where: { id },
        include: OFFBOARDING_INCLUDE,
      });
      if (!row) throw new NotFoundException('Offboarding case not found');
      if (row.status !== OffboardingStatus.IN_PROGRESS) {
        throw new BadRequestException(
          'Only in-progress offboarding cases can be completed',
        );
      }

      const outstanding = row.tasks
        .filter(
          (task) =>
            task.isRequired &&
            task.status !== ChecklistTaskStatus.COMPLETED &&
            task.status !== ChecklistTaskStatus.WAIVED,
        )
        .map((task) => task.title);
      if (outstanding.length > 0) {
        throw new BadRequestException(
          `Complete or waive these tasks first: ${outstanding.join(', ')}`,
        );
      }

      const workerStatus = workerStatusForExit(row.exitReason);
      const completedAt = new Date();

      await tx.offboardingCase.update({
        where: { id },
        data: { status: OffboardingStatus.COMPLETED, completedAt },
      });
      await tx.worker.update({
        where: { id: row.workerId },
        data: {
          status: workerStatus,
          endDate: row.lastWorkingDate,
        },
      });

      const updated = await tx.offboardingCase.findUnique({
        where: { id },
        include: OFFBOARDING_INCLUDE,
      });
      if (!updated) throw new NotFoundException('Offboarding case not found');
      return toOffboardingSummary(updated);
    });

    await this.audit.record({
      action: AuditAction.OFFBOARDING_COMPLETED,
      targetType: 'offboarding',
      targetId: summary.id,
      newValue: {
        workerId: summary.workerId,
        exitReason: summary.exitReason,
        lastWorkingDate: summary.lastWorkingDate,
      },
    });

    return summary;
  }

  async cancelOffboarding(id: string): Promise<OffboardingCaseSummary> {
    const summary = await this.prisma.withRequestContext(async (tx) => {
      const row = await tx.offboardingCase.findFirst({
        where: { id },
        select: { id: true, status: true },
      });
      if (!row) throw new NotFoundException('Offboarding case not found');
      if (row.status !== OffboardingStatus.IN_PROGRESS) {
        throw new BadRequestException(
          'Only in-progress offboarding cases can be cancelled',
        );
      }

      const updated = await tx.offboardingCase.update({
        where: { id },
        data: { status: OffboardingStatus.CANCELLED },
        include: OFFBOARDING_INCLUDE,
      });
      return toOffboardingSummary(updated);
    });

    await this.audit.record({
      action: AuditAction.OFFBOARDING_CANCELLED,
      targetType: 'offboarding',
      targetId: summary.id,
      newValue: { workerId: summary.workerId },
    });

    return summary;
  }

  private async syncOnboardingStatus(
    tx: Prisma.TransactionClient,
    checklistId: string,
  ): Promise<void> {
    const [tasks, checklist] = await Promise.all([
      tx.onboardingTask.findMany({
        where: { checklistId },
        select: { status: true, isRequired: true },
      }),
      tx.onboardingChecklist.findUnique({
        where: { id: checklistId },
        select: { completedAt: true },
      }),
    ]);
    if (!checklist) return;

    const complete = isChecklistComplete(tasks);
    if (complete && !checklist.completedAt) {
      await tx.onboardingChecklist.update({
        where: { id: checklistId },
        data: { status: OnboardingStatus.COMPLETED, completedAt: new Date() },
      });
    } else if (!complete && checklist.completedAt) {
      await tx.onboardingChecklist.update({
        where: { id: checklistId },
        data: { status: OnboardingStatus.IN_PROGRESS, completedAt: null },
      });
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
