import { Type } from 'class-transformer';
import {
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
import { ExpenseClaimStatus } from '@ascenda/types';

export class CreateExpenseClaimDto {
  @IsUUID()
  workerId!: string;

  @IsString()
  @Length(1, 60)
  type!: string;

  @IsString()
  @Length(1, 500)
  description!: string;

  /** Positive integer minor units. */
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountMinorUnits!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  receiptUrl?: string | null;
}

export class DecideExpenseClaimDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string | null;
}

export class ListExpenseClaimsQueryDto {
  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsEnum(ExpenseClaimStatus)
  status?: ExpenseClaimStatus;

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
