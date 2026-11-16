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
import { decryptAccountNumber } from '../../people/domain/bank-crypto';
import { toPaymentBatch } from '../payments.service';
import { paymentWorkerIdentity, paymentWorkerSelect, type PaymentWorker } from '../domain/payment-worker';
import { PayoutGatewayRegistry } from './payout-gateway.registry';
import {
  PayoutProviderError,
  type PayoutGateway,
  type TransferResult,
  type WebhookTransferUpdate,
} from './payout-provider';
import {
  hasFractionalMajorUnits,
  providerSupportsCurrency,
} from './payout-support';
import {
  verifyFlutterwaveHash,
  verifyPaystackSignature,
} from './payout-signature';

const TERMINAL_PAYOUT_STATUSES = new Set<PayoutStatus>([
  PayoutStatus.PAID,
  PayoutStatus.FAILED,
  PayoutStatus.REVERSED,
]);

/** Batches in these states can have their failed transfers retried. */
const RETRYABLE_BATCH_STATUSES = new Set<PaymentBatchStatus>([
  PaymentBatchStatus.FAILED,
  PaymentBatchStatus.PARTIALLY_PAID,
]);

/** Give a provider at least this long before polling for a missed webhook. */
const STALE_PAYOUT_AFTER_MS = 10 * 60 * 1000;
const RECONCILIATION_BATCH_SIZE = 100;

type PayoutResultSource =
  | 'INITIATION'
  | 'RETRY'
  | 'WEBHOOK'
  | 'RECONCILIATION';

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
  paymentId: string;
  reference: string;
  amountMinorUnits: number;
  currency: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  country: string;
  workerName: string;
  attemptCount: number;
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

interface PayoutResultChange {
  previousStatus: PayoutStatus;
  nextStatus: PayoutStatus;
  reference: string;
  workerId: string;
  amountMinorUnits: number;
  currency: string;
  failureReason?: string;
  /** Operator responsible for the batch, used when the provider drives a change. */
  responsibleUserId: string;
}

function toPayoutSummary(row: PayoutRow & { worker?: PaymentWorker | null }): PayoutSummary {
  return {
    id: row.id,
    paymentBatchId: row.paymentBatchId,
    paymentId: row.paymentId,
    workerId: row.workerId,
    ...paymentWorkerIdentity(row.worker),
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
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt?.toISOString(),
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

  /**
   * Fetch the provider's live balance immediately before paying out. The
   * cached snapshot is for display only: authorising a batch against a stale
   * figure could let an operator send money the provider account no longer has.
   * A failed refresh aborts the run rather than silently falling back.
   */
  private async refreshBalanceBeforePayout(): Promise<void> {
    const { organisationId } = this.requireContext();
    const account = await this.prisma.withRequestContext((tx) =>
      tx.payoutAccount.findUnique({ where: { organisationId } }),
    );
    if (!account || account.status !== PayoutAccountStatus.ACTIVE) return;

    let balance: Awaited<ReturnType<PayoutGateway['getBalance']>>;
    try {
      balance = await this.gateways
        .get(account.provider as PayoutProvider)
        .getBalance(
          decryptAccountNumber(account.secretKeyEncrypted),
          account.currency,
        );
    } catch (error) {
      throw new BadRequestException(
        `Could not verify the ${account.provider} balance before paying: ${this.errorMessage(error)}`,
      );
    }

    if (
      !Number.isSafeInteger(balance.availableMinorUnits) ||
      balance.availableMinorUnits < 0 ||
      balance.currency !== account.currency
    ) {
      throw new BadRequestException(
        'The provider returned an invalid payout balance.',
      );
    }

    const refreshed = await this.prisma.withContext({ organisationId }, (tx) =>
      tx.payoutAccount.updateMany({
        where: {
          organisationId,
          id: account.id,
          updatedAt: account.updatedAt,
          status: PayoutAccountStatus.ACTIVE,
        },
        data: {
          balanceMinorUnits: balance.availableMinorUnits,
          balanceCurrency: balance.currency,
          balanceCheckedAt: new Date(),
        },
      }),
    );
    if (refreshed.count !== 1) {
      throw new ConflictException('The payout account changed. Refresh and try again.');
    }
  }

  async getBatchPayouts(batchId: string): Promise<PayoutBatchResult> {
    this.requireContext();
    return this.getBatchResult(batchId);
  }

  async initiateBatch(batchId: string): Promise<PayoutBatchResult> {
    const { organisationId, userId } = this.requireContext();
    await this.refreshBalanceBeforePayout();
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
        retry: false,
      },
    });

    const credentialsOk = await this.sendPreparedPayouts(
      organisationId,
      prepared,
      'INITIATION',
    );
    const result = await this.getBatchResult(prepared.batchId);
    await this.notifyTerminalBatch(organisationId, userId, result);
    if (!credentialsOk) {
      return {
        ...result,
        message:
          'Payouts failed because the payout account credentials could not be read. Reconnect the account and try again.',
      };
    }
    return result;
  }

  /**
   * Retry every failed transfer in a terminal batch. Paid transfers are never
   * retried, and reversed transfers are left alone because money already moved
   * (or was returned) for them. Each retry reuses its payout row because
   * `paymentId` is unique, but issues a fresh provider reference.
   */
  async retryBatchPayouts(batchId: string): Promise<PayoutBatchResult> {
    const { organisationId, userId } = this.requireContext();
    await this.refreshBalanceBeforePayout();
    const prepared = await this.prepareRetry(batchId);

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
        retry: true,
      },
    });

    const credentialsOk = await this.sendPreparedPayouts(
      organisationId,
      prepared,
      'RETRY',
    );
    const result = await this.getBatchResult(prepared.batchId);
    await this.notifyTerminalBatch(organisationId, userId, result);
    if (!credentialsOk) {
      return {
        ...result,
        message:
          'Retry failed because the payout account credentials could not be read. Reconnect the account and try again.',
      };
    }
    return result;
  }

  private async sendPreparedPayouts(
    organisationId: string,
    prepared: PreparedBatch,
    source: 'INITIATION' | 'RETRY',
  ): Promise<boolean> {
    let secretKey: string;
    try {
      secretKey = decryptAccountNumber(prepared.secretKeyEncrypted);
    } catch {
      await this.failPreparedBatch(
        organisationId,
        prepared.payouts.map((payout) => payout.payoutId),
        'Payout credentials could not be read. Reconnect the payout account.',
      );
      return false;
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
          source,
        );
      } catch (error) {
        const reason = this.errorMessage(error);
        // A network timeout or provider 5xx does not prove the transfer was
        // rejected: it may have been accepted and the response lost. Recording
        // it as FAILED would let a retry send the same salary twice, so keep it
        // PROCESSING and let reconciliation verify the provider's view.
        const indeterminate = this.isIndeterminateFailure(error);
        this.logger.warn(
          `Payout ${payout.reference} ${
            indeterminate ? 'could not be confirmed' : 'failed'
          }: ${reason}`,
        );
        await this.persistProviderResult(
          organisationId,
          payout.payoutId,
          indeterminate
            ? {
                status: 'PROCESSING',
                raw: { error: reason, indeterminate: true },
              }
            : {
                status: 'FAILED',
                failureReason: reason,
                raw: { error: reason },
              },
          source,
        );
      }
    }
    return true;
  }

  /**
   * Poll the provider for transfers that have not reached a terminal state.
   * Webhooks are best-effort; this closes the gap when one is missed. Runs in
   * the caller's organisation request context (scheduler or authenticated API).
   */
  async reconcileStalePayouts(): Promise<{
    checked: number;
    updated: number;
    errors: number;
  }> {
    const { organisationId } = this.requireContext();
    const staleBefore = new Date(Date.now() - STALE_PAYOUT_AFTER_MS);
    const stale = await this.prisma.withRequestContext((tx) =>
      tx.payout.findMany({
        where: {
          status: { in: [PayoutStatus.QUEUED, PayoutStatus.PROCESSING] },
          requestedAt: { lt: staleBefore },
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: staleBefore } },
          ],
        },
        include: { payoutAccount: true },
        orderBy: { requestedAt: 'asc' },
        take: RECONCILIATION_BATCH_SIZE,
      }),
    );

    let updated = 0;
    let errors = 0;
    for (const payout of stale) {
      const account = payout.payoutAccount;
      if (!account || account.status !== PayoutAccountStatus.ACTIVE) {
        errors += 1;
        await this.touchPayout(organisationId, payout.id);
        this.logger.warn(
          `Skipping reconciliation for ${payout.reference}: payout account is unavailable.`,
        );
        continue;
      }

      let secretKey: string;
      try {
        secretKey = decryptAccountNumber(account.secretKeyEncrypted);
      } catch {
        errors += 1;
        await this.touchPayout(organisationId, payout.id);
        this.logger.warn(
          `Skipping reconciliation for ${payout.reference}: payout credentials could not be read.`,
        );
        continue;
      }

      try {
        const result = await this.gateways
          .get(payout.provider as PayoutProvider)
          .verifyTransfer(secretKey, {
            reference: payout.reference,
            providerTransferId: payout.providerTransferId ?? undefined,
          });
        await this.persistProviderResult(
          organisationId,
          payout.id,
          result,
          'RECONCILIATION',
        );
        if (
          result.status === 'PAID' ||
          result.status === 'FAILED' ||
          result.status === 'REVERSED'
        ) {
          updated += 1;
        }
      } catch (error) {
        errors += 1;
        await this.touchPayout(organisationId, payout.id);
        const reason = this.errorMessage(error);
        // A definite "not found" well after the attempt means the provider
        // never received the transfer. Allowing a retry is then safe; other
        // lookup failures leave the payout PROCESSING for the next run.
        if (
          error instanceof PayoutProviderError &&
          error.statusCode === 404
        ) {
          await this.persistProviderResult(
            organisationId,
            payout.id,
            {
              status: 'FAILED',
              failureReason:
                'The provider could not find this transfer. It can be retried.',
              raw: { error: reason },
            },
            'RECONCILIATION',
          );
          updated += 1;
        }
        this.logger.warn(
          `Could not reconcile ${payout.reference}: ${reason}`,
        );
      }
    }

    return { checked: stale.length, updated, errors };
  }

  private async touchPayout(
    organisationId: string,
    payoutId: string,
  ): Promise<void> {
    await this.prisma.withContext({ organisationId }, (tx) =>
      tx.payout.update({
        where: { id: payoutId },
        data: { lastCheckedAt: new Date() },
      }),
    );
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

    await this.persistProviderResult(
      organisationId,
      payout.id,
      result,
      'WEBHOOK',
    );
    await this.markWebhookProcessed(organisationId, eventId);
    return { received: true };
  }

  /**
   * Choose the bank identifier the active provider expects. Providers publish
   * different code tables, so an explicit provider code wins; the generic
   * CBN/NIBSS code is the fallback for accounts that predate this field.
   */
  private providerBankCode(
    provider: PayoutProvider,
    account: {
      bankCode: string;
      paystackBankCode: string | null;
      flutterwaveBankCode: string | null;
    },
  ): string | null {
    const providerCode =
      provider === PayoutProvider.PAYSTACK
        ? account.paystackBankCode
        : account.flutterwaveBankCode;
    return providerCode?.trim() || account.bankCode?.trim() || null;
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
      const fractional: string[] = [];
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

        const bankCode = this.providerBankCode(
          account.provider as PayoutProvider,
          bankAccount,
        );
        if (!bankCode || !accountNumber.trim()) {
          missing.push(name);
          continue;
        }
        if (hasFractionalMajorUnits(payment.amountMinorUnits, payment.currency)) {
          fractional.push(name);
          continue;
        }

        preparedPayouts.push({
          payoutId: '',
          paymentId: payment.id,
          reference: payment.reference,
          amountMinorUnits: payment.amountMinorUnits,
          currency: payment.currency,
          accountName: bankAccount.accountName,
          accountNumber,
          bankCode,
          bankName: bankAccount.bankName,
          country: account.country,
          workerName: name,
          attemptCount: 1,
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
      if (fractional.length) {
        throw new BadRequestException(
          `${batch.currency} has no minor units, so these payments must be whole amounts: ${fractional.join(', ')}.`,
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
            attemptCount: preparedPayout.attemptCount,
            lastAttemptAt: now,
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

  /**
   * Re-arm the failed transfers in a terminal batch. Only `FAILED` payouts are
   * retryable; `PAID` and `REVERSED` payouts are excluded so money is never sent
   * twice. Every retry increments `attemptCount` and gets a unique provider
   * reference derived from the original payment reference.
   */
  private async prepareRetry(batchId: string): Promise<PreparedBatch> {
    return this.prisma.withRequestContext(async (tx) => {
      const { organisationId } = this.requireContext();
      const batch = await tx.paymentBatch.findFirst({
        where: { id: batchId },
        include: { payments: { include: { payout: true } } },
      });
      if (!batch) throw new NotFoundException('Payment batch not found');
      if (!RETRYABLE_BATCH_STATUSES.has(batch.status as PaymentBatchStatus)) {
        throw new ConflictException(
          'Only a failed or partially paid batch can be retried.',
        );
      }

      const retryable = batch.payments.filter(
        (payment) => payment.payout?.status === PayoutStatus.FAILED,
      );
      if (!retryable.length) {
        throw new BadRequestException(
          'This batch has no failed payouts to retry. Reversed transfers must be handled manually.',
        );
      }

      const retryTotalMinorUnits = retryable.reduce(
        (sum, payment) => sum + payment.amountMinorUnits,
        0,
      );
      if (retryTotalMinorUnits <= 0) {
        throw new BadRequestException(
          'This batch has no payable amount to retry.',
        );
      }

      const account = await tx.payoutAccount.findUnique({
        where: { organisationId },
      });
      if (!account || account.status !== PayoutAccountStatus.ACTIVE) {
        throw new BadRequestException(
          'Connect an active payout account before retrying this batch.',
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
          'Refresh the payout account balance before retrying this batch.',
        );
      }
      if (account.balanceMinorUnits < retryTotalMinorUnits) {
        throw new BadRequestException(
          `The payout account has ${account.balanceMinorUnits} ${batch.currency} minor units available, but this retry needs ${retryTotalMinorUnits}. Top up the provider balance or refresh it and try again.`,
        );
      }

      const workerIds = retryable.map((payment) => payment.workerId);
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
      const fractional: string[] = [];
      const preparedPayouts: PreparedPayout[] = [];
      for (const payment of retryable) {
        const payout = payment.payout;
        if (!payout) continue;
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

        const bankCode = this.providerBankCode(
          account.provider as PayoutProvider,
          bankAccount,
        );
        if (!bankCode || !accountNumber.trim()) {
          missing.push(name);
          continue;
        }
        if (hasFractionalMajorUnits(payment.amountMinorUnits, payment.currency)) {
          fractional.push(name);
          continue;
        }

        const nextAttempt = payout.attemptCount + 1;
        preparedPayouts.push({
          payoutId: payout.id,
          paymentId: payment.id,
          reference: this.retryReference(payment.reference, nextAttempt),
          amountMinorUnits: payment.amountMinorUnits,
          currency: payment.currency,
          accountName: bankAccount.accountName,
          accountNumber,
          bankCode,
          bankName: bankAccount.bankName,
          country: account.country,
          workerName: name,
          attemptCount: nextAttempt,
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
      if (fractional.length) {
        throw new BadRequestException(
          `${batch.currency} has no minor units, so these payments must be whole amounts: ${fractional.join(', ')}.`,
        );
      }

      const now = new Date();
      const claimed = await tx.paymentBatch.updateMany({
        where: {
          id: batch.id,
          status: {
            in: [
              PaymentBatchStatus.FAILED,
              PaymentBatchStatus.PARTIALLY_PAID,
            ],
          },
        },
        data: {
          status: PaymentBatchStatus.PROCESSING,
          payoutAccountId: account.id,
          payoutStartedAt: batch.payoutStartedAt ?? now,
          payoutCompletedAt: null,
          paidAt: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          'This batch is already being paid out.',
        );
      }

      for (const preparedPayout of preparedPayouts) {
        await tx.payout.update({
          where: { id: preparedPayout.payoutId },
          data: {
            provider: account.provider,
            status: PayoutStatus.QUEUED,
            reference: preparedPayout.reference,
            attemptCount: preparedPayout.attemptCount,
            lastAttemptAt: now,
            lastCheckedAt: null,
            providerTransferId: null,
            recipientCode: null,
            recipientName: preparedPayout.accountName,
            bankName: preparedPayout.bankName,
            bankCode: preparedPayout.bankCode,
            accountNumberMasked: `****${preparedPayout.accountNumber.slice(-4)}`,
            failureReason: null,
            providerPayload: Prisma.DbNull,
            completedAt: null,
          },
        });
        await tx.payment.update({
          where: { id: preparedPayout.paymentId },
          data: { status: PaymentStatus.PROCESSING, processedAt: null },
        });
      }

      return {
        batchId: batch.id,
        batchReference: batch.reference,
        paymentCount: preparedPayouts.length,
        totalMinorUnits: retryTotalMinorUnits,
        currency: batch.currency,
        provider: account.provider as PayoutProvider,
        secretKeyEncrypted: account.secretKeyEncrypted,
        payouts: preparedPayouts,
      };
    });
  }

  private retryReference(baseReference: string, attemptCount: number): string {
    return `${baseReference}-R${attemptCount}`;
  }

  private async persistProviderResult(
    organisationId: string,
    payoutId: string,
    result: TransferResult,
    source: PayoutResultSource,
  ): Promise<void> {
    const change = await this.prisma.withContext(
      { organisationId },
      async (tx) => {
        const payout = await tx.payout.findUnique({
          where: { id: payoutId },
          include: {
            paymentBatch: {
              select: { approvedBy: true, createdBy: true },
            },
          },
        });
        if (!payout) throw new NotFoundException('Payout not found');

        const current = payout.status as PayoutStatus;
        const next = result.status as PayoutStatus;
        if (current === PayoutStatus.REVERSED) return null;
        if (current === PayoutStatus.PAID && next !== PayoutStatus.REVERSED) {
          return null;
        }
        if (current === PayoutStatus.FAILED && next === PayoutStatus.PROCESSING) {
          return null;
        }

        const now = new Date();
        const terminal = TERMINAL_PAYOUT_STATUSES.has(next);
        if (current === next && !result.failureReason) {
          await tx.payout.update({
            where: { id: payout.id },
            data: { lastCheckedAt: now },
          });
          return null;
        }

        const failureReason =
          next === PayoutStatus.FAILED || next === PayoutStatus.REVERSED
            ? (result.failureReason?.slice(0, 500) ?? 'Payout failed.')
            : null;

        await tx.payout.update({
          where: { id: payout.id },
          data: {
            status: next,
            providerTransferId:
              result.providerTransferId ?? payout.providerTransferId,
            recipientCode: result.recipientCode ?? payout.recipientCode,
            failureReason,
            providerPayload: result.raw as Prisma.InputJsonValue,
            completedAt: terminal ? now : null,
            lastCheckedAt: now,
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

        return {
          previousStatus: current,
          nextStatus: next,
          reference: payout.reference,
          workerId: payout.workerId,
          amountMinorUnits: payout.amountMinorUnits,
          currency: payout.currency,
          failureReason: failureReason ?? undefined,
          responsibleUserId:
            payout.paymentBatch.approvedBy ?? payout.paymentBatch.createdBy,
        } satisfies PayoutResultChange;
      },
    );

    if (!change) return;

    // Provider-driven changes (webhook/reconciliation) are attributed to the
    // operator responsible for the batch; operator actions use the live actor.
    const actingUserId =
      source === 'INITIATION' || source === 'RETRY'
        ? (getRequestContext()?.userId ?? change.responsibleUserId)
        : change.responsibleUserId;

    await this.audit.record({
      action: AuditAction.PAYOUT_STATUS_CHANGED,
      organisationId,
      actorId: actingUserId,
      targetType: 'payout',
      targetId: payoutId,
      previousValue: { status: change.previousStatus },
      newValue: {
        status: change.nextStatus,
        reference: change.reference,
        workerId: change.workerId,
        amountMinorUnits: change.amountMinorUnits,
        currency: change.currency,
        failureReason: change.failureReason ?? null,
        source,
      },
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
    for (const payoutId of payoutIds) {
      await this.persistProviderResult(
        organisationId,
        payoutId,
        {
          status: 'FAILED',
          failureReason: reason,
          raw: { error: reason },
        },
        'INITIATION',
      );
    }
  }

  private async getBatchResult(batchId: string): Promise<PayoutBatchResult> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const batch = await tx.paymentBatch.findFirst({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('Payment batch not found');
      const payouts = await tx.payout.findMany({
        where: { paymentBatchId: batch.id },
        include: { worker: { select: paymentWorkerSelect } },
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

  private errorMessage(error: unknown): string {
    if (error instanceof PayoutProviderError) return error.message;
    if (error instanceof Error) return error.message;
    return 'Unknown provider error.';
  }

  /**
   * True when we cannot tell whether the provider accepted the transfer, so it
   * must be reconciled rather than retried. Explicit 4xx rejections and
   * provider-reported failures are safe to mark FAILED; timeouts, 5xx/429 and
   * unexpected responses are not.
   */
  private isIndeterminateFailure(error: unknown): boolean {
    if (!(error instanceof PayoutProviderError)) return true;
    if (error.retriable) return true;
    return error.statusCode === undefined;
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
