import { Injectable } from '@nestjs/common';
import { Prisma } from '@ascenda/db';
import type { AnalyticsOverview } from '@ascenda/types';
import { retentionSummary, tenureSummary } from '../analytics/analytics.domain';

const DAY_MS = 86_400_000;

function snapshotWhere(
  organisationId: string,
  scope: Prisma.WorkerWhereInput,
  endExclusive: Date,
): Prisma.WorkerWhereInput {
  return {
    organisationId,
    AND: [scope],
    status: { not: 'DRAFT' },
    startDate: { lt: endExclusive },
    OR: [
      { endDate: { gte: new Date(endExclusive.getTime() - DAY_MS) } },
      { endDate: null, status: { in: ['ACTIVE', 'ON_LEAVE', 'PROBATION'] } },
    ],
  };
}

/** Read-only People interfaces for ANA-01/04; return only the permitted report projections. */
@Injectable()
export class PeopleAnalyticsReader {
  /** ANA-04 directory projection: no bank, compensation, identity or medical fields. */
  async directory(
    tx: Prisma.TransactionClient,
    organisationId: string,
    scope: Prisma.WorkerWhereInput,
    endExclusive: Date,
    skip: number,
    take: number,
  ) {
    const where = snapshotWhere(organisationId, scope, endExclusive);
    const [total, rows] = await Promise.all([
      tx.worker.count({ where }),
      tx.worker.findMany({
        where,
        skip,
        take,
        orderBy: [{ employeeNumber: 'asc' }, { id: 'asc' }],
        select: {
          employeeNumber: true,
          firstName: true,
          lastName: true,
          category: true,
          status: true,
          jobTitle: true,
          startDate: true,
          endDate: true,
          department: { select: { name: true } },
          location: { select: { name: true } },
        },
      }),
    ]);
    return {
      total,
      rows: rows.map((row) => ({
        employeeNumber: row.employeeNumber,
        name: `${row.firstName} ${row.lastName}`,
        category: row.category,
        status: row.status,
        jobTitle: row.jobTitle,
        department: row.department?.name ?? 'Unassigned',
        location: row.location?.name ?? 'Unassigned',
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate?.toISOString().slice(0, 10) ?? '',
      })),
    };
  }

  async overview(
    tx: Prisma.TransactionClient,
    organisationId: string,
    scope: Prisma.WorkerWhereInput,
    start: Date,
    endExclusive: Date,
  ): Promise<AnalyticsOverview['workforce']> {
    const base: Prisma.WorkerWhereInput = {
      organisationId,
      AND: [scope],
      status: { not: 'DRAFT' },
    };
    const snapshot = snapshotWhere(organisationId, scope, endExclusive);
    const startSnapshot = snapshotWhere(
      organisationId,
      scope,
      new Date(start.getTime() + DAY_MS),
    );
    const [headcount, joiners, exits, categories, departments, locations, statuses, tenureRows, eligible, retained] =
      await Promise.all([
        tx.worker.count({ where: snapshot }),
        tx.worker.count({ where: { AND: [base, { startDate: { gte: start, lt: endExclusive } }] } }),
        tx.worker.count({ where: { AND: [base, { endDate: { gte: start, lt: endExclusive } }] } }),
        tx.worker.groupBy({ by: ['category'], where: snapshot, _count: true }),
        tx.worker.groupBy({ by: ['departmentId'], where: snapshot, _count: true }),
        tx.worker.groupBy({ by: ['locationId'], where: snapshot, _count: true }),
        tx.worker.groupBy({ by: ['status'], where: snapshot, _count: true }),
        tx.worker.findMany({ where: snapshot, select: { startDate: true, endDate: true } }),
        tx.worker.count({ where: startSnapshot }),
        tx.worker.count({ where: { AND: [startSnapshot, snapshot] } }),
      ]);
    const [departmentNames, locationNames] = await Promise.all([
      tx.department.findMany({
        where: {
          organisationId,
          id: { in: departments.flatMap((r) => (r.departmentId ? [r.departmentId] : [])) },
        },
        select: { id: true, name: true },
      }),
      tx.location.findMany({
        where: {
          organisationId,
          id: { in: locations.flatMap((r) => (r.locationId ? [r.locationId] : [])) },
        },
        select: { id: true, name: true },
      }),
    ]);
    const sort = (rows: { label: string; count: number }[]) =>
      rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const periodEnd = new Date(endExclusive.getTime() - DAY_MS);
    return {
      headcount,
      joiners,
      exits,
      statuses: sort(statuses.map((r) => ({ label: r.status, count: r._count }))),
      retention: retentionSummary(eligible, retained),
      tenure: tenureSummary(tenureRows, periodEnd),
      categories: sort(categories.map((r) => ({ label: r.category, count: r._count }))),
      departments: sort(
        departments.map((r) => ({
          label: departmentNames.find((d) => d.id === r.departmentId)?.name ?? 'Unassigned',
          count: r._count,
        })),
      ),
      locations: sort(
        locations.map((r) => ({
          label: locationNames.find((l) => l.id === r.locationId)?.name ?? 'Unassigned',
          count: r._count,
        })),
      ),
    };
  }
}
