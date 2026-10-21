import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import type {
  CreateStatutoryRulePackDto,
  StatutoryRulePack,
  UpdateStatutoryRulePackDto,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { ListStatutoryRulePacksQueryDto } from './dto/statutory-rule-pack.dto';
import {
  validatePackRules,
  type StatutoryRule,
} from './domain/statutory';

type PackRow = Prisma.StatutoryRulePackGetPayload<Record<string, never>>;

function coerceRules(value: Prisma.JsonValue): StatutoryRule[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as StatutoryRule[];
}

export function toStatutoryRulePack(row: PackRow): StatutoryRulePack {
  return {
    id: row.id,
    organisationId: row.organisationId,
    country: row.country,
    version: row.version,
    rules: coerceRules(row.rules),
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo ? row.validTo.toISOString() : undefined,
    isActive: row.isActive,
    validated: row.validated,
    validatedBy: row.validatedBy ?? undefined,
    validatedAt: row.validatedAt ? row.validatedAt.toISOString() : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/**
 * Statutory rule packs (PRD PAY-12 / LOC-02 / LOC-03). Rules are organisation
 * configured DATA — the codebase never invents a country's rates. Packs are
 * versioned by effective date and flagged "not validated by a professional"
 * until a qualified reviewer marks them. Every write audits
 * STATUTORY_RULE_PACK_CHANGED.
 */
@Injectable()
export class StatutoryRulePacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListStatutoryRulePacksQueryDto): Promise<{
    data: StatutoryRulePack[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.StatutoryRulePackWhereInput = {
        ...(query.country ? { country: query.country.toUpperCase() } : {}),
        ...(query.active !== undefined ? { isActive: query.active } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.statutoryRulePack.findMany({
          where,
          orderBy: [{ country: 'asc' }, { validFrom: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.statutoryRulePack.count({ where }),
      ]);
      return {
        data: rows.map(toStatutoryRulePack),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<StatutoryRulePack> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.statutoryRulePack.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Statutory rule pack not found');
      return toStatutoryRulePack(row);
    });
  }

  async create(dto: CreateStatutoryRulePackDto): Promise<StatutoryRulePack> {
    const { organisationId, userId } = this.requireContext();
    this.assertRules(dto.rules);
    this.assertPeriod(dto.validFrom, dto.validTo);

    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.statutoryRulePack.create({
        data: {
          organisationId,
          country: dto.country.toUpperCase(),
          version: dto.version,
          rules: dto.rules as unknown as Prisma.InputJsonValue,
          validFrom: new Date(dto.validFrom),
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          isActive: dto.isActive ?? true,
          createdBy: userId,
        },
      });
      await this.audit.record({
        action: AuditAction.STATUTORY_RULE_PACK_CHANGED,
        targetType: 'statutory_rule_pack',
        targetId: row.id,
        newValue: {
          created: true,
          country: row.country,
          version: row.version,
          ruleCount: coerceRules(row.rules).length,
        },
      });
      return toStatutoryRulePack(row);
    });
  }

  async update(
    id: string,
    dto: UpdateStatutoryRulePackDto,
  ): Promise<StatutoryRulePack> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.statutoryRulePack.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Statutory rule pack not found');

      if (dto.rules !== undefined) this.assertRules(dto.rules);
      const validFrom =
        dto.validFrom !== undefined
          ? dto.validFrom
          : existing.validFrom.toISOString();
      const validTo =
        dto.validTo !== undefined
          ? dto.validTo
          : existing.validTo
            ? existing.validTo.toISOString()
            : null;
      this.assertPeriod(validFrom, validTo);

      const row = await tx.statutoryRulePack.update({
        where: { id },
        data: {
          ...(dto.version !== undefined ? { version: dto.version } : {}),
          ...(dto.rules !== undefined
            ? { rules: dto.rules as unknown as Prisma.InputJsonValue }
            : {}),
          validFrom: new Date(validFrom),
          validTo: validTo ? new Date(validTo) : null,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          // Any edit invalidates a prior professional validation.
          validated: false,
          validatedBy: null,
          validatedAt: null,
        },
      });
      await this.audit.record({
        action: AuditAction.STATUTORY_RULE_PACK_CHANGED,
        targetType: 'statutory_rule_pack',
        targetId: row.id,
        newValue: {
          updated: true,
          country: row.country,
          version: row.version,
          ruleCount: coerceRules(row.rules).length,
          validated: false,
        },
      });
      return toStatutoryRulePack(row);
    });
  }

  /** LOC-03: mark a pack as validated (or un-validate it) by a professional. */
  async setValidated(id: string, validated: boolean): Promise<StatutoryRulePack> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.statutoryRulePack.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException('Statutory rule pack not found');
      const row = await tx.statutoryRulePack.update({
        where: { id },
        data: {
          validated,
          validatedBy: validated ? userId : null,
          validatedAt: validated ? new Date() : null,
        },
      });
      await this.audit.record({
        action: AuditAction.STATUTORY_RULE_PACK_CHANGED,
        targetType: 'statutory_rule_pack',
        targetId: row.id,
        newValue: { validated, version: row.version, country: row.country },
      });
      return toStatutoryRulePack(row);
    });
  }

  async remove(id: string): Promise<void> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const existing = await tx.statutoryRulePack.findFirst({
        where: { id },
        select: { id: true, country: true, version: true },
      });
      if (!existing) throw new NotFoundException('Statutory rule pack not found');
      await tx.statutoryRulePack.delete({ where: { id } });
      await this.audit.record({
        action: AuditAction.STATUTORY_RULE_PACK_CHANGED,
        targetType: 'statutory_rule_pack',
        targetId: id,
        newValue: {
          deleted: true,
          country: existing.country,
          version: existing.version,
        },
      });
    });
  }

  /**
   * The active, effective pack for a country at a date (used by the run engine).
   * Returns null when the org has configured none — the run simply applies no
   * statutory lines rather than inventing any.
   */
  async activePackFor(
    tx: Prisma.TransactionClient,
    organisationId: string,
    country: string,
    at: Date,
  ): Promise<StatutoryRule[] | null> {
    const row = await tx.statutoryRulePack.findFirst({
      where: {
        organisationId,
        country: country.toUpperCase(),
        isActive: true,
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gte: at } }],
      },
      orderBy: { validFrom: 'desc' },
    });
    return row ? coerceRules(row.rules) : null;
  }

  private assertRules(rules: StatutoryRule[]): void {
    const errors = validatePackRules(rules);
    if (errors.length > 0) throw new BadRequestException(errors.join('; '));
  }

  private assertPeriod(validFrom: string, validTo?: string | null): void {
    if (!validTo) return;
    if (new Date(validTo).getTime() <= new Date(validFrom).getTime()) {
      throw new BadRequestException('validTo must be after validFrom');
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
