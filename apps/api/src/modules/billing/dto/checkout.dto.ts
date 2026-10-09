import { IsEnum, IsString, IsUUID, Length } from 'class-validator';
import { PaymentProvider } from '@ascenda/types';

const CHECKOUT_PROVIDERS = [PaymentProvider.PAYSTACK, PaymentProvider.FLUTTERWAVE];

export class InitializeCheckoutDto {
  @IsUUID()
  registrationId!: string;

  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;
}

export class VerifyPaymentDto {
  @IsString()
  @Length(6, 120)
  reference!: string;

  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;
}

export { CHECKOUT_PROVIDERS };
