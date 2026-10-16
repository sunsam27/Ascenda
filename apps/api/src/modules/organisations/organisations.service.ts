import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Organisation, Prisma } from '@ascenda/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateOrganisationDto } from './dto/update-organisation.dto';

/** Guard rails for terminology overrides (keeps the JSON blob sane). */
export const MAX_TERMINOLOGY_KEYS = 40;
export const MAX_TERMINOLOGY_KEY_LENGTH = 60;
export const MAX_TERMINOLOGY_VALUE_LENGTH = 60;

/** Keys that must never be used as terminology terms (prototype pollution). */
const RESERVED_TERM_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Normalise a terminology map into `{ Term: Override }`, rejecting values that
 * are not strings or exceed the configured limits. Blank entries are dropped.
 */
export function sanitizeTerminology(
  input: Record<string, unknown>,
): Record<string, string> {
  const entries = Object.entries(input);
  if (entries.length > MAX_TERMINOLOGY_KEYS) {
    throw new BadRequestException(
      `terminology may hold at most ${MAX_TERMINOLOGY_KEYS} terms`,
    );
  }
  const out: Record<string, string> = Object.create(null);
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!key) continue;
    if (RESERVED_TERM_KEYS.has(key)) continue;
    if (key.length > MAX_TERMINOLOGY_KEY_LENGTH) {
      throw new BadRequestException(
        `terminology term "${key.slice(0, 20)}…" is too long`,
      );
    }
    if (typeof rawValue !== 'string') {
      throw new BadRequestException(
        `terminology value for "${key}" must be a string`,
      );
    }
    const value = rawValue.trim();
    if (!value) continue;
    if (value.length > MAX_TERMINOLOGY_VALUE_LENGTH) {
      throw new BadRequestException(
        `terminology value for "${key}" is too long`,
      );
    }
    out[key] = value;
  }
  return out;
}

/**
 * Organisations Service
 * Reads are scoped by RLS to the caller's active organisation (SECURITY.md §3).
 */
@Injectable()
export class OrganisationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getCurrent(): Promise<Organisation[]> {
    return this.prisma.withRequestContext((tx) => tx.organisation.findMany());
  }

  /**
   * Update the caller's active organisation (Phase 1 setup: country, currency,
   * timezone, terminology overrides, branding). RLS confines the write to the
   * caller's tenant; the resolved row id is used so the update can never target
   * another organisation.
   */
  async update(dto: UpdateOrganisationDto): Promise<Organisation> {
    const { updated, previous } = await this.prisma.withRequestContext(
      async (tx) => {
        const current = await tx.organisation.findFirst();
        if (!current) {
          throw new UnauthorizedException(
            'No active organisation for this request',
          );
        }

        const data: Prisma.OrganisationUpdateInput = {};
        if (dto.name !== undefined) {
          const name = dto.name.trim();
          if (!name) throw new BadRequestException('name cannot be empty');
          data.name = name;
        }
        if (dto.type !== undefined) data.type = dto.type;
        if (dto.country !== undefined) data.country = dto.country;
        if (dto.currency !== undefined) data.currency = dto.currency;
        if (dto.timezone !== undefined) {
          const timezone = dto.timezone.trim();
          if (!timezone) {
            throw new BadRequestException('timezone cannot be empty');
          }
          data.timezone = timezone;
        }
        if (dto.logoUrl !== undefined) {
          const logoUrl = dto.logoUrl.trim();
          data.logoUrl = logoUrl || null;
        }
        if (dto.terminology !== undefined) {
          data.terminology = sanitizeTerminology(dto.terminology);
        }
        if (dto.workDays !== undefined) {
          data.workDays = [...new Set(dto.workDays)].sort((a, b) => a - b);
        }
        if (dto.workDayStart !== undefined) data.workDayStart = dto.workDayStart;
        if (dto.workDayEnd !== undefined) data.workDayEnd = dto.workDayEnd;
        if (dto.lateGraceMinutes !== undefined) {
          data.lateGraceMinutes = dto.lateGraceMinutes;
        }

        const beforeValue: Record<string, unknown> = {};
        if (dto.name !== undefined) beforeValue.name = current.name;
        if (dto.type !== undefined) beforeValue.type = current.type;
        if (dto.country !== undefined) beforeValue.country = current.country;
        if (dto.currency !== undefined) beforeValue.currency = current.currency;
        if (dto.timezone !== undefined) beforeValue.timezone = current.timezone;
        if (dto.logoUrl !== undefined) beforeValue.logoUrl = current.logoUrl;
        if (dto.terminology !== undefined) {
          beforeValue.terminology = current.terminology as Prisma.JsonValue;
        }
        if (dto.workDays !== undefined) beforeValue.workDays = current.workDays;
        if (dto.workDayStart !== undefined) {
          beforeValue.workDayStart = current.workDayStart;
        }
        if (dto.workDayEnd !== undefined) beforeValue.workDayEnd = current.workDayEnd;
        if (dto.lateGraceMinutes !== undefined) {
          beforeValue.lateGraceMinutes = current.lateGraceMinutes;
        }

        const row = await tx.organisation.update({
          where: { id: current.id },
          data,
        });
        return { updated: row, previous: beforeValue };
      },
    );

    await this.audit.record({
      action: AuditAction.ORGANISATION_UPDATED,
      targetType: 'organisation',
      targetId: updated.id,
      previousValue: previous,
      newValue: {
        name: updated.name,
        type: updated.type,
        country: updated.country,
        currency: updated.currency,
        timezone: updated.timezone,
        logoUrl: updated.logoUrl ?? null,
        terminology: updated.terminology as Prisma.JsonValue,
        workDays: updated.workDays,
        workDayStart: updated.workDayStart,
        workDayEnd: updated.workDayEnd,
        lateGraceMinutes: updated.lateGraceMinutes,
      },
    });

    return updated;
  }
}
