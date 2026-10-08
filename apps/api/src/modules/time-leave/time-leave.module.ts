import { Module } from '@nestjs/common';
import { TimeLeaveController } from './time-leave.controller';
import { TimeLeaveService } from './time-leave.service';

@Module({
  controllers: [TimeLeaveController],
  providers: [TimeLeaveService],
  exports: [TimeLeaveService],
})
export class TimeLeaveModule {}
