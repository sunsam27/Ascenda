// ─────────────────────────────────────────────────────────────────────────────
// BILLING SERVICE — subscription checkout
//
// Initialises and verifies payments via Paystack and Flutterwave, then asks the
// RegistrationsService to provision the workspace. Confirmation happens in two
// independent, idempotent ways: the browser-return verify endpoint and the
// provider webhook. Money is stored in minor units; gateways that expect major
// units (Flutterwave) are converted at the edge.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentProvider as DbPaymentProvider,
  type Registration,
} from '@ascenda/db';
import {
  PaymentProvider,
  SubscriptionStatus,
  type BillingSummary,
  type CheckoutSession,
  type PlanSummary,
  type TransactionStatus,
} from '@ascenda/types';
import { createHmac, randomUUID } from 'node:crypto';
import { getRequestContext } from '../../common/context/request-context';
import { safeEqualHex, safeEqualString, toMinorUnits } from './money.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toPlanSummary } from '../plans/plans.service';
import {
  RegistrationsService,
  type ProvisionedWorkspace,
} from '../registrations/registrations.service';
import { VerifyPaymentDto } from './dto/checkout.dto';

const PAYSTACK_BASE = 'https://api.paystack.co';
const FLUTTERWAVE_BASE = 'https://api.flutterwave.com/v3';

export interface PaymentOutcome {
  status: 'COMPLETED' | 'FAILED' | 'PENDING';
  completed: boolean;
  redirectTo?: string;
  workspace?: ProvisionedWorkspace;
  plan?: PlanSummary;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly registrations: RegistrationsService,
  ) {}

  /** Authenticated: current subscription + most recent charge attempts. */
  async summary(): Promise<BillingSummary> {
    const ctx = getRequestContext();
    const organisationId = ctx?.organisationId;
    if (!organisationId) {
      throw new UnauthorizedException(
        'A workspace organisation context is required',
      );
    }

    const subscription = await this.prisma.withRequestContext((tx) =>
      tx.subscription.findUnique({
        where: { organisationId },
        include: { plan: true },
      }),
    );

    const recentTransactions = await this.prisma.billingTransaction.findMany({
      where: { organisationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      plan: subscription?.plan ? toPlanSummary(subscription.plan) : null,
      status: (subscription?.status ?? 'NONE') as unknown as BillingSummary['status'],
      provider: (subscription?.provider ?? PaymentProvider.NONE) as unknown as BillingSummary['provider'],
      currentPeriodStart:
        subscription?.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
      recentTransactions: recentTransactions.map((t) => ({
        reference: t.reference,
        provider: t.provider as unknown as PaymentProvider,
        amountMinorUnits: t.amountMinorUnits,
        currency: t.currency,
        status: t.status as unknown as TransactionStatus,
        paidAt: t.paidAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  /** Public: create a hosted checkout session for a verified paid signup. */
  async initialize(
    registrationId: string,
    provider: PaymentProvider,
  ): Promise<CheckoutSession> {
    if (
      provider !== PaymentProvider.PAYSTACK &&
      provider !== PaymentProvider.FLUTTERWAVE
    ) {
      throw new BadRequestException('Unsupported payment provider');
    }

    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });
    if (!registration) {
      throw new NotFoundException('Registration not found');
    }
    if (registration.status === 'COMPLETED') {
      throw new BadRequestException('This workspace has already been created');
    }
    if (registration.status !== 'VERIFIED') {
      throw new BadRequestException(
        'Verify your email before paying for your workspace',
      );
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: registration.planId },
    });
    if (!plan || !plan.isActive) {
      throw new BadRequestException('The selected plan is no longer available');
    }
    if (plan.isFree || plan.priceMinorUnits === 0) {
      throw new BadRequestException('This plan does not require payment');
    }
    if (!this.paymentsEnabled()) {
      throw new BadRequestException(
        'Payments are temporarily disabled — workspaces activate without payment.',
      );
    }

    const reference = `ASC-${randomUUID().slice(0, 8).toUpperCase()}-${Date.now()}`;

    await this.prisma.billingTransaction.create({
      data: {
        provider: provider as unknown as DbPaymentProvider,
        reference,
        amountMinorUnits: plan.priceMinorUnits,
        currency: plan.currency,
        status: 'PENDING',
        payerEmail: registration.email,
        planId: plan.id,
        registrationId: registration.id,
      },
    });

    const callbackUrl = `${this.registrations.webAppUrl}/signup/callback`;
    const authorizationUrl =
      provider === PaymentProvider.PAYSTACK
        ? await this.paystackInitialize({
            email: registration.email,
            amountMinorUnits: plan.priceMinorUnits,
            reference,
            callbackUrl,
          })
        : await this.flutterwaveInitialize({
            email: registration.email,
            name: `${registration.firstName} ${registration.lastName}`,
            amountMinorUnits: plan.priceMinorUnits,
            currency: plan.currency,
            reference,
            callbackUrl,
          });

    return {
      provider,
      reference,
      authorizationUrl,
      amountMinorUnits: plan.priceMinorUnits,
      currency: plan.currency,
    };
  }

  /** Public: confirm a payment after the browser returns from the gateway. */
  async verify(dto: VerifyPaymentDto): Promise<PaymentOutcome> {
    const transaction = await this.prisma.billingTransaction.findUnique({
      where: { reference: dto.reference },
    });
    if (!transaction) {
      throw new NotFoundException('Payment reference not found');
    }

    // Idempotent: already confirmed.
    if (transaction.status === 'COMPLETED' && transaction.registrationId) {
      return this.completeFromTransaction(dto.reference);
    }

    const result =
      dto.provider === PaymentProvider.PAYSTACK
        ? await this.paystackVerify(dto.reference)
        : await this.flutterwaveVerify(dto.reference);

    if (result.status === 'success') {
      return this.confirmPayment(dto.reference, {
        providerTxnId: result.providerTxnId,
        amountMinorUnits: result.amountMinorUnits,
        raw: result.raw,
      });
    }

    await this.prisma.billingTransaction.update({
      where: { reference: dto.reference },
      data: {
        status: result.status === 'pending' ? 'PROCESSING' : 'FAILED',
        raw: (result.raw ?? undefined) as never,
      },
    });

    return {
      status: result.status === 'pending' ? 'PENDING' : 'FAILED',
      completed: false,
    };
  }

  /** Webhook: Paystack. Signature is HMAC-SHA512 of the raw body. */
  async handlePaystackWebhook(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<{ ok: true }> {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret || !signature || !rawBody) {
      throw new BadRequestException('Invalid webhook');
    }
    const expected = createHmac('sha512', secret).update(rawBody).digest();
    if (!safeEqualHex(signature, expected)) {
      this.logger.warn('Rejected Paystack webhook with bad signature');
      throw new BadRequestException('Invalid signature');
    }

    const event = JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      data?: { reference?: string; amount?: number };
    };
    if (event.event === 'charge.success' && event.data?.reference) {
      await this.confirmPayment(event.data.reference, {
        amountMinorUnits:
          typeof event.data.amount === 'number' ? event.data.amount : undefined,
      });
    }
    return { ok: true };
  }

  /** Webhook: Flutterwave. Verified against the dashboard secret hash. */
  async handleFlutterwaveWebhook(
    hash: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<{ ok: true }> {
    const secretHash = this.config.get<string>('FLUTTERWAVE_WEBHOOK_HASH');
    if (
      !secretHash ||
      !hash ||
      !rawBody ||
      !safeEqualString(hash, secretHash)
    ) {
      throw new BadRequestException('Invalid webhook');
    }

    const event = JSON.parse(rawBody.toString('utf8')) as {
      status?: string;
      data?: { tx_ref?: string; status?: string; amount?: number };
    };
    const reference = event.data?.tx_ref;
    if (
      event.status === 'successful' &&
      event.data?.status === 'successful' &&
      reference
    ) {
      await this.confirmPayment(reference, {
        // Flutterwave sends major units; convert back to minor for storage.
        amountMinorUnits:
          typeof event.data.amount === 'number'
            ? toMinorUnits(event.data.amount)
            : undefined,
      });
    }
    return { ok: true };
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async completeFromTransaction(
    reference: string,
  ): Promise<PaymentOutcome> {
    const transaction = await this.prisma.billingTransaction.findUnique({
      where: { reference },
    });
    if (!transaction?.registrationId) {
      return { status: 'COMPLETED', completed: true, redirectTo: '/login' };
    }
    const registration = await this.prisma.registration.findUnique({
      where: { id: transaction.registrationId },
    });
    const plan = await this.prisma.plan.findUnique({
      where: { id: transaction.planId ?? '' },
    });
    if (!registration || !plan) {
      return { status: 'COMPLETED', completed: true, redirectTo: '/dashboard' };
    }
    const workspace = await this.registrations.provision(registration, plan, {
      provider: transaction.provider as unknown as PaymentProvider,
      reference: transaction.reference,
      providerTxnId: transaction.providerTxnId ?? undefined,
      amountMinorUnits: transaction.amountMinorUnits,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    });
    return {
      status: 'COMPLETED',
      completed: true,
      redirectTo: '/dashboard',
      workspace,
      plan: toPlanSummary(plan),
    };
  }

  /** Idempotently mark a transaction paid and provision the workspace. */
  private async confirmPayment(
    reference: string,
    info: {
      providerTxnId?: string;
      amountMinorUnits?: number;
      raw?: unknown;
    },
  ): Promise<PaymentOutcome> {
    const transaction = await this.prisma.billingTransaction.findUnique({
      where: { reference },
    });
    if (!transaction) {
      throw new NotFoundException('Payment reference not found');
    }
    if (transaction.status === 'COMPLETED' && transaction.registrationId) {
      return this.completeFromTransaction(reference);
    }

    // Never provision when the gateway charged anything other than the plan
    // price. The mismatch usually means tampering or a bad gateway config.
    if (
      transaction.amountMinorUnits != null &&
      info.amountMinorUnits !== undefined &&
      info.amountMinorUnits !== transaction.amountMinorUnits
    ) {
      await this.prisma.billingTransaction.update({
        where: { reference },
        data: { status: 'FAILED', raw: (info.raw ?? undefined) as never },
      });
      throw new BadRequestException(
        'Payment amount does not match the plan price',
      );
    }

    const registration = transaction.registrationId
      ? await this.prisma.registration.findUnique({
          where: { id: transaction.registrationId },
        })
      : null;
    const plan = transaction.planId
      ? await this.prisma.plan.findUnique({ where: { id: transaction.planId } })
      : null;

    if (!registration || !plan) {
      await this.prisma.billingTransaction.update({
        where: { reference },
        data: { status: 'FAILED', raw: (info.raw ?? undefined) as never },
      });
      return { status: 'FAILED', completed: false };
    }

    const workspace: ProvisionedWorkspace =
      await this.registrations.provision(registration, plan, {
        provider: transaction.provider as unknown as PaymentProvider,
        reference: transaction.reference,
        providerTxnId: info.providerTxnId,
        amountMinorUnits: info.amountMinorUnits ?? transaction.amountMinorUnits,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      });

    await this.prisma.billingTransaction.update({
      where: { reference },
      data: {
        status: 'COMPLETED',
        providerTxnId: info.providerTxnId ?? transaction.providerTxnId,
        organisationId: workspace.organisationId,
        subscriptionId: (
          await this.prisma.subscription.findUnique({
            where: { organisationId: workspace.organisationId },
          })
        )?.id,
        paidAt: new Date(),
        raw: (info.raw ?? undefined) as never,
      },
    });

    return {
      status: 'COMPLETED',
      completed: true,
      redirectTo: '/dashboard',
      workspace,
      plan: toPlanSummary(plan),
    };
  }

  private paymentsEnabled(): boolean {
    return (
      (this.config.get<string>('PAYMENTS_ENABLED') ?? 'false')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  private paystackSecret(): string {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'Paystack is not configured. Add PAYSTACK_SECRET_KEY to the API environment.',
      );
    }
    return secret;
  }

  private flutterwaveSecret(): string {
    const secret = this.config.get<string>('FLUTTERWAVE_SECRET_KEY')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'Flutterwave is not configured. Add FLUTTERWAVE_SECRET_KEY to the API environment.',
      );
    }
    return secret;
  }

  private async paystackInitialize(input: {
    email: string;
    amountMinorUnits: number;
    reference: string;
    callbackUrl: string;
  }): Promise<string> {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.paystackSecret()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinorUnits,
        reference: input.reference,
        callback_url: input.callbackUrl,
      }),
    });
    const json = (await res.json()) as {
      status?: boolean;
      message?: string;
      data?: { authorization_url?: string };
    };
    if (!json.status || !json.data?.authorization_url) {
      throw new BadRequestException(
        json.message ?? 'Could not start Paystack checkout',
      );
    }
    return json.data.authorization_url;
  }

  private async flutterwaveInitialize(input: {
    email: string;
    name: string;
    amountMinorUnits: number;
    currency: string;
    reference: string;
    callbackUrl: string;
  }): Promise<string> {
    const res = await fetch(`${FLUTTERWAVE_BASE}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.flutterwaveSecret()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: input.amountMinorUnits / 100, // Flutterwave expects major units
        currency: input.currency,
        redirect_url: input.callbackUrl,
        customer: { email: input.email, name: input.name },
        customizations: { title: 'Ascenda workspace' },
      }),
    });
    const json = (await res.json()) as {
      status?: string;
      message?: string;
      data?: { link?: string };
    };
    if (json.status !== 'success' || !json.data?.link) {
      throw new BadRequestException(
        json.message ?? 'Could not start Flutterwave checkout',
      );
    }
    return json.data.link;
  }

  private async paystackVerify(reference: string): Promise<{
    status: 'success' | 'failed' | 'pending';
    providerTxnId?: string;
    amountMinorUnits?: number;
    raw: unknown;
  }> {
    const res = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${this.paystackSecret()}` } },
    );
    const json = (await res.json()) as {
      status?: boolean;
      data?: { status?: string; id?: number; amount?: number };
    };
    const status =
      json.data?.status === 'success'
        ? 'success'
        : json.data?.status === 'abandoned' || json.data?.status === 'failed'
          ? 'failed'
          : 'pending';
    return {
      status,
      providerTxnId: json.data?.id ? String(json.data.id) : undefined,
      amountMinorUnits: json.data?.amount,
      raw: json,
    };
  }

  private async flutterwaveVerify(reference: string): Promise<{
    status: 'success' | 'failed' | 'pending';
    providerTxnId?: string;
    amountMinorUnits?: number;
    raw: unknown;
  }> {
    const res = await fetch(
      `${FLUTTERWAVE_BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${this.flutterwaveSecret()}` } },
    );
    const json = (await res.json()) as {
      status?: string;
      data?: { status?: string; id?: number; amount?: number };
    };
    const status =
      json.data?.status === 'successful'
        ? 'success'
        : json.data?.status === 'failed'
          ? 'failed'
          : 'pending';
    return {
      status,
      providerTxnId: json.data?.id ? String(json.data.id) : undefined,
      // Flutterwave returns major units; convert back to minor for storage.
      amountMinorUnits:
        typeof json.data?.amount === 'number'
          ? toMinorUnits(json.data.amount)
          : undefined,
      raw: json,
    };
  }
}
