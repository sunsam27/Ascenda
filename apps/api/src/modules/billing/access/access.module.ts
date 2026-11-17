import { Module } from '@nestjs/common';
import { IdentityAccessModule } from '../../identity-access/identity-access.module';
import { PlansModule } from '../../plans/plans.module';
import { PlatformAdminGuard } from '../../../common/auth/platform-admin.guard';
import { StepUpGuard } from '../../../common/auth/step-up.guard';
import { SubscriptionAccessService } from './access.service';
import { SubscriptionAccessStore } from './access.store';
import { AdminSubscriptionAccessController, SubscriptionAccessController } from './access.controller';
@Module({imports:[IdentityAccessModule,PlansModule],controllers:[AdminSubscriptionAccessController,SubscriptionAccessController],
  providers:[SubscriptionAccessStore,SubscriptionAccessService,PlatformAdminGuard,StepUpGuard],exports:[SubscriptionAccessService]})
export class SubscriptionAccessModule {}
