import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PayItemCalculation,
  PayrollItemType,
  RECURRING_PAY_ITEM_TYPES,
  type RecurringPayItemType,
} from '@ascenda/types';

export class CreateRecurringPayItemDto {
  @IsUUID()
  workerId!: string;

  @IsIn(RECURRING_PAY_ITEM_TYPES as unknown as PayrollItemType[])
  type!: RecurringPayItemType;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsEnum(PayItemCalculation)
  calculation!: PayItemCalculation;

  /** Required when calculation = FIXED; positive integer minor units. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountMinorUnits?: number;

  /** Required when calculation = PERCENTAGE; basis points of period gross. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  rateBps?: number;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateRecurringPayItemDto {
  @IsOptional()
  @IsIn(RECURRING_PAY_ITEM_TYPES as unknown as PayrollItemType[])
  type?: RecurringPayItemType;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsEnum(PayItemCalculation)
  calculation?: PayItemCalculation;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountMinorUnits?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  rateBps?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

const boolTransform = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class ListRecurringPayItemsQueryDto {
  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsIn(RECURRING_PAY_ITEM_TYPES as unknown as PayrollItemType[])
  type?: RecurringPayItemType;

  /** Filter on the isActive flag; omit for all items. */
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
