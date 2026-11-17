import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { MailerService } from '../../common/mailer/mailer.service';
import { PlanNotificationStore, type PlanStoreClient } from './plan-notification.store';
import { nextPriceEmailAttempt, priceEmailBody } from './plan-price.domain';

@Injectable()
export class PlanPriceNotificationsService {
  private readonly logger = new Logger(PlanPriceNotificationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PlanNotificationStore,
    private readonly mailer: MailerService,
  ) {}

  /** Global outbox metadata only. Tenant membership and organisation reads always use RLS. */
  async fanOut(system: PlanStoreClient): Promise<void> {
    const unfinishedPlans = new Set<string>();
    for (const event of await this.store.pending(system)) {
      if (unfinishedPlans.has(event.planId)) continue;
      const batch = event.audienceOrganisationIds.slice(
        event.fanoutCursor,
        event.fanoutCursor + 50,
      );
      let skipped = 0;
      for (const organisationId of batch) {
        const count = await this.prisma.withContext({ organisationId }, async (tx) => {
          const org = await tx.organisation.findFirst({
            where: { id: organisationId, isActive: true },
            select: { id: true },
          });
          if (!org) return 0;
          const owners = await tx.membership.findMany({
            where: {
              organisationId,
              isActive: true,
              role: 'OWNER',
              user: { is: { isActive: true } },
            },
            select: { userId: true },
          });
          for (const owner of owners)
            await this.store.enqueue(tx, event, organisationId, owner.userId);
          return owners.length;
        });
        if (!count) skipped++;
      }
      await this.store.advance(system, event, event.fanoutCursor + batch.length, skipped);
      if (event.fanoutCursor + batch.length < event.audienceOrganisationIds.length)
        unfinishedPlans.add(event.planId);
    }
  }

  async deliverForCurrentOrganisation(): Promise<void> {
    const organisationId = getRequestContext()?.organisationId;
    if (!organisationId) throw new Error('Organisation context required for price notices');
    const token = randomUUID();
    const rows = await this.prisma.withContext({ organisationId }, (tx) =>
      this.store.claim(tx, organisationId, token),
    );
    for (const row of rows) {
      const recipient = await this.prisma.withContext({ organisationId }, async (tx) => {
        const org = await tx.organisation.findFirst({
          where: { id: organisationId, isActive: true },
          select: { name: true },
        });
        const owner = await tx.membership.findUnique({
          where: { organisationId_userId: { organisationId, userId: row.recipientUserId } },
          select: {
            role: true,
            isActive: true,
            user: { select: { isActive: true, email: true, firstName: true } },
          },
        });
        return org && owner?.isActive && owner.role === 'OWNER' && owner.user.isActive
          ? { org, user: owner.user }
          : null;
      });
      let sent = false;
      if (recipient) {
        try {
          sent = await this.mailer.sendPlanPriceChange({
            id: row.id,
            to: recipient.user.email,
            name: recipient.user.firstName,
            title: 'Ascenda subscription price update',
            body: `${recipient.org.name}:\n\n${priceEmailBody(row.payload)}`,
            link: '/settings',
          });
        } catch {
          this.logger.warn('Plan price email not accepted; durable retry retained');
        }
      }
      await this.prisma.withContext({ organisationId }, (tx) =>
        this.store.finish(
          tx,
          row,
          token,
          !recipient ? 'SKIPPED' : sent ? 'SENT' : 'PENDING',
          nextPriceEmailAttempt(row.attempts),
        ),
      );
    }
  }
}
