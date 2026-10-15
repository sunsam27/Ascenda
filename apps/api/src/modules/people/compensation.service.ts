import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@ascenda/db';
import type {
  CompensationRecord,
  PayFrequency,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { resolveReadScope } from '../../common/rbac/worker-scope';
import { CreateCompensationDto, UpdateCompensationDto } from './dto/compensation.dto';

/**
 * True when the half-open periods [aStart, aEnd) and [bStart, bEnd) overlap.
 * A null end means "open-ended" (runs to infinity).
 */
export function periodsOverlap(
  aStart: Date,
  aEnd: Date | null,
  bStart: Date,
  bEnd: Date | null,
): boolean {
  const aEndMs = aEnd ? aEnd.getTime() : Infinity;
  const bEndMs = bEnd ? bEnd.getTime() : Infinity;
  return aStart.getTime() < bEndMs && bStart.getTime() < aEndMs;
}

type CompensationRow = Prisma.CompensationRecordGetPayload<Record<string, never>>;

export function toCompensationRecord(row: CompensationRow): CompensationRecord {
  return {
    id: row.id,
    organisationId: row.organisationId,
    workerId: row.workerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    grossAmountMinorUnits: row.grossAmountMinorUnits,
    currency: row.currency,
    payFrequency: row.payFrequency as unknown as PayFrequency,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo ? row.validTo.toISOString() : undefined,
    notes: row.notes ?? undefined,
    createdBy: row.createdBy,
  };
}

/**
 * Effective-dated compensation. Each record covers the half-open interval
 * [validFrom, validTo); a null validTo means the pay is still in force.
 *
 * Creating a record with a later effective date automatically closes the
 * previous open-ended record on the day the new one starts, and a new
 * open-ended record is capped at the start of the next scheduled change so the
 * timeline can never contain overlapping periods — a payroll run must resolve
 * to exactly one rate for any date.
 */
@Injectable()
export class CompensationService {
  constructor(private readonly prisma: PrismaService) {}

  async listForWorker(workerId: string): Promise<CompensationRecord[]> {
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerInScope(tx, workerId);
      const rows = await tx.compensationRecord.findMany({
        where: { workerId },
        orderBy: { validFrom: 'desc' },
      });
      return rows.map(toCompensationRecord);
    });
  }

  /** The rate in force on `asOf` (defaults to today), or null when none. */
  async getCurrent(
    workerId: string,
    asOf?: string,
  ): Promise<CompensationRecord | null> {
    const date = asOf ? new Date(asOf) : new Date();
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('asOf must be a valid date');
    }
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerInScope(tx, workerId);
      const row = await tx.compensationRecord.findFirst({
        where: {
          workerId,
          validFrom: { lte: date },
          OR: [{ validTo: null }, { validTo: { gt: date } }],
        },
        orderBy: { validFrom: 'desc' },
      });
      return row ? toCompensationRecord(row) : null;
    });
  }

  async create(
    workerId: string,
    dto: CreateCompensationDto,
  ): Promise<CompensationRecord> {
    const { organisationId, userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerInScope(tx, workerId);

      const validFrom = new Date(dto.validFrom);
      let validTo = dto.validTo ? new Date(dto.validTo) : null;
      if (validTo && validTo.getTime() <= validFrom.getTime()) {
        throw new BadRequestException('validTo must be after validFrom');
      }

      // Close the previous open-ended record the day the new rate starts.
      await tx.compensationRecord.updateMany({
        where: { workerId, validTo: null, validFrom: { lt: validFrom } },
        data: { validTo: validFrom },
      });

      // If the new record is open-ended, stop it where the next change begins.
      if (!validTo) {
        const next = await tx.compensationRecord.findFirst({
          where: { workerId, validFrom: { gt: validFrom } },
          orderBy: { validFrom: 'asc' },
          select: { validFrom: true },
        });
        if (next) dto = { ...dto, validTo: next.validFrom.toISOString() };
      }
      const resolvedValidTo = dto.validTo ? new Date(dto.validTo) : null;

      await this.assertNoOverlap(tx, workerId, validFrom, resolvedValidTo);

      const currency = await this.resolveCurrency(tx, dto.currency);
      const row = await tx.compensationRecord.create({
        data: {
          organisationId,
          workerId,
          createdBy: this.actorId(),
          grossAmountMinorUnits: dto.grossAmountMinorUnits,
          currency,
          payFrequency: dto.payFrequency,
          validFrom,
          validTo: resolvedValidTo,
          notes: dto.notes ?? null,
        },
      });
      return toCompensationRecord(row);
    });
  }

  async update(
    workerId: string,
    recordId: string,
    dto: UpdateCompensationDto,
  ): Promise<CompensationRecord> {
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerInScope(tx, workerId);
      const existing = await tx.compensationRecord.findFirst({
        where: { id: recordId, workerId },
      });
      if (!existing) throw new NotFoundException('Compensation record not found');

      const validFrom =
        dto.validFrom !== undefined ? new Date(dto.validFrom) : existing.validFrom;
      const validTo =
        dto.validTo !== undefined
          ? dto.validTo
            ? new Date(dto.validTo)
            : null
          : existing.validTo;
      if (validTo && validTo.getTime() <= validFrom.getTime()) {
        throw new BadRequestException('validTo must be after validFrom');
      }

      await this.assertNoOverlap(tx, workerId, validFrom, validTo, recordId);

      const row = await tx.compensationRecord.update({
        where: { id: recordId },
        data: {
          ...(dto.grossAmountMinorUnits !== undefined
            ? { grossAmountMinorUnits: dto.grossAmountMinorUnits }
            : {}),
          ...(dto.currency !== undefined
            ? { currency: await this.resolveCurrency(tx, dto.currency) }
            : {}),
          ...(dto.payFrequency !== undefined
            ? { payFrequency: dto.payFrequency }
            : {}),
          ...(dto.validFrom !== undefined ? { validFrom } : {}),
          ...(dto.validTo !== undefined ? { validTo } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
      return toCompensationRecord(row);
    });
  }

  async remove(workerId: string, recordId: string): Promise<void> {
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerInScope(tx, workerId);
      const existing = await tx.compensationRecord.findFirst({
        where: { id: recordId, workerId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Compensation record not found');
      await tx.compensationRecord.delete({ where: { id: recordId } });
    });
  }

  /** Reject a period that overlaps any other record for the same worker. */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    workerId: string,
    validFrom: Date,
    validTo: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const others = await tx.compensationRecord.findMany({
      where: { workerId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { validFrom: true, validTo: true },
    });
    const clash = others.find((r) =>
      periodsOverlap(validFrom, validTo, r.validFrom, r.validTo),
    );
    if (clash) {
      throw new ConflictException(
        'This period overlaps an existing compensation record',
      );
    }
  }

  private async resolveCurrency(
    tx: Prisma.TransactionClient,
    requested?: string,
  ): Promise<string> {
    if (requested) return requested.toUpperCase();
    const { organisationId } = this.requireContext();
    const org = await tx.organisation.findUnique({
      where: { id: organisationId },
      select: { currency: true },
    });
    return (org?.currency ?? 'NGN').toUpperCase();
  }

  private actorId(): string {
    return this.requireContext().userId;
  }

  /** Confirm the worker exists within the caller's read scope. */
  private async assertWorkerInScope(
    tx: Prisma.TransactionClient,
    workerId: string,
  ): Promise<void> {
    const scopeWhere = (await resolveReadScope(tx, 'workers', 'read')).where;
    const worker = await tx.worker.findFirst({
      where: { AND: [{ id: workerId }, scopeWhere] },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Worker not found');
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
