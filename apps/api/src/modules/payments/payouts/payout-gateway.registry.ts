import { Injectable } from '@nestjs/common';
import { PayoutProvider } from '@ascenda/types';
import { FlutterwavePayoutProvider } from './flutterwave-payout.provider';
import { PaystackPayoutProvider } from './paystack-payout.provider';
import type { PayoutGateway } from './payout-provider';

@Injectable()
export class PayoutGatewayRegistry {
  private readonly gateways: Record<PayoutProvider, PayoutGateway>;

  constructor(
    paystack: PaystackPayoutProvider,
    flutterwave: FlutterwavePayoutProvider,
  ) {
    this.gateways = {
      [PayoutProvider.PAYSTACK]: paystack,
      [PayoutProvider.FLUTTERWAVE]: flutterwave,
    };
  }

  get(provider: PayoutProvider): PayoutGateway {
    return this.gateways[provider];
  }
}
