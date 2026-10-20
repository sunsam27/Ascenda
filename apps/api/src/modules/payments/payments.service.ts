import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import type { Payment, PaymentStatus } from '@ascenda/types';
import { PaymentStatus as Status } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import {
  ListPaymentsQueryDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto';

type PaymentRow = Prisma.PaymentGetPayload<Record<string, never>>;

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    organisationId: row.organisationId,
    payrollRunId: row.payrollRunId ?? undefined,
    workerId: row.workerId,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    status: row.status as PaymentStatus,
    reference: row.reference,
    description: row.description,
    processedAt: row.processedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Allowed payment status transitions (PAY-07 process step). */
const PAYMENT_TRANSITIONS: Record<Status, Status[]> = {
  [Status.PENDING]: [Status.PROCESSING, Status.FAILED],
  [Status.PROCESSING]: [Status.COMPLETED, Status.FAILED, Status.REVERSED],
  [Status.COMPLETED]: [Status.REVERSED],
  [Status.FAILED]: [Status.PROCESSING],
  [Status.REVERSED]: [],
};

/**
 * Worker payments created when a payroll run is processed (PAY-07 / M2
 * boundary: rows + status lifecycle only; the bank payment file is M3).
 * Every status change is audit-logged.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListPaymentsQueryDto): Promise<{
    data: Payment[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.PaymentWhereInput = {
        ...(query.workerId ? { workerId: query.workerId } : {}),
        ...(query.payrollRunId ? { payrollRunId: query.payrollRunId } : {}),
        ...(query.status ? { status: query.status } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.payment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.payment.count({ where }),
      ]);
      return {
        data: rows.map(toPayment),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<Payment> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payment.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Payment not found');
      return toPayment(row);
    });
  }

  async updateStatus(id: string, dto: UpdatePaymentStatusDto): Promise<Payment> {
    const { organisationId } = this.requireContext();
    const target = dto.status as Status;
    if (target === Status.PENDING) {
      throw new BadRequestException('Payments cannot be moved back to PENDING');
    }
    if (
      (target === Status.FAILED || target === Status.REVERSED) &&
      !dto.reason
    ) {
      throw new BadRequestException(`reason is required for ${target}`);
    }

    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payment.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Payment not found');

      const from = row.status as Status;
      if (!PAYMENT_TRANSITIONS[from].includes(target)) {
        throw new ConflictException(
          `Payment cannot move from ${from} to ${target}`,
        );
      }

      const updated = await tx.payment.update({
        where: { id: row.id },
        data: {
          status: target,
          ...(target === Status.COMPLETED ? { processedAt: new Date() } : {}),
        },
      });
      await this.audit.record({
        action: AuditAction.PAYMENT_STATUS_CHANGED,
        targetType: 'payment',
        targetId: row.id,
        newValue: {
          status: from,
          newStatus: target,
          reason: dto.reason ?? null,
          workerId: row.workerId,
          payrollRunId: row.payrollRunId,
          amountMinorUnits: row.amountMinorUnits,
        },
      });
      return toPayment(updated);
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
