import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { SystemRole } from '@ascenda/types';

/**
 * Roles that can sit in an approval chain (PAY-11). The chain decides WHICH
 * roles sign off; the RBAC matrix still decides WHO may act (payroll:approve).
 */
export const APPROVER_ROLES: SystemRole[] = [
  SystemRole.OWNER,
  SystemRole.FINANCE_APPROVER,
  SystemRole.HR_ADMINISTRATOR,
  SystemRole.PAYROLL_ADMINISTRATOR,
];

export class UpdatePayrollConfigDto {
  /** Ordered approver roles, 1–5 steps, no duplicates. Default ["OWNER"]. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5)
  @IsIn(APPROVER_ROLES, { each: true })
  approvalChain?: SystemRole[];

  /** Warn when a worker's gross rises more than this % vs the previous run. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  salaryChangeWarnPct?: number;

  /** Warn when deductions exceed this share of gross (bps; 5000 = 50%). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  deductionRatioWarnBps?: number;

  /** Blocking error when a run worker has no bank account on file. */
  @IsOptional()
  @IsBoolean()
  requireBankDetails?: boolean;

  /** PAY-16: month the tax/leave year starts (1 = January). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  taxYearStartMonth?: number;
}
