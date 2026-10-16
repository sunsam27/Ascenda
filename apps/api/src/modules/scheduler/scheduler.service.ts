import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { requestContext } from '../../common/context/request-context';
import { LeaveBalancesService } from '../time-leave/leave-balances.service';
import { LeaveRequestsService } from '../time-leave/leave-requests.service';
import { SystemPrismaService } from './system-prisma.service';

/** 15 minutes, on the quarter hour. */
const ESCALATION_CRON = '*/15 * * * *';
/** 02:00 on the first day of each month — accrual is idempotent per year. */
const ACCRUAL_CRON = '0 2 1 * *';

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
    private readonly config: ConfigService,
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
