import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';

export class CreateLeaveRequestDto {
  /** Omit to request leave for yourself. */
  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsUUID()
  leaveTypeId!: string;

  /** ISO date (YYYY-MM-DD). */
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsBoolean()
  startHalfDay?: boolean;

  @IsOptional()
  @IsBoolean()
  endHalfDay?: boolean;

  /** Restricted field — permission-gated. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** Allow dates that fall in a blackout (requires org-wide leave:approve). */
  @IsOptional()
  @IsBoolean()
  overrideBlackout?: boolean;

  /** Submit for approval immediately (default true). */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;

  /** Force an HR/admin approval step in addition to the manager. */
  @IsOptional()
  @IsBoolean()
  requireHrApproval?: boolean;

  /** Minutes before the active approval step auto-escalates (LVE-04). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(60 * 24 * 30)
  escalateAfterMinutes?: number;
}
