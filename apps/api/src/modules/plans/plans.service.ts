import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Plan } from '@ascenda/db';
import { BillingPeriod, type PlanSummary } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

function toFeatures(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return [];
}

export function toPlanSummary(plan: Plan): PlanSummary {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceMinorUnits: plan.priceMinorUnits,
    currency: plan.currency,
    billingPeriod: plan.billingPeriod as BillingPeriod,
    minHeadcount: plan.minHeadcount,
    maxHeadcount: plan.maxHeadcount,
    maxSeats: plan.maxSeats,
    features: toFeatures(plan.features),
    isFree: plan.isFree,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
  };
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public: active plans, cheapest/ordered by sortOrder. */
  async listPublic(): Promise<PlanSummary[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceMinorUnits: 'asc' }],
    });
    return plans.map(toPlanSummary);
  }

  /** Platform admin: every plan, including archived. */
  async listAll(): Promise<PlanSummary[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { priceMinorUnits: 'asc' }],
    });
    return plans.map(toPlanSummary);
  }

  async findByCode(code: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { code } });
  }

  async create(dto: CreatePlanDto): Promise<PlanSummary> {
    const existing = await this.prisma.plan.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`A plan with code "${dto.code}" already exists`);
    }

    const plan = await this.prisma.plan.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        priceMinorUnits: dto.priceMinorUnits,
        currency: dto.currency ?? 'NGN',
        billingPeriod: dto.billingPeriod ?? BillingPeriod.ANNUALLY,
        minHeadcount: dto.minHeadcount ?? null,
        maxHeadcount: dto.maxHeadcount ?? null,
        maxSeats: dto.maxSeats ?? null,
        features: dto.features ?? [],
        isFree: dto.priceMinorUnits === 0,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return toPlanSummary(plan);
  }

  async update(id: string, dto: UpdatePlanDto): Promise<PlanSummary> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Plan not found');
    }

    await this.assertFreePlanRemains(existing, dto);

    const plan = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.priceMinorUnits !== undefined
          ? {
              priceMinorUnits: dto.priceMinorUnits,
              isFree: dto.priceMinorUnits === 0,
            }
          : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.billingPeriod !== undefined
          ? { billingPeriod: dto.billingPeriod }
          : {}),
        ...(dto.minHeadcount !== undefined
          ? { minHeadcount: dto.minHeadcount }
          : {}),
        ...(dto.maxHeadcount !== undefined
          ? { maxHeadcount: dto.maxHeadcount }
          : {}),
        ...(dto.maxSeats !== undefined ? { maxSeats: dto.maxSeats } : {}),
        ...(dto.features !== undefined ? { features: dto.features } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    return toPlanSummary(plan);
  }

  /** Archive a plan (soft-delete) so existing subscribers keep it. */
  async archive(id: string): Promise<PlanSummary> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Plan not found');
    }
    await this.assertFreePlanRemains(existing, { isActive: false });
    const plan = await this.prisma.plan.update({
      where: { id },
      data: { isActive: false },
    });
    return toPlanSummary(plan);
  }

  /**
   * Refuse to leave the platform without an active free plan — the signup
   * flow depends on a free tier to onboard cost-free.
   */
  private async assertFreePlanRemains(
    plan: Plan,
    dto: UpdatePlanDto,
  ): Promise<void> {
    const deactivating = plan.isFree && dto.isActive === false;
    const repricing = plan.isFree && dto.priceMinorUnits !== undefined;
    const removingFree = repricing && dto.priceMinorUnits! > 0;
    if (!deactivating && !removingFree) return;

    const otherFree = await this.prisma.plan.count({
      where: { isActive: true, isFree: true, id: { not: plan.id } },
    });
    if (otherFree === 0) {
      throw new ConflictException(
        'Cannot remove the only active free plan — signups require a free tier',
      );
    }
  }
}
