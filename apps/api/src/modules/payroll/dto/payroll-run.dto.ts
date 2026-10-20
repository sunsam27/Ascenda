import { Type } from 'class-transformer';
import {
  IsDateString,
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
import { PayrollRunStatus } from '@ascenda/types';

export class CreatePayrollRunDto {
  @IsUUID()
  payCalendarId!: string;

  /** ISO date; must fall on a generated period boundary of the calendar. */
  @IsDateString()
  periodStart!: string;

  /** ISO date; must fall on a generated period boundary of the calendar. */
  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdatePayrollItemDto {
  /** Signed integer minor units: positive earning, negative deduction. */
  @IsInt()
  @Min(-2_147_483_647)
  @Max(2_147_483_647)
  amountMinorUnits!: number;

  /** Mandatory explanation — stored on the item and audit-logged (PAY-09). */
  @IsString()
  @Length(1, 500)
  overrideReason!: string;
}

export class ApprovePayrollRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class RejectPayrollRunDto {
  @IsString()
  @Length(1, 500)
  comment!: string;
}

export class ReversePayrollRunDto {
  /** Why the run is being reversed — required and audit-logged (PAY-06). */
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class ListPayrollRunsQueryDto {
  @IsOptional()
  @IsEnum(PayrollRunStatus)
  status?: PayrollRunStatus;

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
