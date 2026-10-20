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

@Module({
  imports: [AuditModule, PeopleModule, TimeLeaveModule],
  controllers: [
    PayrollController,
    PayCalendarsController,
    RecurringPayItemsController,
  ],
  providers: [PayrollService, PayCalendarsService, RecurringPayItemsService],
  exports: [PayrollService, PayCalendarsService, RecurringPayItemsService],
})
export class PayrollModule {}
