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

@Module({
  imports: [AuditModule, PeopleModule, TimeLeaveModule],
  controllers: [
    PayrollController,
    PayCalendarsController,
    RecurringPayItemsController,
    PayrollRunsController,
    PayrollConfigController,
  ],
  providers: [
    PayrollService,
    PayCalendarsService,
    RecurringPayItemsService,
    PayrollRunsService,
    PayrollConfigService,
  ],
  exports: [
    PayrollService,
    PayCalendarsService,
    RecurringPayItemsService,
    PayrollRunsService,
    PayrollConfigService,
  ],
})
export class PayrollModule {}
