import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  StatutoryItemType,
  StatutoryRuleBase,
  StatutoryRuleKind,
  StatutoryRuleSide,
} from '@ascenda/types';

export const STATUTORY_RULE_KINDS = [
  'PERCENT_BANDS',
  'FLAT',
  'PERCENT_CAPPED',
] as const;
export const STATUTORY_RULE_BASES = [
  'GROSS',
  'BASIC_SALARY',
  'TAXABLE',
  'PENSIONABLE',
] as const;
export const STATUTORY_RULE_SIDES = ['EMPLOYEE', 'EMPLOYER'] as const;
export const STATUTORY_RULE_ITEM_TYPES = [
  'DEDUCTION',
  'TAX',
  'EMPLOYEE_PENSION',
  'EMPLOYER_PENSION',
] as const;

export class StatutoryBandDto {
  /** Inclusive upper bound in minor units; null = unbounded top band. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  upToMinorUnits!: number | null;

  @IsInt()
  @Min(0)
  @Max(100_000)
  rateBps!: number;
}

export class StatutoryRuleDto {
  @IsString()
  @Length(1, 60)
  code!: string;

  @IsString()
  @Length(1, 120)
  label!: string;

  @IsIn(STATUTORY_RULE_KINDS as unknown as StatutoryRuleKind[])
  kind!: StatutoryRuleKind;

  @IsIn(STATUTORY_RULE_BASES as unknown as StatutoryRuleBase[])
  base!: StatutoryRuleBase;

  @IsIn(STATUTORY_RULE_SIDES as unknown as StatutoryRuleSide[])
  side!: StatutoryRuleSide;

  @IsIn(STATUTORY_RULE_ITEM_TYPES as unknown as string[])
  itemType!: StatutoryItemType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StatutoryBandDto)
  bands?: StatutoryBandDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  amountMinorUnits?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  rateBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  capMinorUnits?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  baseFloorMinorUnits?: number | null;
}

export class CreateStatutoryRulePackDto {
  @IsString()
  @Length(2, 2)
  country!: string;

  @IsString()
  @Length(1, 40)
  version!: string;

  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StatutoryRuleDto)
  rules!: StatutoryRuleDto[];

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStatutoryRulePackDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  version?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StatutoryRuleDto)
  rules?: StatutoryRuleDto[];

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ValidateStatutoryRulePackDto {
  /** LOC-03: record that a qualified professional has validated the pack. */
  @IsOptional()
  @IsBoolean()
  validated?: boolean;
}

const boolTransform = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class ListStatutoryRulePacksQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @Transform(boolTransform)
  @IsBoolean()
  active?: boolean;

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
}
