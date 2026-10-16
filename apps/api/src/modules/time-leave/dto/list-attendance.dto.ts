import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AttendanceStatus } from '@ascenda/types';

const toBool = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

export class ListAttendanceQueryDto {
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
  workerId?: string;

  /** Restrict to the caller's own records. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  /** ISO date — only records on/after this day. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** ISO date — only records on/before this day. */
  @IsOptional()
  @IsDateString()
  to?: string;
}
