import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PayrollItemType, PayrollRunStatus } from '@ascenda/types';

/**
 * Line types a reviewer may add by hand mid-run (PAY-09). Statutory and base
 * types are excluded — they come from prepare, not manual entry.
 */
export const MANUAL_ITEM_TYPES = [
  PayrollItemType.DEDUCTION,
  PayrollItemType.BONUS,
  PayrollItemType.ALLOWANCE,
  PayrollItemType.REIMBURSEMENT,
  PayrollItemType.STIPEND,
] as const;

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

export class CreatePayrollItemDto {
  /** The worker the one-off line belongs to (must be in the run). */
  @IsUUID()
  workerId!: string;

  /** Manual line type — earning or deduction (see MANUAL_ITEM_TYPES). */
  @IsIn(MANUAL_ITEM_TYPES as unknown as string[])
  type!: (typeof MANUAL_ITEM_TYPES)[number];

  @IsString()
  @Length(1, 200)
  description!: string;

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
