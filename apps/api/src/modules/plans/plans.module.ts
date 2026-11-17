import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlanNotificationStore } from './plan-notification.store';
import { PlanPriceNotificationsService } from './plan-price-notifications.service';
import { MailerModule } from '../../common/mailer/mailer.module';
import { IdentityAccessModule } from '../identity-access/identity-access.module';
import { StepUpGuard } from '../../common/auth/step-up.guard';
import { PlatformAdminController } from './platform-admin.controller';

@Module({
  imports: [MailerModule, IdentityAccessModule],
  controllers: [PlansController, PlatformAdminController],
  providers: [
    PlansService,
    PlatformAdminGuard,
    StepUpGuard,
    PlanNotificationStore,
    PlanPriceNotificationsService,
  ],
  exports: [PlansService, PlanPriceNotificationsService, PlanNotificationStore],
})
export class PlansModule {}
