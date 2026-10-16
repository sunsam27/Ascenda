import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LeaveAccrualMethod, LeaveTypeCategory } from '@ascenda/types';

export class CreateLeaveTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsEnum(LeaveTypeCategory)
  category!: LeaveTypeCategory;

  /** Days per year — 0.5 increments (LVE-01) */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(366)
  defaultBalance!: number;

  @IsBoolean()
  isPaid!: boolean;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** How the entitlement is earned over the leave year (LVE-05). */
  @IsOptional()
  @IsEnum(LeaveAccrualMethod)
  accrualMethod?: LeaveAccrualMethod;

  @IsOptional()
  @IsBoolean()
  carryOverEnabled?: boolean;

  /** Cap on days carried into the next year (null = uncapped). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(366)
  carryOverMaxDays?: number | null;

  /** Months into the new year before carried days expire (null = never). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  carryOverExpiryMonths?: number | null;
}
