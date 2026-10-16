import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateHolidayDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** ISO date (YYYY-MM-DD) the holiday falls on */
  @IsDateString()
  date!: string;

  /** Omit or null for an organisation-wide holiday (LVE-03) */
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  /** Repeats annually on the same month/day */
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;
}
