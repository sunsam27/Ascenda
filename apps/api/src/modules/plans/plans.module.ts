import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  controllers: [PlansController],
  providers: [PlansService, PlatformAdminGuard],
  exports: [PlansService],
})
export class PlansModule {}
