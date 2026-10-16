import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Create a blackout window (PRD LVE-05). */
export class CreateBlackoutPeriodDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** ISO date (YYYY-MM-DD) the window opens (inclusive). */
  @IsDateString()
  startDate!: string;

  /** ISO date (YYYY-MM-DD) the window closes (inclusive). */
  @IsDateString()
  endDate!: string;

  /** Omit for an organisation-wide window. */
  @IsOptional()
  @IsUUID()
  locationId?: string;

  /** Omit to apply to every leave type. */
  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  /** Repeats every year on the same month/day range. */
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
