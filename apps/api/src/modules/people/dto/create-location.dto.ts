import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Per-location work-schedule override (ATT-02). Empty = inherit org. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workDays?: number[];

  @IsOptional()
  @IsString()
  @Matches(HHMM_RE, { message: 'workDayStart must be HH:mm' })
  workDayStart?: string | null;

  @IsOptional()
  @IsString()
  @Matches(HHMM_RE, { message: 'workDayEnd must be HH:mm' })
  workDayEnd?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  lateGraceMinutes?: number | null;
}
