import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
};

export class ListLeaveBalancesQueryDto {
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

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(2100)
  year?: number;

  /** Restrict to the caller's own balances. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  mine?: boolean;
}
