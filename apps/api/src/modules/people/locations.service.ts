import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Location } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

function toLocation(row: {
  id: string;
  organisationId: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Location {
  return {
    id: row.id,
    organisationId: row.organisationId,
    name: row.name,
    address: row.address ?? undefined,
    city: row.city ?? undefined,
    country: row.country ?? undefined,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Location[]> {
    return this.prisma.withRequestContext(async (tx) => {
      const rows = await tx.location.findMany({ orderBy: { name: 'asc' } });
      return rows.map(toLocation);
    });
  }

  async create(dto: CreateLocationDto): Promise<Location> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.location.create({
        data: {
          organisationId,
          createdBy: userId,
          name: dto.name,
          address: dto.address ?? null,
          city: dto.city ?? null,
          country: dto.country ?? null,
          isActive: dto.isActive ?? true,
        },
      });
      return toLocation(row);
    });
  }

  async update(id: string, dto: UpdateLocationDto): Promise<Location> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.location.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Location not found');

      const row = await tx.location.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.address !== undefined ? { address: dto.address || null } : {}),
          ...(dto.city !== undefined ? { city: dto.city || null } : {}),
          ...(dto.country !== undefined ? { country: dto.country || null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return toLocation(row);
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.location.findFirst({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Location not found');

      const workerCount = await tx.worker.count({ where: { locationId: id } });
      if (workerCount > 0) {
        throw new ConflictException(
          'This location still has workers assigned',
        );
      }

      await tx.location.delete({ where: { id } });
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
}
