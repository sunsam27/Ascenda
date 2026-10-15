import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@ascenda/db';
import type {
  PaginationMeta,
  WorkerCategory as WorkerCategoryType,
  EmploymentType as EmploymentTypeType,
  WorkerStatus as WorkerStatusType,
  WorkerSummary,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { CreateWorkerDto } from './dto/create-worker.dto';
import { UpdateWorkerDto } from './dto/update-worker.dto';
import { ListWorkersQueryDto } from './dto/list-workers.dto';

export const WORKER_INCLUDE = {
  department: { select: { name: true } },
  location: { select: { name: true } },
  workerIdentity: { select: { dateOfBirth: true, gender: true } },
} satisfies Prisma.WorkerInclude;

type WorkerRow = Prisma.WorkerGetPayload<{ include: typeof WORKER_INCLUDE }>;

export function toWorkerSummary(worker: WorkerRow): WorkerSummary {
  return {
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
  constructor(private readonly prisma: PrismaService) {}

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

      return {
        data: rows.map(toWorkerSummary),
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
      const worker = await tx.worker.findFirst({
        where: { id },
        include: WORKER_INCLUDE,
      });
      if (!worker) throw new NotFoundException('Worker not found');
      return toWorkerSummary(worker);
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
      return toWorkerSummary(worker);
    });
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
