import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import type { PayrollConfig } from '@ascenda/types';
import { SystemRole } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import { UpdatePayrollConfigDto } from './dto/payroll-config.dto';
import {
  DEFAULT_VALIDATION_THRESHOLDS,
  type RunValidationThresholds,
} from './domain/run-validation';

type PayrollConfigRow = Prisma.PayrollConfigGetPayload<Record<string, never>>;

/** Documented defaults when the org has no PayrollConfig row yet. */
export const DEFAULT_APPROVAL_CHAIN: SystemRole[] = [SystemRole.OWNER];

export function toPayrollConfig(row: PayrollConfigRow): PayrollConfig {
  return {
    organisationId: row.organisationId,
    approvalChain: row.approvalChain as SystemRole[],
    salaryChangeWarnPct: row.salaryChangeWarnPct,
    deductionRatioWarnBps: row.deductionRatioWarnBps,
    requireBankDetails: row.requireBankDetails,
    overtimeEnabled: row.overtimeEnabled,
    overtimeMultiplierBps: row.overtimeMultiplierBps,
    standardDailyMinutes: row.standardDailyMinutes,
    taxYearStartMonth: row.taxYearStartMonth,
  };
}

/**
 * Payroll settings (PRD PAY-10 / PAY-11): the approval chain and the
 * configurable validation thresholds. Defaults live in the domain layer; an
 * absent row means "use the defaults". Writes are audit-logged.
 */
@Injectable()
export class PayrollConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The org's effective config: the stored row, or documented defaults. */
  async get(): Promise<PayrollConfig> {
    const { organisationId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.payrollConfig.findUnique({
        where: { organisationId },
      });
      return row
        ? toPayrollConfig(row)
        : {
            organisationId,
            approvalChain: DEFAULT_APPROVAL_CHAIN,
            salaryChangeWarnPct:
              DEFAULT_VALIDATION_THRESHOLDS.salaryChangeWarnPct,
            deductionRatioWarnBps:
              DEFAULT_VALIDATION_THRESHOLDS.deductionRatioWarnBps,
            requireBankDetails:
              DEFAULT_VALIDATION_THRESHOLDS.requireBankDetails,
            overtimeEnabled: false,
            overtimeMultiplierBps: 15000,
            standardDailyMinutes: 480,
            taxYearStartMonth: 1,
          };
    });
  }

  /** Validation thresholds for the org (row or defaults). */
  async thresholds(): Promise<RunValidationThresholds> {
    const config = await this.get();
    return {
      salaryChangeWarnPct: config.salaryChangeWarnPct,
      deductionRatioWarnBps: config.deductionRatioWarnBps,
      requireBankDetails: config.requireBankDetails,
    };
  }

  async update(dto: UpdatePayrollConfigDto): Promise<PayrollConfig> {
    const { organisationId, userId } = this.requireContext();
    if (dto.approvalChain) {
      const unique = new Set(dto.approvalChain);
      if (unique.size !== dto.approvalChain.length) {
        throw new BadRequestException(
          'approvalChain must not contain duplicate roles',
        );
      }
    }
    return this.prisma.withRequestContext(async (tx) => {
      const data: Prisma.PayrollConfigUncheckedCreateInput = {
        organisationId,
        updatedBy: userId,
        ...(dto.approvalChain !== undefined
          ? { approvalChain: dto.approvalChain }
          : {}),
        ...(dto.salaryChangeWarnPct !== undefined
          ? { salaryChangeWarnPct: dto.salaryChangeWarnPct }
          : {}),
        ...(dto.deductionRatioWarnBps !== undefined
          ? { deductionRatioWarnBps: dto.deductionRatioWarnBps }
          : {}),
        ...(dto.requireBankDetails !== undefined
          ? { requireBankDetails: dto.requireBankDetails }
          : {}),
        ...(dto.overtimeEnabled !== undefined
          ? { overtimeEnabled: dto.overtimeEnabled }
          : {}),
        ...(dto.overtimeMultiplierBps !== undefined
          ? { overtimeMultiplierBps: dto.overtimeMultiplierBps }
          : {}),
        ...(dto.standardDailyMinutes !== undefined
          ? { standardDailyMinutes: dto.standardDailyMinutes }
          : {}),
        ...(dto.taxYearStartMonth !== undefined
          ? { taxYearStartMonth: dto.taxYearStartMonth }
          : {}),
      };
      const row = await tx.payrollConfig.upsert({
        where: { organisationId },
        create: data,
        update: data,
      });
      await this.audit.record({
        action: AuditAction.PAYROLL_CONFIG_CHANGED,
        targetType: 'payroll_config',
        targetId: row.id,
        newValue: {
          approvalChain: row.approvalChain,
          salaryChangeWarnPct: row.salaryChangeWarnPct,
          deductionRatioWarnBps: row.deductionRatioWarnBps,
          requireBankDetails: row.requireBankDetails,
          overtimeEnabled: row.overtimeEnabled,
          overtimeMultiplierBps: row.overtimeMultiplierBps,
          standardDailyMinutes: row.standardDailyMinutes,
          taxYearStartMonth: row.taxYearStartMonth,
        },
      });
      return toPayrollConfig(row);
    });
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
