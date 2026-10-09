import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BillingPeriod } from '@ascenda/types';

export class CreatePlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'code must be lowercase kebab-case (e.g. "starter-20")',
  })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;

  @IsInt()
  @Min(0)
  priceMinorUnits!: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;

  @IsOptional()
  @IsInt()
  @Min(0)
  minHeadcount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxHeadcount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxSeats?: number | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
