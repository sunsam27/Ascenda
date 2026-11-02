import { ChecklistTaskStatus, ExitReason, WorkerStatus } from '@ascenda/types';

export interface ChecklistTaskLike {
  status: ChecklistTaskStatus | string;
  isRequired: boolean;
}

export interface ChecklistProgress {
  totalTasks: number;
  resolvedTasks: number;
  outstandingTasks: number;
  progressPct: number;
}

function isResolved(task: ChecklistTaskLike): boolean {
  return (
    task.status === ChecklistTaskStatus.COMPLETED ||
    task.status === ChecklistTaskStatus.WAIVED
  );
}

/**
 * Progress is measured against required tasks only, so waiving a task that
 * does not apply still lets onboarding/offboarding finish. A checklist with no
 * required tasks is complete by definition.
 */
export function summariseChecklist(
  tasks: ChecklistTaskLike[],
): ChecklistProgress {
  const required = tasks.filter((task) => task.isRequired);
  const resolved = required.filter(isResolved).length;
  const progressPct =
    required.length === 0
      ? 100
      : Math.round((resolved / required.length) * 100);

  return {
    totalTasks: tasks.length,
    resolvedTasks: resolved,
    outstandingTasks: required.length - resolved,
    progressPct,
  };
}

export function isChecklistComplete(tasks: ChecklistTaskLike[]): boolean {
  return summariseChecklist(tasks).outstandingTasks === 0;
}

/**
 * ONB-03: a resignation changes the worker to RESIGNED; every other exit
 * reason (dismissal, contract end, retirement, redundancy, other) uses
 * TERMINATED, matching the worker statuses already understood by payroll and
 * analytics.
 */
export function workerStatusForExit(reason: ExitReason | string): WorkerStatus {
  return reason === ExitReason.RESIGNATION
    ? WorkerStatus.RESIGNED
    : WorkerStatus.TERMINATED;
}
