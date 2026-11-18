import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditAction } from '@ascenda/db';
import { type AnalyticsOverview, PermissionScope } from '@ascenda/types';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { roleHasPermission } from '../../common/rbac/permissions';
import { resolveReadScope } from '../../common/rbac/worker-scope';
import { AuditService } from '../audit/audit.service';
import { PeopleAnalyticsReader } from '../people/people-analytics.reader';
import { PayrollAnalyticsReader } from '../payroll/payroll-analytics.reader';
import { TimeLeaveAnalyticsReader } from '../time-leave/time-leave-analytics.reader';
import {
  MINIMUM_COHORT,
  attendanceByTeam,
  attendanceTrend,
  departmentUsage,
  leaveTypeBreakdown,
  overviewPeriod,
  payDistribution,
  payrollByDepartment,
  payrollComponents,
  payrollMonths,
  scheduledAttendanceRate,
} from './analytics.domain';
import { OverviewQueryDto } from './dto/overview-query.dto';
import { canReadAnalyticsPayroll } from './analytics-access';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleAnalyticsReader,
    private readonly pay: PayrollAnalyticsReader,
    private readonly time: TimeLeaveAnalyticsReader,
    private readonly audit: AuditService,
  ) {}

  async overview(
    query: OverviewQueryDto,
    sections: { payroll?: boolean; attendance?: boolean; leave?: boolean } = {},
  ): Promise<AnalyticsOverview> {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId || !ctx.role)
      throw new ForbiddenException('Organisation context required');
    const { organisationId, role } = ctx;
    const period = overviewPeriod(query.from, query.to);
    const canRead = (resource: string, scope: PermissionScope) =>
      roleHasPermission(role, { resource, action: 'read', scope });
    if (!canRead('analytics', PermissionScope.TEAM))
      throw new ForbiddenException('Analytics access required');
    const result = await this.prisma.withRequestContext(async (tx) => {
      const analyticsScope = await resolveReadScope(tx, 'analytics', 'read');
      const canReadPayroll =
        analyticsScope.scope === PermissionScope.ORGANISATION &&
        sections.payroll !== false &&
        canReadAnalyticsPayroll(role);
      const workforce = await this.people.overview(
        tx,
        organisationId,
        analyticsScope.where,
        period.start,
        period.endExclusive,
      );
      const assignments = await this.people.assignments(tx, organisationId, analyticsScope.where);
      const departmentByWorker = new Map(assignments.map((a) => [a.workerId, a.department]));
      const usageRows: Parameters<typeof departmentUsage>[0] = [];
      let scheduledRows: Awaited<ReturnType<TimeLeaveAnalyticsReader['scheduledAttendance']>> = [];
      let attendance: AnalyticsOverview['attendance'] = null;
      let leave: AnalyticsOverview['leave'] = null;
      if (sections.attendance !== false && canRead('attendance', PermissionScope.TEAM)) {
        const resourceScope = await resolveReadScope(tx, 'attendance', 'read');
        const attendanceScope = { AND: [analyticsScope.where, resourceScope.where] };
        const [rows, scheduled] = await Promise.all([
          this.time.attendance(
            tx,
            organisationId,
            attendanceScope,
            period.start,
            period.endExclusive,
          ),
          this.time.scheduledAttendance(
            tx,
            organisationId,
            attendanceScope,
            period.start,
            period.endExclusive,
          ),
        ]);
        scheduledRows = scheduled;
        const suppressed =
          rows.length > 0 && new Set(rows.map((r) => r.workerId)).size < MINIMUM_COHORT;
        const count = (status?: string) =>
          suppressed
            ? null
            : rows.reduce((sum, r) => sum + (!status || r.status === status ? r._count : 0), 0);
        const byTeam = attendanceByTeam(scheduled, departmentByWorker);
        const trend = attendanceTrend(scheduled);
        // A hidden team/month must not be recoverable by subtracting visible
        // buckets from the overall scheduled totals.
        const hiddenBucket = [...byTeam, ...trend].some((row) => row.suppressed);
        attendance = {
          suppressed,
          records: count(),
          present: count('PRESENT'),
          late: count('LATE'),
          absent: count('ABSENT'),
          remote: count('REMOTE'),
          scheduled: hiddenBucket ? scheduledAttendanceRate([]) : scheduledAttendanceRate(scheduled),
          byTeam,
          trend,
        };
      }
      if (sections.leave !== false && canRead('leave', PermissionScope.TEAM)) {
        const resourceScope = await resolveReadScope(tx, 'leave', 'read');
        const leaveWhere = { AND: [analyticsScope.where, resourceScope.where] };
        const [rows, byTypeRows] = await Promise.all([
          this.time.leave(tx, organisationId, leaveWhere, period.start, period.endExclusive),
          this.time.leaveByType(tx, organisationId, leaveWhere, period.start, period.endExclusive),
        ]);
        const suppressed = rows.length > 0 && rows.length < MINIMUM_COHORT;
        const byType = suppressed ? [] : leaveTypeBreakdown(byTypeRows);
        leave = {
          suppressed,
          approvedDays: suppressed
            ? null
            : rows.reduce((sum, r) => sum + Number(r._sum.days ?? 0), 0),
          requests: suppressed ? null : rows.reduce((sum, r) => sum + r._count, 0),
          byType,
        };
        for (const row of byTypeRows) {
          usageRows.push({
            workerId: row.workerId,
            department: departmentByWorker.get(row.workerId) ?? 'Unassigned',
            approvedLeaveDays: row.days,
            unapprovedAbsenceDays: 0,
          });
        }
      }
      for (const row of scheduledRows) {
        usageRows.push({
          workerId: row.workerId,
          department: departmentByWorker.get(row.workerId) ?? 'Unassigned',
          approvedLeaveDays: 0,
          unapprovedAbsenceDays: row.unapprovedAbsenceDays,
        });
      }
      const leaveByDepartment = departmentUsage(usageRows);
      if (leave && (leave.byType.some((row) => row.suppressed) || leaveByDepartment.some((row) => row.suppressed))) {
        // Keep the overall totals and any sibling partition from revealing a
        // hidden department or leave type by subtraction.
        leave = { ...leave, approvedDays: null, requests: null, byType: [] };
      }
      let payroll: AnalyticsOverview['payroll'] = null;
      if (canReadPayroll) {
        const [monthly, distributionRows, componentRows] = await Promise.all([
          this.pay.monthly(tx, organisationId, period.start, period.endExclusive),
          this.pay.distribution(tx, organisationId, period.start, period.endExclusive),
          this.pay.components(tx, organisationId, period.start, period.endExclusive),
        ]);
        const byDepartment = payrollByDepartment(
          monthly.map((r) => ({
            workerId: r.workerId,
            department: departmentByWorker.get(r.workerId) ?? 'Unassigned',
            currency: r.currency,
            month: r.periodEnd.toISOString().slice(0, 7),
            grossMinorUnits: r._sum.grossMinorUnits ?? 0,
            employerCostsMinorUnits: r._sum.employerCostsMinorUnits ?? 0,
          })),
        );
        const hiddenMonthCurrencies = new Set(
          byDepartment.filter((row) => row.suppressed).map((row) => `${row.month}|${row.currency}`),
        );
        payroll = {
          months: payrollMonths(monthly).map((month) =>
            hiddenMonthCurrencies.has(`${month.month}|${month.currency}`)
              ? {
                  ...month,
                  suppressed: true,
                  grossMinorUnits: null,
                  netMinorUnits: null,
                  deductionsMinorUnits: null,
                  employerCostsMinorUnits: null,
                  totalCostMinorUnits: null,
                }
              : month,
          ),
          distribution: payDistribution(
            distributionRows.map((r) => ({
              currency: r.currency,
              periodEnd: r.periodEnd,
              workerId: r.workerId,
              grossMinorUnits: r._sum.grossMinorUnits ?? 0,
            })),
          ),
          byDepartment,
          components: payrollComponents(componentRows),
        };
      }
      return {
        from: period.from,
        to: period.to,
        scope:
          analyticsScope.scope === PermissionScope.ORGANISATION
            ? ('organisation' as const)
            : ('team' as const),
        minimumCohort: MINIMUM_COHORT,
        workforce: { ...workforce, leaveByDepartment },
        attendance,
        leave,
        payroll,
      };
    });
    if (result.payroll)
      await this.audit.record({
        action: AuditAction.RESTRICTED_FIELD_ACCESSED,
        targetType: 'analytics',
        targetId: organisationId,
        newValue: { report: 'payroll_overview', from: period.from, to: period.to },
      });
    return result;
  }
}
