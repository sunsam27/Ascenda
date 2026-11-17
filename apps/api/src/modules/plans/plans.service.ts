import {
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type Plan } from '@ascenda/db';
import { BillingPeriod, type PlanSummary } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { getRequestContext } from '../../common/context/request-context';
import { PlanNotificationStore } from './plan-notification.store';
import { priceNotice } from './plan-price.domain';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notices: PlanNotificationStore,
  ) {}

  private actor(): string {
    const id = getRequestContext()?.userId;
    if (!id) throw new ForbiddenException('Platform administrator session required');
    return id;
  }

  private async mutate<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.withRequestContext(async (tx) => {
        // Serialize infrequent catalogue mutations, including the last-free-plan check.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(144113,1)`;
        return fn(tx);
      });
    } catch (error) {
      const e = error as { code?: string; meta?: { code?: string } };
      if (
        ['P2021', 'P2022'].includes(e.code ?? '') ||
        ['42P01', '42883', '42703'].includes(e.meta?.code ?? '')
      ) {
        throw new ServiceUnavailableException(
          'Admin notification storage requires migration 04 before catalogue changes can be saved',
        );
      }
      throw error;
    }
  }

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
    const actorId = this.actor();
    return this.mutate(async (tx) => {
      const existing = await tx.plan.findUnique({
        where: { code: dto.code },
      });
      if (existing) {
        throw new ConflictException(`A plan with code "${dto.code}" already exists`);
      }

      const plan = await tx.plan.create({
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
      await this.notices.append(tx, {
        actorId,
        planId: plan.id,
        action: 'PLAN_CREATED',
        details: { planName: plan.name, after: toPlanSummary(plan) },
      });
      return toPlanSummary(plan);
    });
  }

  async update(
    id: string,
    dto: UpdatePlanDto,
  ): Promise<
    PlanSummary & { priceChangeNotification?: { id: string; organisationCount: number } }
  > {
    const actorId = this.actor();
    return this.mutate(async (tx) => {
      const existing = await tx.plan.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Plan not found');
      }

      await this.assertFreePlanRemains(existing, dto, tx);
      const notice = priceNotice(existing, dto);
      const audience = notice
        ? (await this.notices.audience(tx, id)).map((row) => row.organisationId)
        : [];

      const plan = await tx.plan.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.priceMinorUnits !== undefined
            ? {
                priceMinorUnits: dto.priceMinorUnits,
                isFree: dto.priceMinorUnits === 0,
              }
            : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          ...(dto.billingPeriod !== undefined ? { billingPeriod: dto.billingPeriod } : {}),
          ...(dto.minHeadcount !== undefined ? { minHeadcount: dto.minHeadcount } : {}),
          ...(dto.maxHeadcount !== undefined ? { maxHeadcount: dto.maxHeadcount } : {}),
          ...(dto.maxSeats !== undefined ? { maxSeats: dto.maxSeats } : {}),
          ...(dto.features !== undefined ? { features: dto.features } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      const event = await this.notices.append(tx, {
        actorId,
        planId: id,
        action: 'PLAN_UPDATED',
        details: {
          planName: plan.name,
          fields: Object.keys(dto),
          priceChanged: !!notice,
          before: toPlanSummary(existing),
          after: toPlanSummary(plan),
        },
        notice,
        audience,
      });
      return { ...toPlanSummary(plan), ...(notice ? { priceChangeNotification: event } : {}) };
    });
  }

  /** Archive a plan (soft-delete) so existing subscribers keep it. */
  async archive(id: string): Promise<PlanSummary> {
    const actorId = this.actor();
    return this.mutate(async (tx) => {
      const existing = await tx.plan.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException('Plan not found');
      }
      await this.assertFreePlanRemains(existing, { isActive: false }, tx);
      const plan = await tx.plan.update({
        where: { id },
        data: { isActive: false },
      });
      await this.notices.append(tx, {
        actorId,
        planId: id,
        action: 'PLAN_ARCHIVED',
        details: {
          planName: plan.name,
          before: toPlanSummary(existing),
          after: toPlanSummary(plan),
        },
      });
      return toPlanSummary(plan);
    });
  }

  /**
   * Refuse to leave the platform without an active free plan — the signup
   * flow depends on a free tier to onboard cost-free.
   */
  private async assertFreePlanRemains(
    plan: Plan,
    dto: UpdatePlanDto,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const deactivating = plan.isFree && dto.isActive === false;
    const repricing = plan.isFree && dto.priceMinorUnits !== undefined;
    const removingFree = repricing && dto.priceMinorUnits! > 0;
    if (!deactivating && !removingFree) return;

    const otherFree = await tx.plan.count({
      where: { isActive: true, isFree: true, id: { not: plan.id } },
    });
    if (otherFree === 0) {
      throw new ConflictException(
        'Cannot remove the only active free plan — signups require a free tier',
      );
    }
  }
}
