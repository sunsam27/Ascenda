import { Injectable } from '@nestjs/common';
import { Prisma } from '@ascenda/db';

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
}
