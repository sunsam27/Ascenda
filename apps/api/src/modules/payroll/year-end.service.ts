import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import {
  PermissionScope,
  type PayslipLine,
  type RemittanceSchedule,
  type YearEndLine,
  type YearEndListMeta,
  type YearEndStatement,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { getEffectiveScope } from '../../common/rbac/permissions';
import { AuditService } from '../audit/audit.service';
import {
  aggregateRemittance,
  aggregateStatement,
  buildRemittanceCsv,
  resolveTaxYear,
  type RemittanceCsvRow,
  type RemittancePackInput,
  type StatementPayslipInput,
} from './domain/year-end';
import { renderYearEndPdf } from './domain/year-end-pdf';
import { PayrollConfigService } from './payroll-config.service';

type YearEndRow = Prisma.YearEndStatementGetPayload<Record<string, never>>;

const NO_ACCESS_WHERE = { id: '__ascenda_no_access__' } as const;

function coerceLines(value: Prisma.JsonValue): YearEndLine[] {
  if (!Array.isArray(value)) return [];
  return value as unknown as YearEndLine[];
}

function coercePayslipLines(value: Prisma.JsonValue): PayslipLine[] {
  if (!Array.isArray(value)) return [];
  // Lines are persisted as PayslipLine (`type`); tolerate the run engine's
  // `itemType` shape too so pre-existing rows still aggregate correctly.
  return value.map((raw) => {
    const line = raw as Record<string, unknown>;
    const type = (line.type ?? line.itemType) as PayslipLine['type'];
    return {
      type,
      description: String(line.description ?? ''),
      amountMinorUnits: Number(line.amountMinorUnits ?? 0),
    };
  });
}

/**
 * Project a stored statutory rule pack into the remittance aggregator's input,
 * exposing the validation flag (LOC-03) and the employer-side rule labels so the
 * schedule can name the employer cost line.
 */
function toRemittancePack(
  pack: { validated: boolean; rules: Prisma.JsonValue },
): RemittancePackInput {
  const rules = Array.isArray(pack.rules)
    ? (pack.rules as unknown as Array<Record<string, unknown>>)
    : [];
  const employerLabels = rules
    .filter((rule) => rule.side === 'EMPLOYER')
    .map((rule) => String(rule.label ?? ''))
    .filter((label) => label.length > 0);
  return { validated: pack.validated, employerLabels };
}

export function toYearEndStatement(row: YearEndRow): YearEndStatement {
  return {
    id: row.id,
    organisationId: row.organisationId,
    workerId: row.workerId,
    taxYearLabel: row.taxYearLabel,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    currency: row.currency,
    grossMinorUnits: row.grossMinorUnits,
    deductionsMinorUnits: row.deductionsMinorUnits,
    employerCostsMinorUnits: row.employerCostsMinorUnits,
    netMinorUnits: row.netMinorUnits,
    lines: coerceLines(row.lines),
    payslipCount: row.payslipCount,
    validatedByProfessional: row.validatedByProfessional,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Year-end statements and statutory remittance schedules (PRD PAY-16). Both are
 * reporting artefacts frozen from the payslips a processed run already stores;
 * Ascenda never invents statutory values (LOC-02) and never moves funds. The
 * tax-year window is configuration data (`PayrollConfig.taxYearStartMonth`).
 * Statements are immutable + idempotent per (worker, tax year); access is audited.
 */
@Injectable()
export class YearEndService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: PayrollConfigService,
  ) {}

  async list(query: {
    workerId?: string;
    taxYearLabel?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: YearEndStatement[]; meta: YearEndListMeta }> {
    this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    return this.prisma.withRequestContext(async (tx) => {
      const scopeWhere = await this.resolveScopeWhere(tx);
      const where: Prisma.YearEndStatementWhereInput = {
        AND: [
          scopeWhere,
          {
            ...(query.workerId ? { workerId: query.workerId } : {}),
            ...(query.taxYearLabel
              ? { taxYearLabel: query.taxYearLabel }
              : {}),
          },
        ],
      };
      const [rows, total] = await Promise.all([
        tx.yearEndStatement.findMany({
          where,
          orderBy: [{ taxYearLabel: 'desc' }, { createdAt: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.yearEndStatement.count({ where }),
      ]);
      return {
        data: rows.map(toYearEndStatement),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      };
    });
  }

  async get(id: string): Promise<YearEndStatement> {
    this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await this.findScoped(tx, id);
      return toYearEndStatement(row);
    });
  }

  async download(id: string): Promise<{ statement: YearEndStatement; buffer: Buffer }> {
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

    const statement = toYearEndStatement(row);
    const buffer = await renderYearEndPdf({
      organisationName: org?.name ?? 'Ascenda',
      workerName,
      employeeNumber: worker?.employeeNumber ?? '',
      taxYearLabel: row.taxYearLabel,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      currency: row.currency,
      grossMinorUnits: row.grossMinorUnits,
      deductionsMinorUnits: row.deductionsMinorUnits,
      employerCostsMinorUnits: row.employerCostsMinorUnits,
      netMinorUnits: row.netMinorUnits,
      payslipCount: row.payslipCount,
      validatedByProfessional: row.validatedByProfessional,
      lines: statement.lines,
    });

    await this.audit.record({
      action: AuditAction.YEAR_END_STATEMENT_ACCESSED,
      targetType: 'year_end_statement',
      targetId: row.id,
      newValue: { workerId: row.workerId, taxYearLabel: row.taxYearLabel },
    });

    return { statement, buffer };
  }

  /**
   * Generate (idempotently) one frozen statement per worker who was paid inside
   * the tax year. Reads the org's processed payslips, rolls them up per worker,
   * and creates any missing rows. Returns how many were created.
   */
  async generateForYear(year: number): Promise<{ created: number; taxYearLabel: string }> {
    const { organisationId } = this.requireContext();
    const config = await this.config.get();
    const window = resolveTaxYear(year, config.taxYearStartMonth);

    const created = await this.prisma.withRequestContext(async (tx) => {
      const payslips = await tx.payslip.findMany({
        where: {
          periodStart: { gte: window.start, lt: window.endExclusive },
        },
        orderBy: [{ periodStart: 'asc' }],
      });

      const byWorker = new Map<string, typeof payslips>();
      for (const slip of payslips) {
        const list = byWorker.get(slip.workerId) ?? [];
        list.push(slip);
        byWorker.set(slip.workerId, list);
      }

      const packs = await tx.statutoryRulePack.findMany({
        where: { isActive: true },
        select: { validated: true, rules: true },
      });

      let count = 0;
      for (const [workerId, slips] of byWorker) {
        const existing = await tx.yearEndStatement.findFirst({
          where: { workerId, taxYearLabel: window.label },
        });
        if (existing) continue;

        const inputs: StatementPayslipInput[] = slips.map((slip) => ({
          periodStart: slip.periodStart.toISOString(),
          currency: slip.currency,
          grossMinorUnits: slip.grossMinorUnits,
          deductionsMinorUnits: slip.deductionsMinorUnits,
          employerCostsMinorUnits: slip.employerCostsMinorUnits,
          netMinorUnits: slip.netMinorUnits,
          lines: coercePayslipLines(slip.lines),
        }));
        const totals = aggregateStatement(inputs);
        const remit = aggregateRemittance(inputs, packs.map(toRemittancePack));

        await tx.yearEndStatement.create({
          data: {
            organisationId,
            workerId,
            taxYearLabel: window.label,
            periodStart: window.start,
            periodEnd: window.endExclusive,
            currency: totals.currency,
            grossMinorUnits: totals.grossMinorUnits,
            deductionsMinorUnits: totals.deductionsMinorUnits,
            employerCostsMinorUnits: totals.employerCostsMinorUnits,
            netMinorUnits: totals.netMinorUnits,
            lines: totals.lines as unknown as Prisma.InputJsonValue,
            payslipCount: totals.payslipCount,
            validatedByProfessional: remit.validatedByProfessional,
          },
        });
        count += 1;
      }

      if (count > 0) {
        await this.audit.record({
          action: AuditAction.YEAR_END_STATEMENT_GENERATED,
          targetType: 'year_end',
          targetId: organisationId,
          newValue: {
            taxYearLabel: window.label,
            statementsCreated: count,
          },
        });
      }
      return count;
    });

    return { created, taxYearLabel: window.label };
  }

  /** The whole-tenant remittance schedule for a tax year (no storage). */
  async remittance(year: number): Promise<RemittanceSchedule> {
    const { organisationId } = this.requireContext();
    const config = await this.config.get();
    const window = resolveTaxYear(year, config.taxYearStartMonth);

    return this.prisma.withRequestContext(async (tx) => {
      const payslips = await tx.payslip.findMany({
        where: { periodStart: { gte: window.start, lt: window.endExclusive } },
        orderBy: [{ periodStart: 'asc' }],
      });
      const packs = await tx.statutoryRulePack.findMany({
        where: { isActive: true },
        select: { validated: true, rules: true },
      });
      const inputs: StatementPayslipInput[] = payslips.map((slip) => ({
        periodStart: slip.periodStart.toISOString(),
        currency: slip.currency,
        grossMinorUnits: slip.grossMinorUnits,
        deductionsMinorUnits: slip.deductionsMinorUnits,
        employerCostsMinorUnits: slip.employerCostsMinorUnits,
        netMinorUnits: slip.netMinorUnits,
        lines: coercePayslipLines(slip.lines),
      }));
      const remit = aggregateRemittance(inputs, packs.map(toRemittancePack));
      return {
        taxYearLabel: window.label,
        periodStart: window.start.toISOString(),
        periodEnd: window.endExclusive.toISOString(),
        currency: inputs[0]?.currency ?? '',
        employeeTotalMinorUnits: remit.employeeTotalMinorUnits,
        employerTotalMinorUnits: remit.employerTotalMinorUnits,
        lines: remit.lines,
        validatedByProfessional: remit.validatedByProfessional,
      };
    });
  }

  /** CSV export of the remittance schedule (audited as an export). */
  async exportRemittance(year: number): Promise<{
    filename: string;
    contentType: string;
    content: string;
  }> {
    const schedule = await this.remittance(year);
    const rows: RemittanceCsvRow[] = schedule.lines.map((line) => ({
      taxYearLabel: schedule.taxYearLabel,
      scheme: line.label,
      side: line.side,
      itemType: line.itemType,
      amountMinorUnits: line.amountMinorUnits,
      currency: schedule.currency,
    }));
    await this.audit.record({
      action: AuditAction.REMITTANCE_SCHEDULE_EXPORTED,
      targetType: 'remittance_schedule',
      targetId: schedule.taxYearLabel,
      newValue: {
        taxYearLabel: schedule.taxYearLabel,
        employeeTotalMinorUnits: schedule.employeeTotalMinorUnits,
        employerTotalMinorUnits: schedule.employerTotalMinorUnits,
      },
    });
    return {
      filename: `remittance-${schedule.taxYearLabel.replace('/', '-')}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: buildRemittanceCsv(rows),
    };
  }

  private async findScoped(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<YearEndRow> {
    const scopeWhere = await this.resolveScopeWhere(tx);
    const row = await tx.yearEndStatement.findFirst({
      where: { AND: [{ id }, scopeWhere] },
    });
    if (!row) throw new NotFoundException('Year-end statement not found');
    return row;
  }

  private async resolveScopeWhere(
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.YearEndStatementWhereInput> {
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
