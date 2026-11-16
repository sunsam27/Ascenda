import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityAccessModule } from '../identity-access/identity-access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { FlutterwavePayoutProvider } from './payouts/flutterwave-payout.provider';
import { PayoutGatewayRegistry } from './payouts/payout-gateway.registry';
import { PayoutWebhooksController } from './payouts/payout-webhooks.controller';
import { PaystackPayoutProvider } from './payouts/paystack-payout.provider';
import { PayoutsController } from './payouts/payouts.controller';
import { PayoutsService } from './payouts/payouts.service';
import { EmployerWalletModule } from './wallet/wallet.module';

@Module({
  imports: [AuditModule, IdentityAccessModule, NotificationsModule, EmployerWalletModule],
  controllers: [
    PayoutsController,
    PayoutWebhooksController,
    PaymentsController,
  ],
  providers: [
    PaymentsService,
    PayoutsService,
    PayoutGatewayRegistry,
    PaystackPayoutProvider,
    FlutterwavePayoutProvider,
  ],
  exports: [PaymentsService, PayoutsService, EmployerWalletModule],
})
export class PaymentsModule {}
