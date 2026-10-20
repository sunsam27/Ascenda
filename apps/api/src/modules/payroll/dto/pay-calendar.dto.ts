import { PartialType } from '@nestjs/swagger';
import {
  Type,
} from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PayFrequency } from '@ascenda/types';

export class CreatePayCalendarDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsEnum(PayFrequency)
  frequency!: PayFrequency;

  /** 1–31; required for MONTHLY and QUARTERLY calendars. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  /** 1–7 (Mon=1 … Sun=7); required for WEEKLY and BIWEEKLY calendars. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  /** 1–31; changes after this day in the pay month wait for the next period. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  cutOffDayOfMonth?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePayCalendarDto extends PartialType(CreatePayCalendarDto) {}

export class PayCalendarPeriodsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(9999)
  year!: number;
}

export class ListPayCalendarsQueryDto {
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
