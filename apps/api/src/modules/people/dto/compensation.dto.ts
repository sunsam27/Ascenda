import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PayFrequency } from '@ascenda/types';

/** One pay-structure component (PRD PAY-01), e.g. BASE + HOUSING + TRANSPORT. */
export class PayComponentDto {
  @IsString()
  @Length(1, 24)
  code!: string;

  @IsString()
  @Length(1, 80)
  label!: string;

  /** Integer minor currency units — never a float. */
  @IsInt()
  @Min(0)
  amountMinorUnits!: number;
}

export class CreateCompensationDto {
  /**
   * Pay-structure components (PRD PAY-01). The server computes the gross as
   * their sum; a disagreeing `grossAmountMinorUnits` is rejected. When both
   * are omitted the request is invalid — legacy clients send the gross alone.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PayComponentDto)
  components?: PayComponentDto[];

  /** Integer minor currency units (e.g. kobo) — never a float. */
  @IsOptional()
  @IsInt()
  @Min(0)
  grossAmountMinorUnits?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsEnum(PayFrequency)
  payFrequency!: PayFrequency;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateCompensationDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PayComponentDto)
  components?: PayComponentDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  grossAmountMinorUnits?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsEnum(PayFrequency)
  payFrequency?: PayFrequency;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
