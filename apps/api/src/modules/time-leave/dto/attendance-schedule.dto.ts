import { IsOptional, IsUUID } from 'class-validator';

export class AttendanceScheduleQueryDto {
  /** Effective schedule for a worker's location (defaults to the org default). */
  @IsOptional()
  @IsUUID()
  workerId?: string;
}
