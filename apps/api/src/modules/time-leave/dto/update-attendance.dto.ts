import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AttendanceStatus } from '@ascenda/types';

/** Partial update of an attendance record (PRD ATT-01). */
export class UpdateAttendanceDto {
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsDateString()
  clockIn?: string;

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
