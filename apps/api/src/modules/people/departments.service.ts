import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@ascenda/db';
import type { Department } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

function toDepartment(row: {
  id: string;
  organisationId: string;
  name: string;
  parentId: string | null;
  managerId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Department {
  return {
    id: row.id,
    organisationId: row.organisationId,
    name: row.name,
    parentId: row.parentId ?? undefined,
    managerId: row.managerId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Department[]> {
    return this.prisma.withRequestContext(async (tx) => {
      const rows = await tx.department.findMany({
        orderBy: { name: 'asc' },
      });
      return rows.map(toDepartment);
    });
  }

  async create(dto: CreateDepartmentDto): Promise<Department> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertParent(tx, dto.parentId);
      const row = await tx.department.create({
        data: {
          organisationId,
          createdBy: userId,
          name: dto.name,
          parentId: dto.parentId ?? null,
          managerId: dto.managerId ?? null,
        },
      });
      return toDepartment(row);
    });
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<Department> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.department.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Department not found');

      if (dto.parentId) {
        if (dto.parentId === id) {
          throw new ConflictException('A department cannot be its own parent');
        }
        await this.assertParent(tx, dto.parentId);
      }

      const row = await tx.department.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
          ...(dto.managerId !== undefined ? { managerId: dto.managerId } : {}),
        },
      });
      return toDepartment(row);
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.department.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Department not found');

      const [workerCount, childCount] = await Promise.all([
        tx.worker.count({ where: { departmentId: id } }),
        tx.department.count({ where: { parentId: id } }),
      ]);
      if (workerCount > 0 || childCount > 0) {
        throw new ConflictException(
          'This department still has workers or sub-departments assigned',
        );
      }

      await tx.department.delete({ where: { id } });
      return { id };
    });
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }

  private async assertParent(
    tx: Prisma.TransactionClient,
    parentId?: string | null,
  ): Promise<void> {
    if (!parentId) return;
    const found = await tx.department.findFirst({
      where: { id: parentId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Parent department not found');
  }
}
