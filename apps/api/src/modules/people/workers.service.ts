import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditAction, Prisma } from '@ascenda/db';
import { SystemRole, WorkerCategory } from '@ascenda/types';
import type {
  PaginationMeta,
  WorkerCategory as WorkerCategoryType,
  WorkerImportPreview,
  WorkerImportPreviewRow,
  WorkerImportResult,
  WorkerInviteResult,
  EmploymentType as EmploymentTypeType,
  WorkerStatus as WorkerStatusType,
  WorkerSummary,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { IdentityAccessService } from '../identity-access/identity-access.service';
import {
  resolveReadScope,
  scopeWhereRestricts,
} from '../../common/rbac/worker-scope';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { ListWorkersQueryDto } from './dto/list-workers.dto';
import {
  evaluateRow,
  mapCsvToRawWorkers,
  type ImportContext,
  type NormalizedWorker,
} from './worker-import';

/** Upper bound on rows accepted in a single import. */
const MAX_IMPORT_ROWS = 5000;

export const WORKER_INCLUDE = {
  department: { select: { name: true } },
  location: { select: { name: true } },
  workerIdentity: { select: { dateOfBirth: true, gender: true } },
} satisfies Prisma.WorkerInclude;

type WorkerRow = Prisma.WorkerGetPayload<{ include: typeof WORKER_INCLUDE }>;

export function toWorkerSummary(
  worker: WorkerRow,
  hasLogin = false,
): WorkerSummary {
  return {
    hasLogin,
    id: worker.id,
    organisationId: worker.organisationId,
    createdAt: worker.createdAt.toISOString(),
    updatedAt: worker.updatedAt.toISOString(),
    employeeNumber: worker.employeeNumber,
    firstName: worker.firstName,
    lastName: worker.lastName,
    preferredName: worker.preferredName ?? undefined,
    email: worker.email,
    phone: worker.phone ?? undefined,
    category: worker.category as unknown as WorkerCategoryType,
    employmentType: worker.employmentType as unknown as EmploymentTypeType,
    status: worker.status as unknown as WorkerStatusType,
    jobTitle: worker.jobTitle,
    departmentId: worker.departmentId ?? undefined,
    departmentName: worker.department?.name ?? undefined,
    locationId: worker.locationId ?? undefined,
    locationName: worker.location?.name ?? undefined,
    managerId: worker.managerId ?? undefined,
    startDate: worker.startDate.toISOString(),
    endDate: worker.endDate?.toISOString() ?? undefined,
    dateOfBirth: worker.workerIdentity?.dateOfBirth?.toISOString() ?? undefined,
    gender: worker.workerIdentity?.gender ?? undefined,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly identity: IdentityAccessService,
  ) {}

  async list(
    query: ListWorkersQueryDto,
  ): Promise<{ data: WorkerSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.WorkerWhereInput = {};
      if (query.status) where.status = query.status;
      if (query.category) where.category = query.category;
      if (query.departmentId) where.departmentId = query.departmentId;
      if (query.locationId) where.locationId = query.locationId;

      const scopeWhere = await this.resolveScopeWhere(tx);
      if (scopeWhereRestricts(scopeWhere)) where.AND = [scopeWhere];

      const search = query.search?.trim();
      if (search) {
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { employeeNumber: { contains: search, mode: 'insensitive' } },
          { jobTitle: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [total, rows] = await Promise.all([
        tx.worker.count({ where }),
        tx.worker.findMany({
          where,
          include: WORKER_INCLUDE,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      const accounts = await this.accountsFor(tx, rows);

      return {
        data: rows.map((row) => toWorkerSummary(row, accounts.has(row.userId ?? ''))),
        meta: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    });
  }

  async get(id: string): Promise<WorkerSummary> {
    return this.prisma.withRequestContext(async (tx) => {
      const scopeWhere = await this.resolveScopeWhere(tx);
      const worker = await tx.worker.findFirst({
        where: { AND: [{ id }, scopeWhere] },
        include: WORKER_INCLUDE,
      });
      if (!worker) throw new NotFoundException('Worker not found');
      const accounts = await this.accountsFor(tx, [worker]);
      return toWorkerSummary(worker, accounts.has(worker.userId ?? ''));
    });
  }

  async create(dto: CreateWorkerDto): Promise<WorkerSummary> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertReferences(tx, dto);

      const hasIdentity =
        dto.dateOfBirth != null || (dto.gender != null && dto.gender !== '');

      try {
        const worker = await tx.worker.create({
          data: {
            organisationId,
            createdBy: userId,
            employeeNumber: dto.employeeNumber,
            firstName: dto.firstName,
            lastName: dto.lastName,
            preferredName: dto.preferredName ?? null,
            email: dto.email,
            phone: dto.phone ?? null,
            category: dto.category,
            employmentType: dto.employmentType,
            ...(dto.status ? { status: dto.status } : {}),
            jobTitle: dto.jobTitle,
            departmentId: dto.departmentId ?? null,
            locationId: dto.locationId ?? null,
            managerId: dto.managerId ?? null,
            startDate: new Date(dto.startDate),
            endDate: dto.endDate ? new Date(dto.endDate) : null,
            ...(hasIdentity
              ? {
                  workerIdentity: {
                    create: {
                      organisationId,
                      createdBy: userId,
                      dateOfBirth: dto.dateOfBirth
                        ? new Date(dto.dateOfBirth)
                        : null,
                      gender: dto.gender ?? null,
                    },
                  },
                }
              : {}),
          },
          include: WORKER_INCLUDE,
        });
        return toWorkerSummary(worker);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            `Employee number "${dto.employeeNumber}" is already in use`,
          );
        }
        throw error;
      }
    });
  }

  async update(id: string, dto: UpdateWorkerDto): Promise<WorkerSummary> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.worker.findFirst({
        where: { id },
        select: { id: true, organisationId: true },
      });
      if (!existing) throw new NotFoundException('Worker not found');

      await this.assertReferences(tx, dto);

      const hasIdentityChange =
        dto.dateOfBirth !== undefined || dto.gender !== undefined;

      try {
        const worker = await tx.worker.update({
          where: { id },
          data: {
            ...(dto.employeeNumber !== undefined
              ? { employeeNumber: dto.employeeNumber }
              : {}),
            ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
            ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
            ...(dto.preferredName !== undefined
              ? { preferredName: dto.preferredName || null }
              : {}),
            ...(dto.email !== undefined ? { email: dto.email } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
            ...(dto.category !== undefined ? { category: dto.category } : {}),
            ...(dto.employmentType !== undefined
              ? { employmentType: dto.employmentType }
              : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
            ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle } : {}),
            ...(dto.departmentId !== undefined
              ? { departmentId: dto.departmentId }
              : {}),
            ...(dto.locationId !== undefined
              ? { locationId: dto.locationId }
              : {}),
            ...(dto.managerId !== undefined
              ? { managerId: dto.managerId }
              : {}),
            ...(dto.startDate !== undefined
              ? { startDate: new Date(dto.startDate) }
              : {}),
            ...(dto.endDate !== undefined
              ? { endDate: dto.endDate ? new Date(dto.endDate) : null }
              : {}),
            ...(hasIdentityChange
              ? {
                  workerIdentity: {
                    upsert: {
                      create: {
                        organisationId: existing.organisationId,
                        createdBy: userId,
                        dateOfBirth: dto.dateOfBirth
                          ? new Date(dto.dateOfBirth)
                          : null,
                        gender: dto.gender ?? null,
                      },
                      update: {
                        ...(dto.dateOfBirth !== undefined
                          ? {
                              dateOfBirth: dto.dateOfBirth
                                ? new Date(dto.dateOfBirth)
                                : null,
                            }
                          : {}),
                        ...(dto.gender !== undefined
                          ? { gender: dto.gender || null }
                          : {}),
                      },
                    },
                  },
                }
              : {}),
          },
          include: WORKER_INCLUDE,
        });
        const accounts = await this.accountsFor(tx, [worker]);
        return toWorkerSummary(worker, accounts.has(worker.userId ?? ''));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            `Employee number "${dto.employeeNumber}" is already in use`,
          );
        }
        throw error;
      }
    });
  }

  /**
   * Soft-delete: a worker's history is never destroyed. Marking them
   * TERMINATED keeps payroll, leave and audit records intact (and lets the
   * dashboard's active headcount drop them).
   */
  async terminate(id: string): Promise<WorkerSummary> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.worker.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Worker not found');
      const worker = await tx.worker.update({
        where: { id },
        data: { status: 'TERMINATED' },
        include: WORKER_INCLUDE,
      });
      const accounts = await this.accountsFor(tx, [worker]);
      return toWorkerSummary(worker, accounts.has(worker.userId ?? ''));
    });
  }

  /**
   * Send the worker a workspace login invitation (PRD PPL onboarding). Creates
   * (or reuses) a platform user + membership, issues a single-use invitation and
   * emails the set-password link. The worker is linked to the new account so
   * self-service (leave, attendance, documents) resolves to their profile.
   */
  async invite(id: string): Promise<WorkerInviteResult> {
    const { organisationId, userId } = this.requireContext();

    const worker = await this.prisma.withRequestContext((tx) =>
      tx.worker.findFirst({
        where: { id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          category: true,
        },
      }),
    );
    if (!worker) throw new NotFoundException('Worker not found');

    const role =
      worker.category === WorkerCategory.VOLUNTEER
        ? SystemRole.VOLUNTEER_SELF
        : SystemRole.EMPLOYEE_SELF;

    const result = await this.identity.inviteToWorkspace({
      organisationId,
      actorId: userId,
      email: worker.email,
      firstName: worker.preferredName?.trim() || worker.firstName,
      lastName: worker.lastName,
      role,
    });

    await this.prisma.withRequestContext((tx) =>
      tx.worker.update({
        where: { id: worker.id },
        data: { userId: result.userId },
      }),
    );

    return {
      workerId: worker.id,
      userId: result.userId,
      email: result.email,
      emailSent: result.emailSent,
    };
  }

  /** Validate a CSV without writing — powers the import preview. */
  async previewImport(csv: string): Promise<WorkerImportPreview> {
    const { rawRows, headerErrors } = this.parseImport(csv);

    return this.prisma.withRequestContext(async (tx) => {
      const ctx = await this.buildImportContext(tx);

      const rows: WorkerImportPreviewRow[] = rawRows.map((raw) => {
        const evaluated = evaluateRow(raw, ctx);
        const worker = evaluated.worker;
        const status = worker
          ? 'valid'
          : evaluated.duplicate
            ? 'duplicate'
            : 'error';
        return {
          rowNumber: raw.rowNumber,
          status,
          errors: evaluated.errors,
          employeeNumber: raw.values.employeeNumber || undefined,
          name:
            [raw.values.firstName, raw.values.lastName]
              .filter(Boolean)
              .join(' ') || undefined,
          email: raw.values.email || undefined,
          category: worker ? worker.category : raw.values.category || undefined,
          jobTitle: raw.values.jobTitle || undefined,
          department: worker
            ? worker.departmentName
            : raw.values.department || undefined,
          location: worker
            ? worker.locationName
            : raw.values.location || undefined,
          startDate: worker ? worker.startDate : undefined,
        } satisfies WorkerImportPreviewRow;
      });

      return {
        summary: {
          total: rows.length,
          valid: rows.filter((r) => r.status === 'valid').length,
          duplicate: rows.filter((r) => r.status === 'duplicate').length,
          error: rows.filter((r) => r.status === 'error').length,
        },
        rows,
      };
    });
  }

  /** Commit a CSV — creates only the rows that validate cleanly. */
  async commitImport(csv: string): Promise<WorkerImportResult> {
    const { organisationId, userId } = this.requireContext();
    const { rawRows } = this.parseImport(csv);

    return this.prisma.withRequestContext(async (tx) => {
      const ctx = await this.buildImportContext(tx);
      const workers: NormalizedWorker[] = [];
      for (const raw of rawRows) {
        const evaluated = evaluateRow(raw, ctx);
        if (evaluated.worker) workers.push(evaluated.worker);
      }

      const total = rawRows.length;
      if (workers.length === 0) {
        return { created: 0, skipped: total, total };
      }

      const workerRows = workers.map((w) => ({
        id: randomUUID(),
        organisationId,
        createdBy: userId,
        employeeNumber: w.employeeNumber,
        firstName: w.firstName,
        lastName: w.lastName,
        preferredName: w.preferredName ?? null,
        email: w.email,
        phone: w.phone ?? null,
        category: w.category,
        employmentType: w.employmentType,
        status: w.status,
        jobTitle: w.jobTitle,
        departmentId: w.departmentId ?? null,
        locationId: w.locationId ?? null,
        startDate: new Date(w.startDate),
        endDate: w.endDate ? new Date(w.endDate) : null,
      }));

      const result = await tx.worker.createMany({
        data: workerRows,
        skipDuplicates: true,
      });

      const identityRows = workers
        .map((w, index) =>
          w.dateOfBirth || w.gender
            ? {
                id: randomUUID(),
                organisationId,
                workerId: workerRows[index]!.id,
                createdBy: userId,
                dateOfBirth: w.dateOfBirth ? new Date(w.dateOfBirth) : null,
                gender: w.gender ?? null,
              }
            : null,
        )
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (identityRows.length > 0) {
        await tx.workerIdentity.createMany({ data: identityRows });
      }

      // Audit a summary only — never the raw CSV (which can be megabytes and
      // contain personal data). The interceptor skips /import routes for this.
      await this.audit.record({
        action: AuditAction.WORKER_CREATED,
        targetType: 'workers',
        newValue: {
          source: 'csv_import',
          total,
          created: result.count,
          skipped: total - result.count,
        },
      });

      return { created: result.count, skipped: total - result.count, total };
    });
  }

  private parseImport(csv: string): {
    rawRows: ReturnType<typeof mapCsvToRawWorkers>['rawRows'];
    headerErrors: string[];
  } {
    const { rawRows, headerErrors } = mapCsvToRawWorkers(csv);
    if (headerErrors.length > 0) throw new BadRequestException(headerErrors);
    if (rawRows.length === 0) {
      throw new BadRequestException('The file has no data rows.');
    }
    if (rawRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `Too many rows — the maximum is ${MAX_IMPORT_ROWS}.`,
      );
    }
    return { rawRows, headerErrors };
  }

  private async buildImportContext(
    tx: Prisma.TransactionClient,
  ): Promise<ImportContext> {
    const [departments, locations, existing] = await Promise.all([
      tx.department.findMany({ select: { id: true, name: true } }),
      tx.location.findMany({ select: { id: true, name: true } }),
      tx.worker.findMany({ select: { employeeNumber: true } }),
    ]);
    return {
      departmentByName: new Map(
        departments.map((d) => [d.name.trim().toLowerCase(), d.id]),
      ),
      locationByName: new Map(
        locations.map((l) => [l.name.trim().toLowerCase(), l.id]),
      ),
      existingEmployeeNumbers: new Set(
        existing.map((w) => w.employeeNumber.trim().toLowerCase()),
      ),
      seenEmployeeNumbers: new Set<string>(),
    };
  }

  /**
   * Resolve the read scope for the acting user and translate it into a Prisma
   * `where` fragment. ORGANISATION callers see everything in the tenant; a
   * MANAGER (TEAM) sees only themselves and their direct reports.
   */
  private async resolveScopeWhere(
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.WorkerWhereInput> {
    const { where } = await resolveReadScope(tx, 'workers', 'read');
    return where;
  }

  /**
   * Which of these workers already have a platform user account. Users are
   * global (not tenant-scoped), so this is a plain id lookup.
   */
  private async accountsFor(
    tx: Prisma.TransactionClient,
    workers: { userId: string | null }[],
  ): Promise<Set<string>> {
    const ids = workers
      .map((w) => w.userId)
      .filter((id): id is string => !!id);
    if (ids.length === 0) return new Set();
    const users = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(users.map((u) => u.id));
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }

  /** Verify referenced department/location/manager exist in the same org. */
  private async assertReferences(
    tx: Prisma.TransactionClient,
    dto: { departmentId?: string | null; locationId?: string | null; managerId?: string | null },
  ): Promise<void> {
    if (dto.departmentId) {
      const found = await tx.department.findFirst({
        where: { id: dto.departmentId },
        select: { id: true },
      });
      if (!found) throw new NotFoundException('Department not found');
    }
    if (dto.locationId) {
      const found = await tx.location.findFirst({
        where: { id: dto.locationId },
        select: { id: true },
      });
      if (!found) throw new NotFoundException('Location not found');
    }
    if (dto.managerId) {
      const found = await tx.worker.findFirst({
        where: { id: dto.managerId },
        select: { id: true },
      });
      if (!found) throw new NotFoundException('Manager not found');
    }
  }
}
