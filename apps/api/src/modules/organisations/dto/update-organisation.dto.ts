import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OrganisationType } from '@ascenda/types';

const COUNTRY_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Partial update of the caller's organisation (Phase 1 setup flow).
 * Every field is optional; only the provided ones are changed.
 */
export class UpdateOrganisationDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsEnum(OrganisationType)
  type?: OrganisationType;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(COUNTRY_RE, {
    message: 'country must be an ISO 3166-1 alpha-2 code',
  })
  country?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(CURRENCY_RE, { message: 'currency must be an ISO 4217 code' })
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string;

  /** Terminology overrides, e.g. { "Department": "Ministry" }. */
  @IsOptional()
  @IsObject()
  terminology?: Record<string, string>;

  /** Work-schedule defaults (PRD ATT-02). ISO weekdays Mon=1 … Sun=7. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workDays?: number[];

  @IsOptional()
  @IsString()
  @Matches(HHMM_RE, { message: 'workDayStart must be HH:mm' })
  workDayStart?: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM_RE, { message: 'workDayEnd must be HH:mm' })
  workDayEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  lateGraceMinutes?: number;
}
