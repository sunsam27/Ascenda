import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { LeaveStatus } from '@ascenda/types';

/**
 * Team leave calendar query (PRD LVE-05). `from`/`to` are required and bound
 * the visible window; the rest narrow the entries the caller may see.
 */
export class LeaveCalendarQueryDto {
  /** ISO date — first day of the calendar window. */
  @IsDateString()
  from!: string;

  /** ISO date — last day of the calendar window (inclusive). */
  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Restrict to a single status; defaults to APPROVED + PENDING. */
  @IsOptional()
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;
}
