import { IsEnum } from 'class-validator';
import { PaymentProvider } from '@ascenda/types';

export class InitializeRenewalDto {
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;
}
