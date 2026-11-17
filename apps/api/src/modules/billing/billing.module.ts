import { Module } from '@nestjs/common';
import { IdentityAccessModule } from '../identity-access/identity-access.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { SubscriptionLifecycleModule } from './lifecycle/subscription-lifecycle.module';

@Module({
  imports: [RegistrationsModule, IdentityAccessModule, SubscriptionLifecycleModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
