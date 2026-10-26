import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
import {
  PaymentBatchStatus,
  PaymentExportFormat,
  PaymentStatus,
} from '@ascenda/types';

/** Statuses a payment may be moved to. The service enforces the matrix. */
export const PAYMENT_STATUS_ACTIONS: Array<
  | 'APPROVED'
  | 'PROCESSING'
  | 'PAID'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REVERSED'
> = ['APPROVED', 'PROCESSING', 'PAID', 'COMPLETED', 'CANCELLED', 'FAILED', 'REVERSED'];

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
  @IsUUID()
  paymentBatchId?: string;

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

export class ExportPaymentsQueryDto {
  @IsOptional()
  @IsUUID()
  payrollRunId?: string;

  @IsOptional()
  @IsUUID()
  paymentBatchId?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentExportFormat)
  format: PaymentExportFormat = PaymentExportFormat.CSV;
}

export class CreatePaymentBatchDto {
  /** Either a whole payroll run or an explicit set of payments. */
  @IsOptional()
  @IsUUID()
  payrollRunId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  paymentIds?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;
}

export class ListPaymentBatchesQueryDto {
  @IsOptional()
  @IsUUID()
  payrollRunId?: string;

  @IsOptional()
  @IsEnum(PaymentBatchStatus)
  status?: PaymentBatchStatus;

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

export class CancelPaymentBatchDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
