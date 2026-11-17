import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AuditAction, type Prisma } from '@ascenda/db';
import { BillingPeriod } from '@ascenda/types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { getRequestContext } from '../../../common/context/request-context';
import { MailerService } from '../../../common/mailer/mailer.service';
import {
  type LifecycleKind,
  graceExpired,
  nextPeriodEnd,
  pastDueReached,
  reminderDue,
  reminderKind,
  REMINDER_DAYS,
} from './lifecycle.domain';

type Tx = Prisma.TransactionClient;

export interface VerifiedRenewal {
  organisationId: string;
  subscriptionId: string;
  planId: string;
  providerTxnId?: string;
  raw?: unknown;
}

/**
 * Manual, non-recurring subscription lifecycle. It never charges a card:
 * it reminds Owners, marks overdue periods, applies the fixed grace window,
 * expires finite grants and restores access only after BillingService has
 * verified a provider payment server-side.
 */
@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  /** Restrictions stay dormant until the reviewed migration 05 is enabled. */
  enabled(): boolean {
    const scheduler = `${this.config.get<string>('SCHEDULER_ENABLED') ?? ''}`.trim().toLowerCase() === 'true';
    const access = `${this.config.get<string>('SUBSCRIPTION_ACCESS_ENABLED') ?? ''}`.trim().toLowerCase() === 'true';
    return scheduler && access;
  }

  async runForCurrentOrganisation(now = new Date()): Promise<void> {
    if (!this.enabled()) return;
    const ctx = getRequestContext();
    if (!ctx?.organisationId) return;
    const organisationId = ctx.organisationId;

    await this.prisma.withContext({ organisationId, userId: ctx.userId }, async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { organisationId },
        include: { plan: true },
      });
      if (
        !subscription?.currentPeriodEnd ||
        subscription.plan.isFree ||
        subscription.plan.priceMinorUnits === 0 ||
        !['ACTIVE', 'PAST_DUE'].includes(subscription.status)
      ) {
        return;
      }
      const periodEnd = subscription.currentPeriodEnd;
      const planName = subscription.plan.name;

      for (const days of REMINDER_DAYS) {
        if (!reminderDue(now, periodEnd, days)) continue;
        const kind = reminderKind(days);
        if (!(await this.reserve(tx, organisationId, periodEnd, kind))) continue;
        await this.notifyOwners(
          tx,
          organisationId,
          'Ascenda subscription renewal reminder',
          `${planName}:\n\nYour paid period ends ${periodEnd.toUTCString()}. Renewal is manual — no automatic charge has been made. Open subscription details to arrange renewal.`,
        );
      }

      if (subscription.status === 'ACTIVE' && pastDueReached(now, periodEnd)) {
        if (await this.reserve(tx, organisationId, periodEnd, 'PAST_DUE')) {
          await tx.subscription.update({
            where: { organisationId },
            data: { status: 'PAST_DUE' },
          });
          await this.audit(
            tx,
            organisationId,
            AuditAction.PERMISSION_CHANGED,
            { status: subscription.status },
            { status: 'PAST_DUE', periodEnd: periodEnd.toISOString() },
            'Renewal period elapsed; seven-day grace window started',
          );
        }
      }

      if (graceExpired(now, periodEnd)) {
        if (await this.reserve(tx, organisationId, periodEnd, 'GRACE_EXPIRED')) {
          await tx.subscription.update({
            where: { organisationId },
            data: { status: 'EXPIRED' },
          });
          await this.audit(
            tx,
            organisationId,
            AuditAction.PERMISSION_CHANGED,
            { status: subscription.status },
            { status: 'EXPIRED', periodEnd: periodEnd.toISOString(), readOnly: true },
            'Grace window elapsed; paid feature access restricted',
          );
          await this.notifyOwners(
            tx,
            organisationId,
            'Ascenda subscription access restricted',
            `${planName}:\n\nThe seven-day grace window has ended. Paid features are now read-only until a verified renewal payment is received. Historical payslips and core records remain available.`,
          );
        }
      }
    });
  }

  /** Clears expired demos and timed admin activations; suspension is never auto-cleared. */
  async expireOverridesForCurrentOrganisation(): Promise<void> {
    if (!this.enabled()) return;
    const ctx = getRequestContext();
    if (!ctx?.organisationId) return;
    const organisationId = ctx.organisationId;
    const reasons = await this.prisma.withContext(
      { organisationId, userId: ctx.userId },
      (tx) => tx.$queryRaw<{ reason: string }[]>`SELECT * FROM expire_current_organisation_overrides()`,
    );
    for (const { reason } of reasons) {
      await this.prisma.withContext({ organisationId, userId: ctx.userId }, (tx) =>
        this.audit(tx, organisationId, AuditAction.PERMISSION_CHANGED, { expiry: reason }, null, reason),
      );
    }
  }

  /** Called only from the verified browser/webhook path, never from client-reported success. */
  async restoreAfterVerifiedPayment(renewal: VerifiedRenewal): Promise<Date> {
    const ctx = getRequestContext();
    return this.prisma.withContext(
      { organisationId: renewal.organisationId, userId: ctx?.userId },
      async (tx) => {
        const subscription = await tx.subscription.findUnique({
          where: { organisationId: renewal.organisationId },
          include: { plan: true },
        });
        if (
          !subscription ||
          subscription.id !== renewal.subscriptionId ||
          subscription.planId !== renewal.planId ||
          subscription.plan.isFree ||
          subscription.plan.priceMinorUnits === 0
        ) {
          throw new BadRequestException('Verified payment does not match the current paid subscription');
        }
        if (!subscription.plan.isActive) {
          throw new BadRequestException('The paid plan is no longer available');
        }

        const now = new Date();
        const periodEnd = nextPeriodEnd(
          subscription.currentPeriodEnd,
          subscription.plan.billingPeriod as BillingPeriod,
          now,
        );
        await tx.subscription.update({
          where: { organisationId: renewal.organisationId },
          data: {
            status: 'ACTIVE',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            providerRef: renewal.providerTxnId ?? subscription.providerRef,
          },
        });
        await tx.$queryRaw`SELECT restore_current_organisation_access_for_payment()`;
        await this.reserve(tx, renewal.organisationId, periodEnd, 'RESTORED');
        await this.audit(
          tx,
          renewal.organisationId,
          AuditAction.SUBSCRIPTION_ACTIVATED,
          {
            status: subscription.status,
            periodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          },
          { status: 'ACTIVE', periodEnd: periodEnd.toISOString(), reference: renewal.subscriptionId },
          'Verified renewal payment restored access; no automatic charge was made',
        );
        return periodEnd;
      },
    );
  }

  private async reserve(
    tx: Tx,
    organisationId: string,
    periodEnd: Date,
    kind: LifecycleKind,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO subscription_lifecycle_events("id","organisationId","periodEnd","kind")
      VALUES(${randomUUID()},${organisationId},${periodEnd},${kind})
      ON CONFLICT ("organisationId","periodEnd","kind") DO NOTHING
      RETURNING "id"`;
    return rows.length > 0;
  }

  private async notifyOwners(
    tx: Tx,
    organisationId: string,
    title: string,
    body: string,
  ): Promise<void> {
    const org = await tx.organisation.findFirst({
      where: { id: organisationId, isActive: true },
      select: { name: true },
    });
    if (!org) return;
    const owners = await tx.membership.findMany({
      where: {
        organisationId,
        isActive: true,
        role: 'OWNER',
        user: { is: { isActive: true } },
      },
      select: { user: { select: { email: true, firstName: true } } },
    });
    for (const owner of owners) {
      try {
        await this.mailer.sendNotification({
          to: owner.user.email,
          name: owner.user.firstName,
          title,
          body: `${org.name}:\n\n${body}`,
          link: '/settings/subscription',
        });
      } catch {
        this.logger.warn('Subscription lifecycle email was not accepted');
      }
    }
  }

  private async audit(
    tx: Tx,
    organisationId: string,
    action: AuditAction,
    previous: unknown,
    next: unknown,
    detail: string,
  ): Promise<void> {
    const actor = await tx.user.findFirst({
      where: { memberships: { some: { organisationId, isActive: true } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    });
    if (!actor) return;
    await tx.auditLog.create({
      data: {
        organisationId,
        actorId: actor.id,
        actorEmail: actor.email,
        action,
        targetType: 'subscription_lifecycle',
        targetId: organisationId,
        previousValue: (previous ?? undefined) as Prisma.InputJsonValue | undefined,
        newValue: (next
          ? { ...(next as object), detail, automatic: true }
          : { detail, automatic: true }) as Prisma.InputJsonValue,
        ipAddress: '',
        userAgent: 'subscription-lifecycle',
      },
    });
  }
}
