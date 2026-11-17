import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentsModule } from '../payments/payments.module';
import { DocumentsModule } from '../documents/documents.module';
import { TimeLeaveModule } from '../time-leave/time-leave.module';
import { SchedulerService } from './scheduler.service';
import { SystemPrismaService } from './system-prisma.service';
import { PlansModule } from '../plans/plans.module';
import { SubscriptionLifecycleModule } from '../billing/lifecycle/subscription-lifecycle.module';

/**
 * Background jobs. `ScheduleModule.forRoot()` installs the cron registry; the
 * jobs themselves no-op unless `SCHEDULER_ENABLED=true`.
 */
@Module({
  imports: [ScheduleModule.forRoot(), TimeLeaveModule, PaymentsModule, DocumentsModule, PlansModule, SubscriptionLifecycleModule],
  providers: [SystemPrismaService, SchedulerService],
})
export class SchedulerModule {}
