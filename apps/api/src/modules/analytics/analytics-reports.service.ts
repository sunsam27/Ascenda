import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuditAction } from '@ascenda/db';
import { PermissionScope, type AnalyticsReport } from '@ascenda/types';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { roleHasPermission } from '../../common/rbac/permissions';
import { resolveReadScope } from '../../common/rbac/worker-scope';
import { PeopleAnalyticsReader } from '../people/people-analytics.reader';
import { AnalyticsService } from './analytics.service';
import { canExportAnalytics, canReadAnalyticsPayroll } from './analytics-access';
import { overviewPeriod } from './analytics.domain';
import { DIRECTORY_COLUMNS, REPORT_DEFINITIONS, summaryReport } from './analytics-reports.domain';
import { ExportReportQueryDto, ReportQueryDto } from './dto/report-query.dto';
import { renderReportCsv, renderReportPdf } from './analytics-report-export';

const MAX_EXPORT_ROWS = 5000;

@Injectable()
export class AnalyticsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleAnalyticsReader,
    private readonly analytics: AnalyticsService,
  ) {}

  private context() {
    const ctx = getRequestContext();
    if (
      !ctx?.organisationId ||
      !ctx.userId ||
      !ctx.role ||
      !roleHasPermission(ctx.role, {
        resource: 'analytics',
        action: 'read',
        scope: PermissionScope.TEAM,
      })
    )
      throw new ForbiddenException('Analytics organisation context required');
    return { organisationId: ctx.organisationId, userId: ctx.userId, role: ctx.role };
  }

  catalogue() {
    const { role } = this.context();
    const read = (resource: string) =>
      roleHasPermission(role, { resource, action: 'read', scope: PermissionScope.TEAM });
    return {
      data: REPORT_DEFINITIONS.filter((report) => {
        switch (report.type) {
          case 'employee':
            return read('workers');
          case 'payroll':
          case 'pay-distribution':
          case 'workforce-cost':
            return canReadAnalyticsPayroll(role);
          case 'attendance':
            return read('attendance');
          case 'leave':
          case 'leave-types':
            return read('leave');
          case 'department':
          case 'retention':
          case 'tenure':
            return true;
        }
      }),
      canExport: canExportAnalytics(role),
      maxExportRows: MAX_EXPORT_ROWS,
    };
  }

  private async build(query: ReportQueryDto, exporting = false): Promise<AnalyticsReport> {
    const ctx = this.context();
    const definition = this.catalogue().data.find((report) => report.type === query.type);
    if (!definition) throw new ForbiddenException('This report is not available to your role');
    const period = overviewPeriod(query.from, query.to);
    const page = exporting ? 1 : (query.page ?? 1);
    const pageSize = exporting ? MAX_EXPORT_ROWS + 1 : (query.pageSize ?? 25);
    const skip = (page - 1) * pageSize;
    let scope: 'organisation' | 'team';
    let total: number;
    let columns: AnalyticsReport['columns'];
    let rows: AnalyticsReport['rows'];
    if (query.type === 'employee') {
      const directory = await this.prisma.withRequestContext(async (tx) => {
        const analyticsScope = await resolveReadScope(tx, 'analytics', 'read');
        const workerScope = await resolveReadScope(tx, 'workers', 'read');
        return {
          ...(await this.people.directory(
            tx,
            ctx.organisationId,
            { AND: [analyticsScope.where, workerScope.where] },
            period.endExclusive,
            skip,
            pageSize,
          )),
          scope:
            analyticsScope.scope === PermissionScope.ORGANISATION
              ? ('organisation' as const)
              : ('team' as const),
        };
      });
      scope = directory.scope;
      total = directory.total;
      rows = directory.rows;
      columns = DIRECTORY_COLUMNS;
    } else {
      const overview = await this.analytics.overview(query, {
        payroll: ['payroll', 'pay-distribution', 'workforce-cost'].includes(query.type),
        attendance: query.type === 'attendance',
        leave: ['leave', 'leave-types'].includes(query.type),
      });
      const summary = summaryReport(query.type, overview);
      scope = overview.scope;
      total = summary.rows.length;
      columns = summary.columns;
      rows = summary.rows.slice(skip, skip + pageSize);
    }
    if (exporting && (total > MAX_EXPORT_ROWS || rows.length > MAX_EXPORT_ROWS))
      throw new BadRequestException(
        `Report exceeds ${MAX_EXPORT_ROWS} rows; use a smaller report scope or request an offline export`,
      );
    if (exporting && rows.length !== total)
      throw new BadRequestException(
        'The report changed while being prepared; please try the export again',
      );
    return {
      ...definition,
      from: period.from,
      to: period.to,
      scope,
      generatedAt: new Date().toISOString(),
      columns,
      rows,
      meta: {
        page,
        pageSize: exporting ? Math.max(total, 1) : pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      canExport: canExportAnalytics(ctx.role),
    };
  }

  preview(query: ReportQueryDto) {
    return this.build(query);
  }

  async export(query: ExportReportQueryDto) {
    const ctx = this.context();
    if (!canExportAnalytics(ctx.role))
      throw new ForbiddenException('Only Owners can export analytics reports');
    const report = await this.build({ ...query, page: 1, pageSize: 25 }, true);
    const exportedAt = new Date().toISOString();
    const watermark = { organisationId: ctx.organisationId, actorId: ctx.userId, exportedAt };
    const content =
      query.format === 'csv'
        ? Buffer.from(renderReportCsv(report, watermark), 'utf8')
        : await renderReportPdf(report, watermark);
    // Fail closed: unlike best-effort read auditing, a download must not be returned if its audit write fails.
    await this.prisma.withRequestContext((tx) =>
      tx.auditLog.create({
        data: {
          organisationId: ctx.organisationId,
          actorId: ctx.userId,
          actorEmail: getRequestContext()?.userEmail ?? '',
          action: AuditAction.EXPORT_CREATED,
          targetType: 'analytics_report',
          targetId: query.type,
          newValue: {
            report: query.type,
            format: query.format,
            from: report.from,
            to: report.to,
            scope: report.scope,
            rowCount: report.rows.length,
            exportedAt,
          },
          ipAddress: getRequestContext()?.ipAddress ?? '',
          userAgent: getRequestContext()?.userAgent ?? '',
        },
      }),
    );
    return {
      content,
      filename: `ascenda-${query.type}-${report.from}-${report.to}.${query.format}`,
      contentType: query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
    };
  }
}
