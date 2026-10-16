import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AdjustLeaveBalanceDto {
  @IsUUID()
  workerId!: string;

  @IsUUID()
  leaveTypeId!: string;

  /** Defaults to the current leave year. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(2100)
  year?: number;

  /** New entitlement in days (0.5 increments). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  accrued?: number;

  /** Absolute remaining balance in days (0.5 increments). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  balance?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
