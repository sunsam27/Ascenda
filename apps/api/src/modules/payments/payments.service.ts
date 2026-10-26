import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, NotificationType, Prisma, SystemRole } from '@ascenda/db';
import type {
  Payment,
  PaymentBatch,
  PaymentBatchStatus as BatchStatus,
  PaymentStatus,
} from '@ascenda/types';
import {
  PaymentBatchStatus,
  PaymentExportFormat,
  PaymentStatus as Status,
} from '@ascenda/types';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { decryptAccountNumber } from '../people/domain/bank-crypto';
import {
  CancelPaymentBatchDto,
  CreatePaymentBatchDto,
  ExportPaymentsQueryDto,
  ListPaymentBatchesQueryDto,
  ListPaymentsQueryDto,
  UpdatePaymentStatusDto,
} from './dto/payment.dto';
import { buildPaymentsCsv, type PaymentExportRow } from './domain/payment-export';

type PaymentRow = Prisma.PaymentGetPayload<Record<string, never>>;
type PaymentBatchRow = Prisma.PaymentBatchGetPayload<Record<string, never>>;

export interface PaymentExportFile {
  filename: string;
  contentType: string;
  content: string;
}

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    organisationId: row.organisationId,
    payrollRunId: row.payrollRunId ?? undefined,
    paymentBatchId: row.paymentBatchId ?? undefined,
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

export function toPaymentBatch(row: PaymentBatchRow): PaymentBatch {
  return {
    id: row.id,
    organisationId: row.organisationId,
    payrollRunId: row.payrollRunId ?? undefined,
    reference: row.reference,
    label: row.label,
    status: row.status as BatchStatus,
    currency: row.currency,
    totalMinorUnits: row.totalMinorUnits,
    paymentCount: row.paymentCount,
    approvedAt: row.approvedAt?.toISOString(),
    approvedBy: row.approvedBy ?? undefined,
    exportedAt: row.exportedAt?.toISOString(),
    exportedBy: row.exportedBy ?? undefined,
    paidAt: row.paidAt?.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString(),
    cancelledBy: row.cancelledBy ?? undefined,
    cancellationReason: row.cancellationReason ?? undefined,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Allowed payment status transitions (PAY-07 process step). */
const PAYMENT_TRANSITIONS: Record<Status, Status[]> = {
  [Status.PENDING]: [
    Status.APPROVED,
    Status.PROCESSING,
    Status.CANCELLED,
    Status.FAILED,
  ],
  [Status.APPROVED]: [
    Status.PROCESSING,
    Status.PAID,
    Status.CANCELLED,
    Status.FAILED,
  ],
  [Status.PROCESSING]: [
    Status.PAID,
    Status.CANCELLED,
    Status.FAILED,
    Status.REVERSED,
  ],
  [Status.PAID]: [Status.REVERSED],
  [Status.COMPLETED]: [Status.REVERSED],
  [Status.FAILED]: [Status.APPROVED, Status.PROCESSING, Status.CANCELLED],
  [Status.CANCELLED]: [],
  [Status.REVERSED]: [],
};

const BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  [PaymentBatchStatus.DRAFT]: [
    PaymentBatchStatus.APPROVED,
    PaymentBatchStatus.CANCELLED,
  ],
  [PaymentBatchStatus.APPROVED]: [
    PaymentBatchStatus.PAID,
    PaymentBatchStatus.CANCELLED,
  ],
  [PaymentBatchStatus.PAID]: [],
  [PaymentBatchStatus.CANCELLED]: [],
};

/**
 * Worker payments created when a payroll run is processed (PAY-07 / M2
 * boundary: rows + status lifecycle only; the bank payment file is M3).
 * Every status change is audit-logged.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
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
        ...(query.paymentBatchId
          ? { paymentBatchId: query.paymentBatchId }
          : {}),
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
   * to each worker's primary bank account and name. Account numbers are
   * decrypted for the bank file only; the export is audited as a sensitive
   * data release and watermarked with the run/batch and exporter.
   */
  async export(query: ExportPaymentsQueryDto): Promise<PaymentExportFile> {
    this.requireContext();
    const format = query.format ?? PaymentExportFormat.CSV;
    if (format !== PaymentExportFormat.CSV) {
      throw new BadRequestException(`Unsupported export format: ${format}`);
    }

    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.PaymentWhereInput = {
        ...(query.payrollRunId ? { payrollRunId: query.payrollRunId } : {}),
        ...(query.paymentBatchId
          ? { paymentBatchId: query.paymentBatchId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      };
      const payments = await tx.payment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });
      if (payments.length === 0) {
        throw new BadRequestException('No payments match this export');
      }

      const file = await this.buildExport(
        tx,
        payments,
        query.payrollRunId ?? null,
        query.paymentBatchId ?? null,
      );

      await this.audit.record({
        action: AuditAction.PAYMENTS_EXPORTED,
        targetType: 'payment_export',
        targetId: query.payrollRunId ?? query.paymentBatchId ?? 'all',
        newValue: {
          format,
          paymentCount: payments.length,
          payrollRunId: query.payrollRunId ?? null,
          paymentBatchId: query.paymentBatchId ?? null,
          status: query.status ?? null,
          watermark: true,
        },
      });

      return file;
    });
  }

  async listBatches(query: ListPaymentBatchesQueryDto): Promise<{
    data: PaymentBatch[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.PaymentBatchWhereInput = {
        ...(query.payrollRunId ? { payrollRunId: query.payrollRunId } : {}),
        ...(query.status ? { status: query.status } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.paymentBatch.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.paymentBatch.count({ where }),
      ]);
      return {
        data: rows.map(toPaymentBatch),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async getBatch(id: string): Promise<PaymentBatch> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.paymentBatch.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Payment batch not found');
      return toPaymentBatch(row);
    });
  }

  /**
   * Assemble unbatched payments into a draft batch. Either a whole payroll run
   * or an explicit payment list may be supplied, but not both.
   */
  async createBatch(dto: CreatePaymentBatchDto): Promise<PaymentBatch> {
    const { organisationId, userId } = this.requireContext();
    if (!dto.payrollRunId && !dto.paymentIds?.length) {
      throw new BadRequestException(
        'Provide payrollRunId or at least one paymentId',
      );
    }
    if (dto.payrollRunId && dto.paymentIds?.length) {
      throw new BadRequestException(
        'Provide either payrollRunId or paymentIds, not both',
      );
    }

    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.PaymentWhereInput = {
        ...(dto.payrollRunId ? { payrollRunId: dto.payrollRunId } : {}),
        ...(dto.paymentIds?.length ? { id: { in: dto.paymentIds } } : {}),
        paymentBatchId: null,
        status: { in: [Status.PENDING, Status.APPROVED] },
      };
      const payments = await tx.payment.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });
      if (payments.length === 0) {
        throw new ConflictException(
          'No unbatched pending payments match this selection',
        );
      }
      if (dto.paymentIds?.length && payments.length !== dto.paymentIds.length) {
        throw new ConflictException(
          'One or more payments are already batched, paid, or cancelled',
        );
      }

      const currencies = [...new Set(payments.map((p) => p.currency))];
      if (currencies.length > 1) {
        throw new BadRequestException(
          'A payment batch must contain a single currency',
        );
      }
      const runIds = [...new Set(payments.map((p) => p.payrollRunId).filter(Boolean))];
      if (runIds.length > 1) {
        throw new BadRequestException(
          'A payment batch must belong to a single payroll run',
        );
      }
      const payrollRunId = dto.payrollRunId ?? runIds[0] ?? null;
      const currency = currencies[0]!;
      const totalMinorUnits = payments.reduce(
        (sum, p) => sum + p.amountMinorUnits,
        0,
      );

      const reference = `PB-${new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

      const batch = await tx.paymentBatch.create({
        data: {
          organisationId,
          payrollRunId,
          reference,
          label: dto.label?.trim() || `Payment batch ${reference}`,
          status: PaymentBatchStatus.DRAFT,
          currency,
          totalMinorUnits,
          paymentCount: payments.length,
          createdBy: userId,
        },
      });

      await tx.payment.updateMany({
        where: { id: { in: payments.map((p) => p.id) } },
        data: { paymentBatchId: batch.id },
      });

      await this.audit.record({
        action: AuditAction.PAYMENT_BATCH_CREATED,
        targetType: 'payment_batch',
        targetId: batch.id,
        newValue: {
          reference,
          payrollRunId,
          currency,
          paymentCount: payments.length,
          totalMinorUnits,
        },
      });

      return toPaymentBatch(batch);
    });
  }

  /** DRAFT → APPROVED. Finance approver action; requires step-up auth. */
  async approveBatch(id: string): Promise<PaymentBatch> {
    const { organisationId, userId } = this.requireContext();
    const batch = await this.prisma.withRequestContext(async (tx) => {
      const row = await tx.paymentBatch.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Payment batch not found');
      this.assertBatchTransition(row.status as BatchStatus, PaymentBatchStatus.APPROVED);

      const updated = await tx.paymentBatch.update({
        where: { id: row.id },
        data: {
          status: PaymentBatchStatus.APPROVED,
          approvedAt: new Date(),
          approvedBy: userId,
        },
      });
      await tx.payment.updateMany({
        where: {
          paymentBatchId: row.id,
          status: Status.PENDING,
        },
        data: { status: Status.APPROVED },
      });

      await this.audit.record({
        action: AuditAction.PAYMENT_BATCH_APPROVED,
        targetType: 'payment_batch',
        targetId: row.id,
        newValue: {
          reference: row.reference,
          paymentCount: row.paymentCount,
          totalMinorUnits: row.totalMinorUnits,
          currency: row.currency,
        },
      });
      return updated;
    });

    await this.notifyRoles(organisationId, userId, [
      SystemRole.PAYROLL_ADMINISTRATOR,
      SystemRole.FINANCE_APPROVER,
    ], {
      type: NotificationType.PAYMENT_BATCH_APPROVED,
      title: 'Payment batch approved',
      body: `${batch.reference} was approved (${batch.paymentCount} payments, ${batch.currency}).`,
      link: '/payroll',
      metadata: { paymentBatchId: batch.id, reference: batch.reference },
    });

    return toPaymentBatch(batch);
  }

  /** APPROVED → PAID. Marks every payment in the batch paid. */
  async payBatch(id: string): Promise<PaymentBatch> {
    const { organisationId, userId } = this.requireContext();
    const batch = await this.prisma.withRequestContext(async (tx) => {
      const row = await tx.paymentBatch.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Payment batch not found');
      this.assertBatchTransition(row.status as BatchStatus, PaymentBatchStatus.PAID);

      const now = new Date();
      const updated = await tx.paymentBatch.update({
        where: { id: row.id },
        data: { status: PaymentBatchStatus.PAID, paidAt: now },
      });
      await tx.payment.updateMany({
        where: {
          paymentBatchId: row.id,
          status: { in: [Status.APPROVED, Status.PROCESSING] },
        },
        data: { status: Status.PAID, processedAt: now },
      });

      await this.audit.record({
        action: AuditAction.PAYMENT_BATCH_PAID,
        targetType: 'payment_batch',
        targetId: row.id,
        newValue: {
          reference: row.reference,
          paymentCount: row.paymentCount,
          totalMinorUnits: row.totalMinorUnits,
        },
      });
      return updated;
    });

    await this.notifyRoles(organisationId, userId, [
      SystemRole.PAYROLL_ADMINISTRATOR,
      SystemRole.FINANCE_APPROVER,
    ], {
      type: NotificationType.PAYMENT_BATCH_PAID,
      title: 'Payment batch marked paid',
      body: `${batch.reference} was marked paid (${batch.paymentCount} payments, ${batch.currency}).`,
      link: '/payroll',
      metadata: { paymentBatchId: batch.id, reference: batch.reference },
    });

    return toPaymentBatch(batch);
  }

  /** DRAFT/APPROVED → CANCELLED. Releases unpaid payments from the batch. */
  async cancelBatch(
    id: string,
    dto: CancelPaymentBatchDto,
  ): Promise<PaymentBatch> {
    const { organisationId, userId } = this.requireContext();
    const batch = await this.prisma.withRequestContext(async (tx) => {
      const row = await tx.paymentBatch.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Payment batch not found');
      this.assertBatchTransition(
        row.status as BatchStatus,
        PaymentBatchStatus.CANCELLED,
      );

      const now = new Date();
      const updated = await tx.paymentBatch.update({
        where: { id: row.id },
        data: {
          status: PaymentBatchStatus.CANCELLED,
          cancelledAt: now,
          cancelledBy: userId,
          cancellationReason: dto.reason,
        },
      });
      await tx.payment.updateMany({
        where: {
          paymentBatchId: row.id,
          status: {
            in: [
              Status.PENDING,
              Status.APPROVED,
              Status.PROCESSING,
              Status.FAILED,
            ],
          },
        },
        data: { status: Status.CANCELLED },
      });

      await this.audit.record({
        action: AuditAction.PAYMENT_BATCH_CANCELLED,
        targetType: 'payment_batch',
        targetId: row.id,
        newValue: {
          reference: row.reference,
          reason: dto.reason,
          paymentCount: row.paymentCount,
          totalMinorUnits: row.totalMinorUnits,
        },
      });
      return updated;
    });

    this.logger.log(
      `Payment batch ${batch.reference} cancelled by ${userId} in ${organisationId}`,
    );
    return toPaymentBatch(batch);
  }

  /** PAY-12: export one approved batch; records the first export on the batch. */
  async exportBatch(id: string): Promise<PaymentExportFile> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const batch = await tx.paymentBatch.findFirst({ where: { id } });
      if (!batch) throw new NotFoundException('Payment batch not found');
      if (batch.status !== PaymentBatchStatus.APPROVED) {
        throw new ConflictException(
          'Only approved payment batches can be exported',
        );
      }
      const payments = await tx.payment.findMany({
        where: { paymentBatchId: batch.id },
        orderBy: { createdAt: 'asc' },
      });
      if (payments.length === 0) {
        throw new ConflictException('Payment batch has no payments');
      }

      const file = await this.buildExport(
        tx,
        payments,
        batch.payrollRunId,
        batch.id,
      );

      await tx.paymentBatch.update({
        where: { id: batch.id },
        data: {
          exportedAt: batch.exportedAt ?? new Date(),
          exportedBy: batch.exportedBy ?? userId,
        },
      });

      await this.audit.record({
        action: AuditAction.PAYMENTS_EXPORTED,
        targetType: 'payment_batch',
        targetId: batch.id,
        newValue: {
          reference: batch.reference,
          paymentCount: payments.length,
          totalMinorUnits: batch.totalMinorUnits,
          watermark: true,
        },
      });

      return file;
    });
  }

  async updateStatus(id: string, dto: UpdatePaymentStatusDto): Promise<Payment> {
    this.requireContext();
    const target = dto.status as Status;
    if (target === Status.PENDING) {
      throw new BadRequestException('Payments cannot be moved back to PENDING');
    }
    if (
      (target === Status.FAILED ||
        target === Status.REVERSED ||
        target === Status.CANCELLED) &&
      !dto.reason
    ) {
      throw new BadRequestException(`reason is required for ${target}`);
    }

    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payment.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Payment not found');
      if (row.paymentBatchId) {
        throw new ConflictException(
          'Manage this payment through its payment batch',
        );
      }

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
          ...(target === Status.COMPLETED || target === Status.PAID
            ? { processedAt: new Date() }
            : {}),
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
      if (target === Status.FAILED || target === Status.REVERSED) {
        const { organisationId, userId } = this.requireContext();
        await this.notifyRoles(
          organisationId,
          userId,
          [SystemRole.PAYROLL_ADMINISTRATOR, SystemRole.FINANCE_APPROVER],
          {
            type: NotificationType.PAYMENT_FAILED,
            title:
              target === Status.FAILED
                ? 'Payment failed'
                : 'Payment reversed',
            body: `Payment ${row.reference} (${
              row.amountMinorUnits / 100
            } ${row.currency}) was ${target.toLowerCase()}. ${
              dto.reason ?? ''
            }`.trim(),
            link: '/payroll',
            metadata: {
              paymentId: row.id,
              payrollRunId: row.payrollRunId,
              workerId: row.workerId,
            },
          },
        );
      }
      return toPayment(updated);
    });
  }

  private assertBatchTransition(from: BatchStatus, to: BatchStatus): void {
    if (!BATCH_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(
        `Payment batch cannot move from ${from} to ${to}`,
      );
    }
  }

  /**
   * Render the bank file with decrypted account numbers. Sorted primary-account
   * first. The watermark includes the run/batch, exporter and UTC timestamp.
   */
  private async buildExport(
    tx: Prisma.TransactionClient,
    payments: PaymentRow[],
    payrollRunId: string | null,
    paymentBatchId: string | null,
  ): Promise<PaymentExportFile> {
    const ctx = getRequestContext();
    const exportedBy = ctx?.userEmail || ctx?.userId || 'unknown';
    const exportedAt = new Date().toISOString();

    const workerIds = [...new Set(payments.map((p) => p.workerId))];
    const [workers, accounts, batches] = await Promise.all([
      tx.worker.findMany({
        where: { id: { in: workerIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
        },
      }),
      tx.bankAccount.findMany({
        where: { workerId: { in: workerIds } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: {
          workerId: true,
          bankName: true,
          bankCode: true,
          accountNumberEncrypted: true,
          accountNumberMasked: true,
          accountName: true,
        },
      }),
      tx.paymentBatch.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                payments.map((p) => p.paymentBatchId).filter(Boolean) as string[],
              ),
            ],
          },
        },
        select: { id: true, reference: true },
      }),
    ]);

    const workerName = new Map(
      workers.map((w) => [
        w.id,
        w.preferredName?.trim() || `${w.firstName} ${w.lastName}`.trim(),
      ]),
    );
    const batchReference = new Map(batches.map((b) => [b.id, b.reference]));
    const accountByWorker = new Map<string, (typeof accounts)[number]>();
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
        accountNumber: this.readAccountNumber(account),
        amountMinorUnits: p.amountMinorUnits,
        currency: p.currency,
        status: p.status,
        description: p.description,
        payrollRunId: p.payrollRunId ?? payrollRunId ?? '',
        paymentBatchReference: p.paymentBatchId
          ? batchReference.get(p.paymentBatchId) ?? ''
          : paymentBatchId ?? '',
        exportedBy,
        exportedAt,
      };
    });

    const stamp = exportedAt.slice(0, 10);
    const scope = payrollRunId
      ? `run-${payrollRunId}`
      : paymentBatchId
        ? `batch-${paymentBatchId}`
        : 'all';
    return {
      filename: `payments-export-${scope}-${stamp}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: buildPaymentsCsv(rows),
    };
  }

  private readAccountNumber(
    account:
      | {
          accountNumberEncrypted: string;
          accountNumberMasked: string;
        }
      | undefined,
  ): string {
    if (!account) return '';
    try {
      return decryptAccountNumber(account.accountNumberEncrypted);
    } catch {
      throw new ConflictException(
        'A bank account could not be decrypted for export',
      );
    }
  }

  private async notifyRoles(
    organisationId: string,
    actorUserId: string,
    roles: SystemRole[],
    intent: {
      type: NotificationType;
      title: string;
      body: string;
      link?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      const members = await this.prisma.withContext(
        { organisationId, userId: actorUserId },
        (tx) =>
          tx.membership.findMany({
            where: {
              organisationId,
              role: { in: roles },
              isActive: true,
            },
            select: { userId: true },
          }),
      );
      await this.notifications.emit({
        organisationId,
        actorUserId,
        intents: members.map((member) => ({
          recipientUserId: member.userId,
          ...intent,
        })),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to dispatch payment notifications: ${(error as Error).message}`,
      );
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
