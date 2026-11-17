import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { requestContext } from '../../common/context/request-context';
import { PayoutsService } from '../payments/payouts/payouts.service';
import { LeaveBalancesService } from '../time-leave/leave-balances.service';
import { LeaveRequestsService } from '../time-leave/leave-requests.service';
import { SystemPrismaService } from './system-prisma.service';
import { DocumentWorkflowsService } from '../documents/document-workflows.service';
import { EmployerWalletService } from '../payments/wallet/wallet.service';
import { EmployerFundingRegistry } from '../payments/wallet/wallet-provider';
import { PlanPriceNotificationsService } from '../plans/plan-price-notifications.service';
import { SubscriptionLifecycleService } from '../billing/lifecycle/subscription-lifecycle.service';

/** 15 minutes, on the quarter hour. */
const ESCALATION_CRON = '*/15 * * * *';
/** 02:00 on the first day of each month — accrual is idempotent per year. */
const ACCRUAL_CRON = '0 2 1 * *';
/** 10 minutes, offset from the leave escalation job. */
const PAYOUT_RECONCILIATION_CRON = '*/10 * * * *';

/**
 * In-process background jobs (no external queue for the single-instance demo).
 *
 * Disabled unless `SCHEDULER_ENABLED=true`. Both jobs are safe to run on every
 * node because the underlying operations are idempotent (escalation only moves
 * steps whose window has genuinely elapsed; accrual overwrites to the policy
 * value). Cross-tenant enumeration uses the privileged `SystemPrismaService`;
 * each organisation's work then runs inside a synthetic request context so the
 * normal RLS-scoped services — and their notifications/audit — behave exactly as
 * they do for a real request.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly enabled: boolean;
  private busy = false;

  constructor(
    private readonly system: SystemPrismaService,
    private readonly leaveRequests: LeaveRequestsService,
    private readonly leaveBalances: LeaveBalancesService,
    private readonly payouts: PayoutsService,
    private readonly config: ConfigService,
    private readonly documents: DocumentWorkflowsService,
    private readonly employerWallets: EmployerWalletService,
    private readonly employerFunding: EmployerFundingRegistry,
    private readonly planPrices: PlanPriceNotificationsService,
    private readonly subscriptions: SubscriptionLifecycleService,
  ) {
    this.enabled =
      `${this.config.get<string>('SCHEDULER_ENABLED') ?? ''}`.toLowerCase() ===
      'true';
    this.logger.log(
      `Scheduler ${this.enabled ? 'enabled' : 'disabled'} (SCHEDULER_ENABLED=${this.enabled})`,
    );
  }

  /** Auto-escalate overdue leave approvals (LVE-04) across all organisations. */
  @Cron(ESCALATION_CRON, { name: 'leave-escalation' })
  async runLeaveEscalations(): Promise<void> {
    if (!this.enabled) return;
    await this.forEachOrganisation('leave-escalation', () =>
      this.leaveRequests.escalateOverdue(),
    );
  }

  /** Recompute accrued leave entitlements (LVE-05) across all organisations. */
  @Cron(ACCRUAL_CRON, { name: 'leave-accrual' })
  async runLeaveAccrual(): Promise<void> {
    if (!this.enabled) return;
    await this.forEachOrganisation('leave-accrual', () =>
      this.leaveBalances.runAccrual({}),
    );
  }

  /**
   * Poll providers for payouts whose webhook never arrived. Only stale
   * QUEUED/PROCESSING transfers are checked; terminal ones are left untouched.
   */
  @Cron(PAYOUT_RECONCILIATION_CRON, { name: 'payout-reconciliation' })
  async runPayoutReconciliation(): Promise<void> {
    if (!this.enabled) return;
    await this.forEachOrganisation('payout-reconciliation', () =>
      this.payouts.reconcileStalePayouts(),
    );
  }

  @Cron('7 * * * *', { name: 'document-maintenance' })
  async runDocumentMaintenance(): Promise<void> {
    if (!this.enabled) return;
    await this.forEachOrganisation('document-maintenance', () => this.documents.maintenance());
  }

  @Cron('* * * * *', { name: 'plan-price-notifications' })
  async runPlanPriceNotifications(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.planPrices.fanOut(this.system);
      await this.forEachOrganisation('plan-price-notifications', () => this.planPrices.deliverForCurrentOrganisation());
    } catch {
      this.logger.warn('Plan price notification pass deferred; check migration 04 and database availability');
    }
  }

  /** Manual renewal reminders, past-due marking and fixed seven-day grace expiry. */
  @Cron('11 * * * *', { name: 'subscription-lifecycle' })
  async runSubscriptionLifecycle(): Promise<void> {
    if (!this.enabled || !this.subscriptions.enabled()) return;
    await this.forEachOrganisation('subscription-lifecycle', () =>
      this.subscriptions.runForCurrentOrganisation(),
    );
  }

  /** Finite demos and manual activations revert at their stored timestamp. */
  @Cron('13 * * * *', { name: 'subscription-access-expiry' })
  async runSubscriptionAccessExpiry(): Promise<void> {
    if (!this.enabled || !this.subscriptions.enabled()) return;
    await this.forEachOrganisation('subscription-access-expiry', () =>
      this.subscriptions.expireOverridesForCurrentOrganisation(),
    );
  }

  @Cron('3-59/10 * * * *', { name: 'employer-funding-reconciliation' })
  async runEmployerFundingReconciliation(): Promise<void> {
    if (!this.enabled || !this.employerFunding.configured()) return;
    await this.forEachOrganisation('employer-funding-reconciliation', async () => {
      const summary = await this.employerWallets.summary();
      if (summary.status === 'ACTIVE') await this.employerWallets.reconcile();
    });
  }

  private async forEachOrganisation(
    label: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    if (this.busy) {
      this.logger.warn(`Skipping "${label}": a previous job is still running`);
      return;
    }
    this.busy = true;
    const startedAt = Date.now();
    let ok = 0;
    let failed = 0;

    try {
      const orgs = await this.system.organisation.findMany({
        where: { isActive: true },
        select: { id: true },
      });

      for (const org of orgs) {
        const actor = await this.system.membership.findFirst({
          where: { organisationId: org.id, isActive: true },
          orderBy: { createdAt: 'asc' },
          select: { userId: true, role: true },
        });
        if (!actor) {
          this.logger.warn(`[${org.id}] no active member; skipping`);
          continue;
        }

        await requestContext.run(
          {
            organisationId: org.id,
            userId: actor.userId,
            role: actor.role,
          },
          async () => {
            try {
              await run();
              ok += 1;
            } catch (error) {
              failed += 1;
              this.logger.error(
                `[${org.id}] "${label}" failed: ${(error as Error).message}`,
              );
            }
          },
        );
      }

      this.logger.log(
        `"${label}" done: orgs=${orgs.length} ok=${ok} failed=${failed} in ${Date.now() - startedAt}ms`,
      );
    } catch (error) {
      this.logger.error(
        `"${label}" aborted before completion: ${(error as Error).message}`,
      );
    } finally {
      this.busy = false;
    }
  }
}
