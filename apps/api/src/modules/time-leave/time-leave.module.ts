import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TimeLeaveController } from './time-leave.controller';
import { TimeLeaveService } from './time-leave.service';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';

@Module({
  imports: [AuditModule],
  controllers: [TimeLeaveController, LeaveTypesController, HolidaysController],
  providers: [TimeLeaveService, LeaveTypesService, HolidaysService],
  exports: [TimeLeaveService, LeaveTypesService, HolidaysService],
})
export class TimeLeaveModule {}
