import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Clock in / clock out (PRD ATT-01). `workerId` may be omitted to clock the
 * caller themselves in/out; privileged callers may target a worker in scope.
 * `at` defaults to the server time.
 */
export class ClockAttendanceDto {
  @IsOptional()
  @IsUUID()
  workerId?: string;

  /** ISO datetime the punch happened (defaults to now) */
  @IsOptional()
  @IsDateString()
  at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
