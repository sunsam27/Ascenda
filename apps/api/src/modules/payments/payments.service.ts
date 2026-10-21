import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import type { Payment, PaymentStatus } from '@ascenda/types';
import { PaymentExportFormat, PaymentStatus as Status } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import {
  ExportPaymentsQueryDto,
  ListPaymentsQueryDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto';
import { buildPaymentsCsv, type PaymentExportRow } from './domain/payment-export';

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

  /**
   * PAY-12: build a bank-upload payment file. Read-only over payments, joined
   * to each worker's primary bank account and name. The export itself is
   * audit-logged (PAYMENTS_EXPORTED) as a sensitive data release.
   */
  async export(
    query: ExportPaymentsQueryDto,
  ): Promise<{ filename: string; contentType: string; content: string }> {
    this.requireContext();
    const format = query.format ?? PaymentExportFormat.CSV;
    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.PaymentWhereInput = {
        ...(query.payrollRunId ? { payrollRunId: query.payrollRunId } : {}),
        ...(query.status ? { status: query.status } : {}),
      };
      const payments = await tx.payment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });

      const workerIds = [...new Set(payments.map((p) => p.workerId))];
      const workers = await tx.worker.findMany({
        where: { id: { in: workerIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
        },
      });
      const workerName = new Map(
        workers.map((w) => [
          w.id,
          w.preferredName?.trim() || `${w.firstName} ${w.lastName}`.trim(),
        ]),
      );

      const accounts = await tx.bankAccount.findMany({
        where: { workerId: { in: workerIds } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: {
          workerId: true,
          bankName: true,
          bankCode: true,
          accountNumberMasked: true,
          accountName: true,
        },
      });
      const accountByWorker = new Map<
        string,
        (typeof accounts)[number]
      >();
      for (const account of accounts) {
        if (!accountByWorker.has(account.workerId)) {
          accountByWorker.set(account.workerId, account);
        }
      }

      const rows: PaymentExportRow[] = payments.map((p) => {
        const account = accountByWorker.get(p.workerId);
        return {
          reference: p.reference,
          workerName: workerName.get(p.workerId) ?? '',
          accountName: account?.accountName ?? workerName.get(p.workerId) ?? '',
          bankName: account?.bankName ?? '',
          bankCode: account?.bankCode ?? '',
          accountNumberMasked: account?.accountNumberMasked ?? '',
          amountMinorUnits: p.amountMinorUnits,
          currency: p.currency,
          status: p.status,
          description: p.description,
        };
      });

      const content = buildPaymentsCsv(rows);

      await this.audit.record({
        action: AuditAction.PAYMENTS_EXPORTED,
        targetType: 'payment_export',
        targetId: query.payrollRunId ?? 'all',
        newValue: {
          format,
          paymentCount: rows.length,
          payrollRunId: query.payrollRunId ?? null,
          status: query.status ?? null,
        },
      });

      const stamp = new Date().toISOString().slice(0, 10);
      return {
        filename: `payments-export-${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
        content,
      };
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
