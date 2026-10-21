import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import {
  PermissionScope,
  type Payslip,
  type PayslipLine,
  type PayslipListQuery,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { getEffectiveScope } from '../../common/rbac/permissions';
import { AuditService } from '../audit/audit.service';
import { formatMinorUnits, renderPayslipPdf } from './domain/payslip-pdf';
import type { PreparedLine } from './domain/run-calc';

type PayslipRow = Prisma.PayslipGetPayload<Record<string, never>>;

const NO_ACCESS_WHERE = { id: '__ascenda_no_access__' } as const;

function coerceLines(value: Prisma.JsonValue): PayslipLine[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as PayslipLine[];
}

export function toPayslip(row: PayslipRow): Payslip {
  return {
    id: row.id,
    organisationId: row.organisationId,
    payrollRunId: row.payrollRunId,
    workerId: row.workerId,
    periodLabel: row.periodLabel,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    currency: row.currency,
    grossMinorUnits: row.grossMinorUnits,
    deductionsMinorUnits: row.deductionsMinorUnits,
    employerCostsMinorUnits: row.employerCostsMinorUnits,
    netMinorUnits: row.netMinorUnits,
    lines: coerceLines(row.lines),
    availableAt: row.availableAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Payslips (PRD PAY-13). One immutable payslip per worker per processed run,
 * generated from the run's frozen item lines so the document always reconciles
 * to the run totals. Workers may read/download only their own payslips; payroll
 * roles see the whole tenant. Access is audited (PAYSLIP_GENERATED /
 * PAYSLIP_ACCESSED).
 */
@Injectable()
export class PayslipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PayslipListQuery): Promise<{
    data: Payslip[];
    meta: { total: number; page: number; pageSize: number; totalPages: number };
  }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const scopeWhere = await this.resolveScopeWhere(tx);
      const where: Prisma.PayslipWhereInput = {
        AND: [
          scopeWhere,
          {
            ...(query.payrollRunId ? { payrollRunId: query.payrollRunId } : {}),
            ...(query.workerId ? { workerId: query.workerId } : {}),
          },
        ],
      };
      const [rows, total] = await Promise.all([
        tx.payslip.findMany({
          where,
          orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.payslip.count({ where }),
      ]);
      return {
        data: rows.map(toPayslip),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<Payslip> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await this.findScoped(tx, id);
      return toPayslip(row);
    });
  }

  async download(id: string): Promise<{ payslip: Payslip; buffer: Buffer }> {
    this.requireContext();
    const row = await this.prisma.withRequestContext((tx) =>
      this.findScoped(tx, id),
    );

    const worker = await this.prisma.withRequestContext((tx) =>
      tx.worker.findFirst({
        where: { id: row.workerId },
        select: {
          firstName: true,
          lastName: true,
          preferredName: true,
          employeeNumber: true,
        },
      }),
    );
    const org = await this.prisma.withRequestContext((tx) =>
      tx.organisation.findFirst({
        where: { id: row.organisationId },
        select: { name: true },
      }),
    );

    const workerName = worker
      ? worker.preferredName?.trim() ||
        `${worker.firstName} ${worker.lastName}`.trim()
      : 'Worker';

    const payslip = toPayslip(row);
    const buffer = await renderPayslipPdf({
      organisationName: org?.name ?? 'Ascenda',
      workerName,
      employeeNumber: worker?.employeeNumber ?? '',
      periodLabel: row.periodLabel,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      currency: row.currency,
      grossMinorUnits: row.grossMinorUnits,
      deductionsMinorUnits: row.deductionsMinorUnits,
      employerCostsMinorUnits: row.employerCostsMinorUnits,
      netMinorUnits: row.netMinorUnits,
      lines: payslip.lines,
    });

    await this.audit.record({
      action: AuditAction.PAYSLIP_ACCESSED,
      targetType: 'payslip',
      targetId: row.id,
      newValue: {
        workerId: row.workerId,
        payrollRunId: row.payrollRunId,
        net: formatMinorUnits(row.netMinorUnits, row.currency),
      },
    });

    return { payslip, buffer };
  }

  /**
   * Generate (idempotently) one payslip per worker in a processed run from the
   * run's frozen item lines. Called by the run engine at `process`. Returns the
   * number of payslips created.
   */
  async generateForRun(
    tx: Prisma.TransactionClient,
    run: {
      id: string;
      organisationId: string;
      periodStart: Date;
      periodEnd: Date;
      currency: string;
    },
    linesByWorker: Map<string, PreparedLine[]>,
    employerCostsByWorker: Map<string, number>,
    periodLabel: string,
  ): Promise<number> {
    const existing = await tx.payslip.count({
      where: { payrollRunId: run.id },
    });
    if (existing > 0) return 0;

    let created = 0;
    for (const [workerId, lines] of linesByWorker) {
      let gross = 0;
      let deductions = 0;
      let net = 0;
      // Persist as the frozen PayslipLine contract (the run engine's lines use
      // the `itemType` field; a payslip line exposes it as `type`). Year-end
      // statements and remittance schedules read `.type` off these lines.
      const payslipLines: PayslipLine[] = lines.map((line) => ({
        type: line.itemType as unknown as PayslipLine['type'],
        description: line.description,
        amountMinorUnits: line.amountMinorUnits,
      }));
      for (const line of payslipLines) {
        net += line.amountMinorUnits;
        if (line.amountMinorUnits >= 0) gross += line.amountMinorUnits;
        else deductions += -line.amountMinorUnits;
      }
      const employerCosts = employerCostsByWorker.get(workerId) ?? 0;

      await tx.payslip.create({
        data: {
          organisationId: run.organisationId,
          payrollRunId: run.id,
          workerId,
          periodLabel,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          currency: run.currency,
          grossMinorUnits: gross,
          deductionsMinorUnits: deductions,
          employerCostsMinorUnits: employerCosts,
          netMinorUnits: net,
          lines: payslipLines as unknown as Prisma.InputJsonValue,
        },
      });
      created += 1;
    }

    if (created > 0) {
      await this.audit.record({
        action: AuditAction.PAYSLIP_GENERATED,
        targetType: 'payroll_run',
        targetId: run.id,
        newValue: { payslipsCreated: created },
      });
    }
    return created;
  }

  private async findScoped(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<PayslipRow> {
    const scopeWhere = await this.resolveScopeWhere(tx);
    const row = await tx.payslip.findFirst({
      where: { AND: [{ id }, scopeWhere] },
    });
    if (!row) throw new NotFoundException('Payslip not found');
    return row;
  }

  /**
   * ORGANISATION roles see every payslip in the tenant; SELF roles see only
   * their own worker record's payslips; everyone else sees nothing.
   */
  private async resolveScopeWhere(
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.PayslipWhereInput> {
    const ctx = getRequestContext();
    const scope = getEffectiveScope(ctx?.role, 'payslips', 'read');
    if (scope === PermissionScope.ORGANISATION) return {};
    if (scope === PermissionScope.SELF && ctx?.userId) {
      const worker = await tx.worker.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      return worker ? { workerId: worker.id } : { ...NO_ACCESS_WHERE };
    }
    return { ...NO_ACCESS_WHERE };
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
