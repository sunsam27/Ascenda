import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AttendanceStatus } from '@ascenda/types';

/**
 * Manual attendance entry by a manager / HR (PRD ATT-01). The `source` is
 * always recorded as MANUAL server-side, so it is not accepted from clients.
 */
export class CreateAttendanceDto {
  @IsUUID()
  workerId!: string;

  /** ISO date (YYYY-MM-DD) the record applies to */
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  /** ISO datetime the worker clocked in */
  @IsOptional()
  @IsDateString()
  clockIn?: string;

  /** ISO datetime the worker clocked out */
  @IsOptional()
  @IsDateString()
  clockOut?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(24)
  hoursWorked?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
