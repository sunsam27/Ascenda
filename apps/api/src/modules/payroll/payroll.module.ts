import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PeopleModule } from '../people/people.module';
import { TimeLeaveModule } from '../time-leave/time-leave.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayCalendarsController } from './pay-calendars.controller';
import { PayCalendarsService } from './pay-calendars.service';
import { RecurringPayItemsController } from './recurring-pay-items.controller';
import { RecurringPayItemsService } from './recurring-pay-items.service';
import { PayrollRunsController } from './payroll-runs.controller';
import { PayrollRunsService } from './payroll-runs.service';
import { PayrollConfigController } from './payroll-config.controller';
import { PayrollConfigService } from './payroll-config.service';
import { StatutoryRulePacksController } from './statutory-rule-packs.controller';
import { StatutoryRulePacksService } from './statutory-rule-packs.service';
import { PayslipsController } from './payslips.controller';
import { PayslipsService } from './payslips.service';
import { ExpenseClaimsController } from './expense-claims.controller';
import { ExpenseClaimsService } from './expense-claims.service';

@Module({
  imports: [AuditModule, PeopleModule, TimeLeaveModule],
  controllers: [
    PayrollController,
    PayCalendarsController,
    RecurringPayItemsController,
    PayrollRunsController,
    PayrollConfigController,
    StatutoryRulePacksController,
    PayslipsController,
    ExpenseClaimsController,
  ],
  providers: [
    PayrollService,
    PayCalendarsService,
    RecurringPayItemsService,
    PayrollRunsService,
    PayrollConfigService,
    StatutoryRulePacksService,
    PayslipsService,
    ExpenseClaimsService,
  ],
  exports: [
    PayrollService,
    PayCalendarsService,
    RecurringPayItemsService,
    PayrollRunsService,
    PayrollConfigService,
    StatutoryRulePacksService,
    PayslipsService,
    ExpenseClaimsService,
  ],
})
export class PayrollModule {}
