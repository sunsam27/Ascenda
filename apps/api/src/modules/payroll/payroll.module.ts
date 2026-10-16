import { Module } from '@nestjs/common';
import { PeopleModule } from '../people/people.module';
import { TimeLeaveModule } from '../time-leave/time-leave.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [PeopleModule, TimeLeaveModule],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
