import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Run the annual accrual batch for a leave year (PRD LVE-05). */
export class RunLeaveAccrualDto {
  /** Leave year; defaults to the current UTC year. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  /** Limit the run to one worker; omit to run for all active workers. */
  @IsOptional()
  @IsUUID()
  workerId?: string;
}
