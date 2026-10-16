import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveTypesService } from './leave-types.service';
import { HolidaysController } from './holidays.controller';
import { HolidaysService } from './holidays.service';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveRequestsService } from './leave-requests.service';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveBalancesService } from './leave-balances.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { BlackoutPeriodsController } from './blackout-periods.controller';
import { BlackoutPeriodsService } from './blackout-periods.service';

@Module({
  imports: [AuditModule],
  controllers: [
    LeaveTypesController,
    HolidaysController,
    LeaveRequestsController,
    LeaveBalancesController,
    AttendanceController,
    BlackoutPeriodsController,
  ],
  providers: [
    LeaveTypesService,
    HolidaysService,
    LeaveRequestsService,
    LeaveBalancesService,
    AttendanceService,
    BlackoutPeriodsService,
  ],
  exports: [
    LeaveTypesService,
    HolidaysService,
    LeaveRequestsService,
    LeaveBalancesService,
    AttendanceService,
    BlackoutPeriodsService,
  ],
})
export class TimeLeaveModule {}
