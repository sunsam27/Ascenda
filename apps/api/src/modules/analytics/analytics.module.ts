import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuditModule } from '../audit/audit.module';
import { PeopleModule } from '../people/people.module';
import { PayrollModule } from '../payroll/payroll.module';
import { TimeLeaveModule } from '../time-leave/time-leave.module';
import { IdentityAccessModule } from '../identity-access/identity-access.module';
import { StepUpGuard } from '../../common/auth/step-up.guard';
import { AnalyticsExportGuard } from './analytics-export.guard';
import { AnalyticsReportsService } from './analytics-reports.service';

@Module({
  imports: [AuditModule, PeopleModule, PayrollModule, TimeLeaveModule, IdentityAccessModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsReportsService, StepUpGuard, AnalyticsExportGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
