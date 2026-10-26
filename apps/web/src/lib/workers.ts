import {
  WorkerStatus,
  type PaginationMeta,
  type WorkerSummary,
} from '@ascenda/types';
import { api } from '@/lib/api';

/** The workers list caps `pageSize` at 100, so walk the pages to get them all. */
const WORKER_PAGE_SIZE = 100;
const WORKER_MAX_PAGES = 20;

export async function fetchAllWorkers(): Promise<WorkerSummary[]> {
  const rows: WorkerSummary[] = [];
  for (let page = 1; page <= WORKER_MAX_PAGES; page += 1) {
    const res = await api.get<{ data: WorkerSummary[]; meta: PaginationMeta }>(
      '/workers',
      { params: { page, pageSize: WORKER_PAGE_SIZE } },
    );
    rows.push(...res.data.data);
    const totalPages = res.data.meta?.totalPages ?? 1;
    if (page >= totalPages) break;
  }
  return rows;
}

/** Employed people you can raise leave for / hand a step off to / clock in. */
const SELECTABLE_WORKER_STATUSES: ReadonlySet<WorkerStatus> = new Set([
  WorkerStatus.ACTIVE,
  WorkerStatus.ON_LEAVE,
  WorkerStatus.PROBATION,
]);

export function isSelectableWorker(worker: WorkerSummary): boolean {
  return SELECTABLE_WORKER_STATUSES.has(worker.status);
}

export function activeWorkersOf(workers: WorkerSummary[]): WorkerSummary[] {
  return workers.filter(isSelectableWorker);
}

export function workerDisplayName(worker: WorkerSummary): string {
  return `${worker.firstName} ${worker.lastName}`.trim();
}
