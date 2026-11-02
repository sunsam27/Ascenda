import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma, SystemRole } from '@ascenda/db';
import {
  NotificationType,
  PaymentBatchStatus,
  PaymentStatus,
  PayoutAccountMode,
  PayoutAccountStatus,
  PayoutProvider,
  PayoutStatus,
  type PaymentBatch,
  type PayoutAccountSummary,
  type PayoutBatchResult,
  type PayoutSummary,
} from '@ascenda/types';
import { getRequestContext } from '../../../common/context/request-context';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  decryptAccountNumber,
  encryptAccountNumber,
} from '../../people/domain/bank-crypto';
import { toPaymentBatch } from '../payments.service';
import type { SavePayoutAccountDto } from '../dto/payment.dto';
import { PayoutGatewayRegistry } from './payout-gateway.registry';
import {
  PayoutProviderError,
  type PayoutGateway,
  type TransferResult,
  type WebhookTransferUpdate,
} from './payout-provider';
import { payoutOptions, providerSupportsCurrency } from './payout-support';
import {
  verifyFlutterwaveHash,
  verifyPaystackSignature,
} from './payout-signature';

const TERMINAL_PAYOUT_STATUSES = new Set<PayoutStatus>([
  PayoutStatus.PAID,
  PayoutStatus.FAILED,
  PayoutStatus.REVERSED,
]);

const PAYOUT_STATUS_TO_PAYMENT: Record<PayoutStatus, PaymentStatus> = {
  [PayoutStatus.QUEUED]: PaymentStatus.PROCESSING,
  [PayoutStatus.PROCESSING]: PaymentStatus.PROCESSING,
  [PayoutStatus.PAID]: PaymentStatus.PAID,
  [PayoutStatus.FAILED]: PaymentStatus.FAILED,
  [PayoutStatus.REVERSED]: PaymentStatus.REVERSED,
};

type PayoutRow = Prisma.PayoutGetPayload<Record<string, never>>;

interface PreparedPayout {
  payoutId: string;
  reference: string;
  amountMinorUnits: number;
  currency: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  country: string;
  workerName: string;
}

interface PreparedBatch {
  batchId: string;
  batchReference: string;
  paymentCount: number;
  totalMinorUnits: number;
  currency: string;
  provider: PayoutProvider;
  secretKeyEncrypted: string;
  payouts: PreparedPayout[];
}

function toPayoutSummary(row: PayoutRow): PayoutSummary {
  return {
    id: row.id,
    paymentBatchId: row.paymentBatchId,
    paymentId: row.paymentId,
    workerId: row.workerId,
    provider: row.provider as PayoutProvider,
    status: row.status as PayoutStatus,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    reference: row.reference,
    providerTransferId: row.providerTransferId ?? undefined,
    recipientName: row.recipientName ?? undefined,
    bankName: row.bankName ?? undefined,
    bankCode: row.bankCode ?? undefined,
    accountNumberMasked: row.accountNumberMasked ?? undefined,
    failureReason: row.failureReason ?? undefined,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  };
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gateways: PayoutGatewayRegistry,
    private readonly config: ConfigService,
  ) {}

  getOptions(): ReturnType<typeof payoutOptions> {
    return payoutOptions();
  }

  async getAccount(): Promise<PayoutAccountSummary | null> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payoutAccount.findUnique({
        where: {
          organisationId: this.requireContext().organisationId,
        },
      });
      return row ? this.toAccountSummary(row) : null;
    });
  }

  async saveAccount(dto: SavePayoutAccountDto): Promise<PayoutAccountSummary> {
    const { organisationId, userId } = this.requireContext();
    const provider = dto.provider;
    const currency = dto.currency.trim().toUpperCase();
    const country = dto.country.trim().toUpperCase();
    const secretKey = dto.secretKey.trim();

    if (!providerSupportsCurrency(provider, currency)) {
      throw new BadRequestException(
        `${provider} payouts are not supported for ${currency}.`,
      );
    }
    this.assertKeyMatchesMode(provider, dto.mode, secretKey);

    const snapshot = await this.prisma.withRequestContext(async (tx) => {
      const [organisation, existing, activePayouts] = await Promise.all([
        tx.organisation.findFirst({
          where: { id: organisationId },
          select: { currency: true },
        }),
        tx.payoutAccount.findUnique({ where: { organisationId } }),
        tx.payout.count({
          where: {
            organisationId,
            status: { in: [PayoutStatus.QUEUED, PayoutStatus.PROCESSING] },
          },
        }),
      ]);
      return { organisation, existing, activePayouts };
    });

    if (!snapshot.organisation) {
      throw new NotFoundException('Organisation not found');
    }
    if (
      snapshot.organisation.currency?.toUpperCase() !== currency &&
      snapshot.organisation.currency
    ) {
      throw new BadRequestException(
        `The payout account currency must match your organisation currency (${snapshot.organisation.currency.toUpperCase()}).`,
      );
    }
    if (snapshot.activePayouts > 0) {
      throw new ConflictException(
        'Wait for in-flight payouts to finish before changing the payout account.',
      );
    }
    if (
      provider === PayoutProvider.FLUTTERWAVE &&
      !dto.webhookSecret &&
      !(
        snapshot.existing?.provider === provider &&
        snapshot.existing.webhookSecretEncrypted
      )
    ) {
      throw new BadRequestException(
        'Flutterwave webhook secret is required so payout confirmations can be verified.',
      );
    }

    const gateway = this.gateways.get(provider);
    let balance: Awaited<ReturnType<PayoutGateway['getBalance']>>;
    try {
      balance = await gateway.getBalance(secretKey, currency);
    } catch (error) {
      throw new BadRequestException(
        `Could not verify this ${provider} key: ${this.errorMessage(error)}`,
      );
    }

    const now = new Date();
    const secretKeyEncrypted = encryptAccountNumber(secretKey);
    const webhookSecretEncrypted = dto.webhookSecret
      ? encryptAccountNumber(dto.webhookSecret.trim())
      : snapshot.existing?.provider === provider
        ? (snapshot.existing.webhookSecretEncrypted ?? null)
        : null;

    const saved = await this.prisma.withRequestContext((tx) =>
      tx.payoutAccount.upsert({
        where: { organisationId },
        create: {
          organisationId,
          provider,
          mode: dto.mode,
          country,
          currency,
          accountName: dto.accountName?.trim() || null,
          secretKeyEncrypted,
          webhookSecretEncrypted,
          keyLast4: secretKey.slice(-4),
          status: PayoutAccountStatus.ACTIVE,
          balanceMinorUnits: balance.availableMinorUnits,
          balanceCurrency: balance.currency,
          balanceCheckedAt: now,
          createdBy: userId,
          updatedBy: userId,
        },
        update: {
          provider,
          mode: dto.mode,
          country,
          currency,
          accountName: dto.accountName?.trim() || null,
          secretKeyEncrypted,
          webhookSecretEncrypted,
          keyLast4: secretKey.slice(-4),
          status: PayoutAccountStatus.ACTIVE,
          balanceMinorUnits: balance.availableMinorUnits,
          balanceCurrency: balance.currency,
          balanceCheckedAt: now,
          updatedBy: userId,
        },
      }),
    );

    await this.audit.record({
      action: AuditAction.PAYOUT_ACCOUNT_CHANGED,
      targetType: 'payout_account',
      targetId: saved.id,
      previousValue: snapshot.existing
        ? {
            provider: snapshot.existing.provider,
            mode: snapshot.existing.mode,
            country: snapshot.existing.country,
            currency: snapshot.existing.currency,
            keyLast4: snapshot.existing.keyLast4,
            status: snapshot.existing.status,
          }
        : null,
      newValue: {
        provider,
        mode: dto.mode,
        country,
        currency,
        keyLast4: secretKey.slice(-4),
        status: PayoutAccountStatus.ACTIVE,
      },
    });

    return this.toAccountSummary(saved);
  }

  async refreshBalance(): Promise<PayoutAccountSummary> {
    const { organisationId } = this.requireContext();
    const account = await this.prisma.withRequestContext((tx) =>
      tx.payoutAccount.findUnique({ where: { organisationId } }),
    );
    if (!account) {
      throw new NotFoundException('No payout account is connected.');
    }
    if (account.status !== PayoutAccountStatus.ACTIVE) {
      throw new BadRequestException('The payout account is disconnected.');
    }

    const gateway = this.gateways.get(account.provider as PayoutProvider);
    let balance: Awaited<ReturnType<PayoutGateway['getBalance']>>;
    try {
      balance = await gateway.getBalance(
        decryptAccountNumber(account.secretKeyEncrypted),
        account.currency,
      );
    } catch (error) {
      throw new BadRequestException(
        `Could not refresh the ${account.provider} balance: ${this.errorMessage(error)}`,
      );
    }

    const updated = await this.prisma.withRequestContext((tx) =>
      tx.payoutAccount.update({
        where: { organisationId },
        data: {
          balanceMinorUnits: balance.availableMinorUnits,
          balanceCurrency: balance.currency,
          balanceCheckedAt: new Date(),
        },
      }),
    );
    return this.toAccountSummary(updated);
  }

  async disconnectAccount(): Promise<void> {
    const { organisationId, userId } = this.requireContext();
    const account = await this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payoutAccount.findUnique({
        where: { organisationId },
      });
      if (!row) throw new NotFoundException('No payout account is connected.');
      const activePayouts = await tx.payout.count({
        where: {
          organisationId,
          status: { in: [PayoutStatus.QUEUED, PayoutStatus.PROCESSING] },
        },
      });
      if (activePayouts > 0) {
        throw new ConflictException(
          'Wait for in-flight payouts to finish before disconnecting.',
        );
      }
      return row;
    });

    await this.prisma.withRequestContext((tx) =>
      tx.payoutAccount.update({
        where: { organisationId },
        data: {
          status: PayoutAccountStatus.DISABLED,
          updatedBy: userId,
        },
      }),
    );
    await this.audit.record({
      action: AuditAction.PAYOUT_ACCOUNT_CHANGED,
      targetType: 'payout_account',
      targetId: account.id,
      previousValue: {
        provider: account.provider,
        status: account.status,
        keyLast4: account.keyLast4,
      },
      newValue: { status: PayoutAccountStatus.DISABLED },
    });
  }

  async getBatchPayouts(batchId: string): Promise<PayoutBatchResult> {
    this.requireContext();
    return this.getBatchResult(batchId);
  }

  async initiateBatch(batchId: string): Promise<PayoutBatchResult> {
    const { organisationId, userId } = this.requireContext();
    const prepared = await this.prepareBatch(batchId);

    await this.audit.record({
      action: AuditAction.PAYOUT_BATCH_INITIATED,
      targetType: 'payment_batch',
      targetId: prepared.batchId,
      newValue: {
        reference: prepared.batchReference,
        provider: prepared.provider,
        paymentCount: prepared.paymentCount,
        totalMinorUnits: prepared.totalMinorUnits,
        currency: prepared.currency,
      },
    });

    let secretKey: string;
    try {
      secretKey = decryptAccountNumber(prepared.secretKeyEncrypted);
    } catch {
      await this.failPreparedBatch(
        organisationId,
        prepared.payouts.map((payout) => payout.payoutId),
        'Payout credentials could not be read. Reconnect the payout account.',
      );
      const result = await this.getBatchResult(prepared.batchId);
      await this.notifyTerminalBatch(organisationId, userId, result);
      return {
        ...result,
        message:
          'Payouts failed because the payout account credentials could not be read. Reconnect the account and try again.',
      };
    }

    const gateway = this.gateways.get(prepared.provider);
    for (const payout of prepared.payouts) {
      try {
        const transfer = await gateway.createTransfer(secretKey, {
          reference: payout.reference,
          amountMinorUnits: payout.amountMinorUnits,
          currency: prepared.currency,
          country: payout.country,
          narration: `Salary payment ${payout.reference}`,
          account: {
            accountName: payout.accountName,
            accountNumber: payout.accountNumber,
            bankCode: payout.bankCode,
            bankName: payout.bankName,
            country: payout.country,
          },
        });
        await this.persistProviderResult(
          organisationId,
          payout.payoutId,
          transfer,
        );
      } catch (error) {
        const reason = this.errorMessage(error);
        this.logger.warn(
          `Payout ${payout.reference} failed: ${reason}`,
        );
        await this.persistProviderResult(organisationId, payout.payoutId, {
          status: 'FAILED',
          failureReason: reason,
          raw: { error: reason },
        });
      }
    }

    const result = await this.getBatchResult(prepared.batchId);
    await this.notifyTerminalBatch(organisationId, userId, result);
    return result;
  }

  async handleWebhook(
    organisationId: string,
    provider: PayoutProvider,
    signature: string | undefined,
    rawBody: Buffer,
  ): Promise<{ received: true }> {
    if (!rawBody?.length) {
      throw new BadRequestException('Webhook payload is required.');
    }

    const account = await this.prisma.withContext(
      { organisationId },
      (tx) => tx.payoutAccount.findUnique({ where: { organisationId } }),
    );
    if (!account || account.provider !== provider) {
      throw new NotFoundException('Payout account not found.');
    }

    const secretKey = decryptAccountNumber(account.secretKeyEncrypted);
    if (provider === PayoutProvider.PAYSTACK) {
      if (!verifyPaystackSignature(rawBody, signature, secretKey)) {
        throw new UnauthorizedException('Invalid Paystack webhook signature.');
      }
    } else {
      if (!account.webhookSecretEncrypted) {
        throw new BadRequestException(
          'Flutterwave webhook secret is not configured.',
        );
      }
      if (
        !verifyFlutterwaveHash(
          signature,
          decryptAccountNumber(account.webhookSecretEncrypted),
        )
      ) {
        throw new UnauthorizedException('Invalid Flutterwave webhook hash.');
      }
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('Webhook payload is not valid JSON.');
    }

    const gateway = this.gateways.get(provider);
    const event = gateway.parseWebhook(payload);
    if (!event) return { received: true };

    const eventId = await this.reserveWebhookEvent(
      organisationId,
      provider,
      event,
      payload,
    );
    if (!eventId) return { received: true };

    const payout = await this.prisma.withContext(
      { organisationId },
      (tx) =>
        tx.payout.findFirst({
          where: { provider, reference: event.reference },
        }),
    );
    if (!payout) {
      await this.markWebhookProcessed(organisationId, eventId);
      return { received: true };
    }

    if (
      (event.amountMinorUnits !== undefined &&
        event.amountMinorUnits !== payout.amountMinorUnits) ||
      (event.currency && event.currency !== payout.currency)
    ) {
      this.logger.error(
        `Ignoring ${provider} webhook for ${event.reference}: amount/currency does not match the payout.`,
      );
      await this.markWebhookProcessed(organisationId, eventId);
      return { received: true };
    }

    let result: TransferResult = {
      status: this.toTransferStatus(event.status),
      providerTransferId: event.providerTransferId,
      failureReason: event.failureReason,
      raw: event.raw,
    };
    if (event.status !== PayoutStatus.PROCESSING) {
      try {
        const verified = await gateway.verifyTransfer(secretKey, {
          reference: event.reference,
          providerTransferId: payout.providerTransferId ?? undefined,
        });
        if (verified.status !== 'PROCESSING') {
          result = verified;
        }
      } catch (error) {
        this.logger.warn(
          `Could not verify ${provider} ${event.reference} after webhook: ${this.errorMessage(error)}`,
        );
      }
    }

    await this.persistProviderResult(organisationId, payout.id, result);
    await this.markWebhookProcessed(organisationId, eventId);
    return { received: true };
  }

  private async prepareBatch(batchId: string): Promise<PreparedBatch> {
    return this.prisma.withRequestContext(async (tx) => {
      const { organisationId } = this.requireContext();
      const batch = await tx.paymentBatch.findFirst({
        where: { id: batchId },
        include: { payments: true },
      });
      if (!batch) throw new NotFoundException('Payment batch not found');
      if (batch.status !== PaymentBatchStatus.APPROVED) {
        throw new ConflictException(
          'Only an approved payment batch can be paid out.',
        );
      }
      if (!batch.payments.length) {
        throw new BadRequestException('This batch has no payments.');
      }
      if (batch.totalMinorUnits <= 0) {
        throw new BadRequestException('This batch has no payable amount.');
      }
      if (
        batch.payments.some(
          (payment) => payment.status !== PaymentStatus.APPROVED,
        )
      ) {
        throw new ConflictException(
          'Every payment in this batch must be approved before payout.',
        );
      }

      const account = await tx.payoutAccount.findUnique({
        where: { organisationId },
      });
      if (!account || account.status !== PayoutAccountStatus.ACTIVE) {
        throw new BadRequestException(
          'Connect an active payout account before paying this batch.',
        );
      }
      if (account.currency !== batch.currency) {
        throw new BadRequestException(
          `The payout account pays in ${account.currency}, but this batch is in ${batch.currency}.`,
        );
      }
      if (
        !providerSupportsCurrency(
          account.provider as PayoutProvider,
          batch.currency,
        )
      ) {
        throw new BadRequestException(
          `${account.provider} does not support ${batch.currency} payouts.`,
        );
      }
      if (
        account.balanceCurrency &&
        account.balanceCurrency !== batch.currency
      ) {
        throw new BadRequestException(
          `The last payout balance was reported in ${account.balanceCurrency}. Refresh the balance and try again.`,
        );
      }
      if (account.balanceMinorUnits === null) {
        throw new BadRequestException(
          'Refresh the payout account balance before paying this batch.',
        );
      }
      if (account.balanceMinorUnits < batch.totalMinorUnits) {
        throw new BadRequestException(
          `The payout account has ${account.balanceMinorUnits} ${batch.currency} minor units available, but this batch needs ${batch.totalMinorUnits}. Top up the provider balance or refresh it and try again.`,
        );
      }

      const existingPayouts = await tx.payout.count({
        where: { paymentBatchId: batch.id },
      });
      if (existingPayouts > 0) {
        throw new ConflictException(
          'Payout has already been initiated for this batch.',
        );
      }

      const workerIds = batch.payments.map((payment) => payment.workerId);
      const [workers, bankAccounts] = await Promise.all([
        tx.worker.findMany({
          where: { id: { in: workerIds } },
          select: { id: true, firstName: true, lastName: true },
        }),
        tx.bankAccount.findMany({
          where: { workerId: { in: workerIds } },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        }),
      ]);
      const workerById = new Map(workers.map((worker) => [worker.id, worker]));
      const accountByWorker = new Map<
        string,
        (typeof bankAccounts)[number]
      >();
      for (const bankAccount of bankAccounts) {
        if (!accountByWorker.has(bankAccount.workerId)) {
          accountByWorker.set(bankAccount.workerId, bankAccount);
        }
      }

      const missing: string[] = [];
      const pendingReview: string[] = [];
      const preparedPayouts: PreparedPayout[] = [];
      for (const payment of batch.payments) {
        const worker = workerById.get(payment.workerId);
        const name = worker
          ? `${worker.firstName} ${worker.lastName}`.trim()
          : payment.workerId;
        const bankAccount = accountByWorker.get(payment.workerId);
        if (!bankAccount) {
          missing.push(name);
          continue;
        }
        if (bankAccount.requiresPayrollReview) {
          pendingReview.push(name);
          continue;
        }

        let accountNumber: string;
        try {
          accountNumber = decryptAccountNumber(
            bankAccount.accountNumberEncrypted,
          );
        } catch {
          throw new BadRequestException(
            `Bank details for ${name} could not be read. Update the worker's bank account.`,
          );
        }

        if (!bankAccount.bankCode?.trim() || !accountNumber.trim()) {
          missing.push(name);
          continue;
        }

        preparedPayouts.push({
          payoutId: '',
          reference: payment.reference,
          amountMinorUnits: payment.amountMinorUnits,
          currency: payment.currency,
          accountName: bankAccount.accountName,
          accountNumber,
          bankCode: bankAccount.bankCode.trim(),
          bankName: bankAccount.bankName,
          country: account.country,
          workerName: name,
        });
      }

      if (missing.length) {
        throw new BadRequestException(
          `Missing primary bank details for: ${missing.join(', ')}.`,
        );
      }
      if (pendingReview.length) {
        throw new BadRequestException(
          `Bank details need payroll review for: ${pendingReview.join(', ')}.`,
        );
      }

      const now = new Date();
      const claimed = await tx.paymentBatch.updateMany({
        where: { id: batch.id, status: PaymentBatchStatus.APPROVED },
        data: {
          status: PaymentBatchStatus.PROCESSING,
          payoutAccountId: account.id,
          payoutStartedAt: now,
          payoutCompletedAt: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          'This batch is already being paid out.',
        );
      }
      await tx.payment.updateMany({
        where: {
          paymentBatchId: batch.id,
          status: PaymentStatus.APPROVED,
        },
        data: { status: PaymentStatus.PROCESSING },
      });

      const paymentByReference = new Map(
        batch.payments.map((payment) => [payment.reference, payment]),
      );
      for (const preparedPayout of preparedPayouts) {
        const payment = paymentByReference.get(preparedPayout.reference);
        if (!payment) {
          throw new InternalServerErrorException(
            'Could not match a payout to its payment.',
          );
        }
        const created = await tx.payout.create({
          data: {
            organisationId,
            payoutAccountId: account.id,
            paymentBatchId: batch.id,
            paymentId: payment.id,
            workerId: payment.workerId,
            provider: account.provider,
            status: PayoutStatus.QUEUED,
            amountMinorUnits: preparedPayout.amountMinorUnits,
            currency: preparedPayout.currency,
            reference: preparedPayout.reference,
            recipientName: preparedPayout.accountName,
            bankName: preparedPayout.bankName,
            bankCode: preparedPayout.bankCode,
            accountNumberMasked: `****${preparedPayout.accountNumber.slice(-4)}`,
            requestedAt: now,
          },
        });
        preparedPayout.payoutId = created.id;
      }

      return {
        batchId: batch.id,
        batchReference: batch.reference,
        paymentCount: batch.paymentCount,
        totalMinorUnits: batch.totalMinorUnits,
        currency: batch.currency,
        provider: account.provider as PayoutProvider,
        secretKeyEncrypted: account.secretKeyEncrypted,
        payouts: preparedPayouts,
      };
    });
  }

  private async persistProviderResult(
    organisationId: string,
    payoutId: string,
    result: TransferResult,
  ): Promise<void> {
    await this.prisma.withContext({ organisationId }, async (tx) => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new NotFoundException('Payout not found');

      const current = payout.status as PayoutStatus;
      const next = result.status as PayoutStatus;
      if (current === PayoutStatus.REVERSED) return;
      if (current === PayoutStatus.PAID && next !== PayoutStatus.REVERSED) {
        return;
      }
      if (current === PayoutStatus.FAILED && next === PayoutStatus.PROCESSING) {
        return;
      }
      if (current === next && !result.failureReason) return;

      const now = new Date();
      const terminal = TERMINAL_PAYOUT_STATUSES.has(next);
      await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: next,
          providerTransferId:
            result.providerTransferId ?? payout.providerTransferId,
          recipientCode: result.recipientCode ?? payout.recipientCode,
          failureReason:
            next === PayoutStatus.FAILED || next === PayoutStatus.REVERSED
              ? result.failureReason?.slice(0, 500) ?? 'Payout failed.'
              : null,
          providerPayload: result.raw as Prisma.InputJsonValue,
          completedAt: terminal ? now : null,
        },
      });

      const paymentStatus = PAYOUT_STATUS_TO_PAYMENT[next];
      await tx.payment.update({
        where: { id: payout.paymentId },
        data: {
          status: paymentStatus,
          processedAt: terminal ? now : payout.completedAt ?? null,
        },
      });

      await this.recalculateBatch(tx, payout.paymentBatchId, now);
    });
  }

  private async recalculateBatch(
    tx: Prisma.TransactionClient,
    batchId: string,
    now: Date,
  ): Promise<void> {
    const payouts = await tx.payout.findMany({
      where: { paymentBatchId: batchId },
      select: { status: true },
    });
    if (!payouts.length) return;

    let status: PaymentBatchStatus;
    if (
      payouts.some(
        (payout) =>
          payout.status === PayoutStatus.QUEUED ||
          payout.status === PayoutStatus.PROCESSING,
      )
    ) {
      status = PaymentBatchStatus.PROCESSING;
    } else if (payouts.every((payout) => payout.status === PayoutStatus.PAID)) {
      status = PaymentBatchStatus.PAID;
    } else if (payouts.some((payout) => payout.status === PayoutStatus.PAID)) {
      status = PaymentBatchStatus.PARTIALLY_PAID;
    } else {
      status = PaymentBatchStatus.FAILED;
    }

    const terminal = status !== PaymentBatchStatus.PROCESSING;
    await tx.paymentBatch.update({
      where: { id: batchId },
      data: {
        status,
        payoutCompletedAt: terminal ? now : null,
        paidAt: status === PaymentBatchStatus.PAID ? now : null,
      },
    });
  }

  private async failPreparedBatch(
    organisationId: string,
    payoutIds: string[],
    reason: string,
  ): Promise<void> {
    await this.prisma.withContext({ organisationId }, async (tx) => {
      for (const payoutId of payoutIds) {
        const payout = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!payout) continue;
        await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: PayoutStatus.FAILED,
            failureReason: reason,
            completedAt: new Date(),
          },
        });
        await tx.payment.update({
          where: { id: payout.paymentId },
          data: { status: PaymentStatus.FAILED, processedAt: new Date() },
        });
        await this.recalculateBatch(tx, payout.paymentBatchId, new Date());
      }
    });
  }

  private async getBatchResult(batchId: string): Promise<PayoutBatchResult> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const batch = await tx.paymentBatch.findFirst({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Payment batch not found');
      const payouts = await tx.payout.findMany({
        where: { paymentBatchId: batch.id },
        orderBy: { createdAt: 'asc' },
      });
      const mapped = payouts.map(toPayoutSummary);
      const status = batch.status as PaymentBatchStatus;
      const paid = mapped.filter(
        (payout) => payout.status === PayoutStatus.PAID,
      ).length;
      const failed = mapped.filter(
        (payout) =>
          payout.status === PayoutStatus.FAILED ||
          payout.status === PayoutStatus.REVERSED,
      ).length;
      let message: string;
      if (status === PaymentBatchStatus.PAID) {
        message = `All ${mapped.length} payouts were sent successfully.`;
      } else if (status === PaymentBatchStatus.PARTIALLY_PAID) {
        message = `${paid} of ${mapped.length} payouts succeeded; ${failed} failed.`;
      } else if (status === PaymentBatchStatus.FAILED) {
        message = `All ${mapped.length} payouts failed. Check the batch details and your provider balance.`;
      } else {
        message = `${mapped.length} payouts are being processed by the payout provider.`;
      }
      return {
        batch: toPaymentBatch(batch),
        payouts: mapped,
        message,
      };
    });
  }

  private async reserveWebhookEvent(
    organisationId: string,
    provider: PayoutProvider,
    event: WebhookTransferUpdate,
    payload: unknown,
  ): Promise<string | null> {
    return this.prisma.withContext({ organisationId }, async (tx) => {
      const existing = await tx.payoutWebhookEvent.findUnique({
        where: { eventKey: event.eventKey },
      });
      if (existing?.processedAt) return null;
      if (existing) return existing.id;
      try {
        const created = await tx.payoutWebhookEvent.create({
          data: {
            organisationId,
            provider,
            eventKey: event.eventKey,
            eventType: event.eventType,
            reference: event.reference,
            payload: payload as Prisma.InputJsonValue,
          },
        });
        return created.id;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return null;
        }
        throw error;
      }
    });
  }

  private async markWebhookProcessed(
    organisationId: string,
    eventId: string,
  ): Promise<void> {
    await this.prisma.withContext({ organisationId }, (tx) =>
      tx.payoutWebhookEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date() },
      }),
    );
  }

  private async notifyTerminalBatch(
    organisationId: string,
    actorUserId: string,
    result: PayoutBatchResult,
  ): Promise<void> {
    const status = result.batch.status;
    if (
      status !== PaymentBatchStatus.PAID &&
      status !== PaymentBatchStatus.PARTIALLY_PAID &&
      status !== PaymentBatchStatus.FAILED
    ) {
      return;
    }
    const paid = status === PaymentBatchStatus.PAID;
    try {
      const recipients = await this.prisma.withContext(
        { organisationId, userId: actorUserId },
        (tx) =>
          tx.membership.findMany({
            where: {
              organisationId,
              role: {
                in: [
                  SystemRole.PAYROLL_ADMINISTRATOR,
                  SystemRole.FINANCE_APPROVER,
                ],
              },
              isActive: true,
            },
            select: { userId: true },
          }),
      );
      await this.notifications.emit({
        organisationId,
        actorUserId,
        intents: recipients.map((recipient) => ({
          recipientUserId: recipient.userId,
          type: paid
            ? NotificationType.PAYMENT_BATCH_PAID
            : NotificationType.PAYMENT_FAILED,
          title: paid ? 'Payouts completed' : 'Payouts need attention',
          body: result.message,
          link: '/payroll',
          metadata: {
            paymentBatchId: result.batch.id,
            reference: result.batch.reference,
          },
        })),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to dispatch payout notifications: ${this.errorMessage(error)}`,
      );
    }
  }

  private toAccountSummary(row: {
    organisationId: string;
    provider: string;
    mode: string;
    country: string;
    currency: string;
    accountName: string | null;
    status: string;
    keyLast4: string;
    webhookSecretEncrypted: string | null;
    balanceMinorUnits: number | null;
    balanceCurrency: string | null;
    balanceCheckedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): PayoutAccountSummary {
    const provider = row.provider as PayoutProvider;
    return {
      provider,
      mode: row.mode as PayoutAccountMode,
      country: row.country,
      currency: row.currency,
      accountName: row.accountName ?? undefined,
      status: row.status as PayoutAccountStatus,
      keyLast4: row.keyLast4,
      webhookConfigured: Boolean(row.webhookSecretEncrypted),
      webhookUrl: this.webhookUrl(row.organisationId, provider),
      balanceMinorUnits: row.balanceMinorUnits ?? undefined,
      balanceCurrency: row.balanceCurrency ?? undefined,
      balanceCheckedAt: row.balanceCheckedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private webhookUrl(
    organisationId: string,
    provider: PayoutProvider,
  ): string {
    const base = (
      this.config.get<string>('API_PUBLIC_URL') ??
      'http://localhost:3001'
    ).replace(/\/$/, '');
    const prefix = (
      this.config.get<string>('API_PREFIX') ?? 'api/v1'
    ).replace(/^\/|\/$/g, '');
    return `${base}/${prefix}/payments/webhooks/${provider.toLowerCase()}/${organisationId}`;
  }

  private toTransferStatus(status: PayoutStatus): TransferResult['status'] {
    if (status === PayoutStatus.PAID) return 'PAID';
    if (status === PayoutStatus.FAILED) return 'FAILED';
    if (status === PayoutStatus.REVERSED) return 'REVERSED';
    return 'PROCESSING';
  }

  private assertKeyMatchesMode(
    provider: PayoutProvider,
    mode: PayoutAccountMode,
    key: string,
  ): void {
    const looksTest =
      key.startsWith('sk_test_') || key.startsWith('FLWSECK_TEST');
    const looksLive =
      key.startsWith('sk_live_') || key.startsWith('FLWSECK-');
    const looksLikeProviderKey =
      provider === PayoutProvider.PAYSTACK
        ? key.startsWith('sk_test_') || key.startsWith('sk_live_')
        : key.startsWith('FLWSECK_TEST') || key.startsWith('FLWSECK-');

    if (!looksLikeProviderKey) {
      throw new BadRequestException(
        `This does not look like a ${provider} secret key.`,
      );
    }
    if (mode === PayoutAccountMode.TEST && !looksTest) {
      throw new BadRequestException(
        'Use a test secret key when the payout account is in test mode.',
      );
    }
    if (mode === PayoutAccountMode.LIVE && (!looksLive || looksTest)) {
      throw new BadRequestException(
        'Use a live secret key when the payout account is in live mode.',
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof PayoutProviderError) return error.message;
    if (error instanceof Error) return error.message;
    return 'Unknown provider error.';
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
