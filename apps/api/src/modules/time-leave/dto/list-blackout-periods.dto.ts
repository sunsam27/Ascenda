import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListBlackoutPeriodsQueryDto {
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

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  /** ISO date — only windows overlapping on/after this day. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** ISO date — only windows overlapping on/before this day. */
  @IsOptional()
  @IsDateString()
  to?: string;
}
