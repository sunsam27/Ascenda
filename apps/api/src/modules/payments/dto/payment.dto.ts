import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentStatus } from '@ascenda/types';

/** Statuses a payment may be moved to. The service enforces the matrix. */
export const PAYMENT_STATUS_ACTIONS: Array<'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED'> = [
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'REVERSED',
];

export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatus)
  status!: PaymentStatus;

  /** Required for FAILED and REVERSED transitions — audit-logged. */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

export class ListPaymentsQueryDto {
  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsUUID()
  payrollRunId?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 50;
}
