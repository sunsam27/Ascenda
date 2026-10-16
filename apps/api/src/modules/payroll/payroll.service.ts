import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { getRequestContext } from '../../common/context/request-context';
import { CompensationService } from '../people/compensation.service';
import { LeaveRequestsService } from '../time-leave/leave-requests.service';
import { AttendanceService } from '../time-leave/attendance.service';
import { parseDateOnly } from '../time-leave/holidays.service';
import { PayrollLine, buildPayslip } from './domain/payroll';
import { PayrollPreviewQueryDto } from './dto/payroll-preview-query.dto';

export interface PayrollPreviewWorker {
  workerId: string;
  currency: string;
  periodWorkingDays: number;
  payableDays: number;
  unpaidLeaveDays: number;
  absenceDays: number;
  grossMinorUnits: number;
  deductionsMinorUnits: number;
  netMinorUnits: number;
  lines: PayrollLine[];
  warnings: string[];
}

export interface PayrollPreviewResult {
  periodStart: string;
  periodEnd: string;
  currency: string;
  workers: PayrollPreviewWorker[];
  totals: {
    grossMinorUnits: number;
    deductionsMinorUnits: number;
    netMinorUnits: number;
  };
}

/**
 * Payroll (PRD LVE-06 / ATT-03). This pass implements a read-only PREVIEW: it
 * pulls the effective rate, approved unpaid leave and attendance absences from
 * the owning modules and computes prorated payslip lines without persisting a
 * run. Money is integer minor units; the calculation is deterministic and
 * covered by `domain/payroll.spec.ts`.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly compensation: CompensationService,
    private readonly leaveRequests: LeaveRequestsService,
    private readonly attendance: AttendanceService,
  ) {}

  async preview(query: PayrollPreviewQueryDto): Promise<PayrollPreviewResult> {
    this.requireContext();
    const periodStart = parseDateOnly(query.periodStart);
    const periodEnd = parseDateOnly(query.periodEnd);
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException('periodEnd must be on or after periodStart');
    }

    const workerIds = [...new Set(query.workerIds)];
    const [leaveInputs, absenceInputs] = await Promise.all([
      this.leaveRequests.leaveForPayroll({ periodStart, periodEnd, workerIds }),
      this.attendance.absenceDaysInPeriod({ periodStart, periodEnd, workerIds }),
    ]);

    const workers: PayrollPreviewWorker[] = [];
    let currency = 'NGN';
    let first = true;

    for (const workerId of workerIds) {
      const leave = leaveInputs[workerId] ?? {
        workingDays: 0,
        unpaidLeaveDays: 0,
      };
      const absenceDays = absenceInputs[workerId] ?? 0;
      const rate = await this.compensation.getCurrentForPayroll(
        workerId,
        periodEnd,
      );

      const warnings: string[] = [];
      let grossMinorUnits = 0;
      let slipCurrency = currency;
      if (rate) {
        grossMinorUnits = rate.grossAmountMinorUnits;
        slipCurrency = rate.currency;
      } else {
        warnings.push('No compensation record is in force for this period');
      }
      if (first) {
        currency = slipCurrency;
        first = false;
      }

      const slip = buildPayslip({
        currency: slipCurrency,
        grossMinorUnits,
        periodWorkingDays: leave.workingDays,
        unpaidLeaveDays: leave.unpaidLeaveDays,
        absenceDays,
      });

      workers.push({
        workerId,
        currency: slip.currency,
        periodWorkingDays: slip.periodWorkingDays,
        payableDays: slip.payableDays,
        unpaidLeaveDays: slip.unpaidLeaveDays,
        absenceDays: slip.absenceDays,
        grossMinorUnits: slip.grossMinorUnits,
        deductionsMinorUnits: slip.deductionsMinorUnits,
        netMinorUnits: slip.netMinorUnits,
        lines: slip.lines,
        warnings,
      });
    }

    const totals = workers.reduce(
      (acc, w) => ({
        grossMinorUnits: acc.grossMinorUnits + w.grossMinorUnits,
        deductionsMinorUnits: acc.deductionsMinorUnits + w.deductionsMinorUnits,
        netMinorUnits: acc.netMinorUnits + w.netMinorUnits,
      }),
      { grossMinorUnits: 0, deductionsMinorUnits: 0, netMinorUnits: 0 },
    );

    return {
      periodStart: query.periodStart,
      periodEnd: query.periodEnd,
      currency,
      workers,
      totals,
    };
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
