import { Injectable } from '@nestjs/common';
import { PayrollItemType, Prisma } from '@ascenda/db';

/** ANA-02 reads frozen payslips, never current compensation or mutable draft totals. */
@Injectable()
export class PayrollAnalyticsReader {
  monthly(tx: Prisma.TransactionClient, organisationId: string, start: Date, endExclusive: Date) {
    return tx.payslip.groupBy({
      by: ['currency', 'periodEnd', 'workerId'],
      where: {
        organisationId,
        periodEnd: { gte: start, lt: endExclusive },
        payrollRun: {
          is: {
            organisationId,
            status: { in: ['PROCESSED', 'LOCKED'] },
            reversedAt: null,
            reversalOfRunId: null,
          },
        },
      },
      _sum: {
        grossMinorUnits: true,
        netMinorUnits: true,
        deductionsMinorUnits: true,
        employerCostsMinorUnits: true,
      },
    });
  }

  /** Individual gross totals by period month/currency for relative pay-band counts. */
  distribution(tx: Prisma.TransactionClient, organisationId: string, start: Date, endExclusive: Date) {
    return tx.payslip.groupBy({
      by: ['currency', 'periodEnd', 'workerId'],
      where: {
        organisationId,
        periodEnd: { gte: start, lt: endExclusive },
        payrollRun: {
          is: {
            organisationId,
            status: { in: ['PROCESSED', 'LOCKED'] },
            reversedAt: null,
            reversalOfRunId: null,
          },
        },
      },
      _sum: { grossMinorUnits: true },
    });
  }

  /** Frozen payslip lines by pay type; never reads current compensation. */
  async components(tx: Prisma.TransactionClient, organisationId: string, start: Date, endExclusive: Date) {
    const rows = await tx.payslip.findMany({
      where: {
        organisationId,
        periodEnd: { gte: start, lt: endExclusive },
        payrollRun: {
          is: {
            organisationId,
            status: { in: ['PROCESSED', 'LOCKED'] },
            reversedAt: null,
            reversalOfRunId: null,
          },
        },
      },
      select: {
        workerId: true,
        currency: true,
        periodEnd: true,
        grossMinorUnits: true,
        lines: true,
        worker: { select: { category: true } },
      },
    });
    return rows.map((row) => {
      const lines = Array.isArray(row.lines)
        ? (row.lines as { type?: string; amountMinorUnits?: number }[])
        : [];
      const sum = (type: PayrollItemType) =>
        lines
          .filter((line) => line?.type === type)
          .reduce((total, line) => total + Math.max(0, Number(line.amountMinorUnits ?? 0)), 0);
      return {
        workerId: row.workerId,
        category: row.worker.category,
        currency: row.currency,
        month: row.periodEnd.toISOString().slice(0, 7),
        grossMinorUnits: row.grossMinorUnits,
        overtimeMinorUnits: sum(PayrollItemType.OVERTIME),
        bonusMinorUnits: sum(PayrollItemType.BONUS),
        allowanceMinorUnits: sum(PayrollItemType.ALLOWANCE),
        volunteerStipendMinorUnits: sum(PayrollItemType.STIPEND),
      };
    });
  }
}
