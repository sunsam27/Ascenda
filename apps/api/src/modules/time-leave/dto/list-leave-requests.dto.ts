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
import { LeaveStatus } from '@ascenda/types';

const toBool = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

export class ListLeaveRequestsQueryDto {
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
  @IsEnum(LeaveStatus)
  status?: LeaveStatus;

  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  /** Restrict to the caller's own requests. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;

  /** ISO date — only requests overlapping on/after this day. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** ISO date — only requests overlapping on/before this day. */
  @IsOptional()
  @IsDateString()
  to?: string;
}
