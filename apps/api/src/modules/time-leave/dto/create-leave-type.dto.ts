import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LeaveTypeCategory } from '@ascenda/types';

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
}
