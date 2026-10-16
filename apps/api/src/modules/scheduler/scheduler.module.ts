import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TimeLeaveModule } from '../time-leave/time-leave.module';
import { SchedulerService } from './scheduler.service';
import { SystemPrismaService } from './system-prisma.service';

/**
 * Background jobs. `ScheduleModule.forRoot()` installs the cron registry; the
 * jobs themselves no-op unless `SCHEDULER_ENABLED=true`.
 */
@Module({
  imports: [ScheduleModule.forRoot(), TimeLeaveModule],
  providers: [SystemPrismaService, SchedulerService],
})
export class SchedulerModule {}
