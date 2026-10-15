import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { OrganisationType } from '@ascenda/types';

const COUNTRY_RE = /^[A-Z]{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

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
}
