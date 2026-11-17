import { Module } from '@nestjs/common';
import { MailerModule } from '../../../common/mailer/mailer.module';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

@Module({
  imports: [MailerModule],
  providers: [SubscriptionLifecycleService],
  exports: [SubscriptionLifecycleService],
})
export class SubscriptionLifecycleModule {}
