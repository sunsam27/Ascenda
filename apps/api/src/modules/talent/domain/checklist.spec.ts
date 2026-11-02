import { ChecklistTaskStatus, ExitReason, WorkerStatus } from '@ascenda/types';
import {
  isChecklistComplete,
  summariseChecklist,
  workerStatusForExit,
} from './checklist';

const task = (
  status: ChecklistTaskStatus,
  isRequired = true,
): { status: ChecklistTaskStatus; isRequired: boolean } => ({
  status,
  isRequired,
});

describe('summariseChecklist', () => {
  it('reports zero progress for an untouched required checklist', () => {
    expect(
      summariseChecklist([
        task(ChecklistTaskStatus.PENDING),
        task(ChecklistTaskStatus.PENDING),
      ]),
    ).toEqual({
      totalTasks: 2,
      resolvedTasks: 0,
      outstandingTasks: 2,
      progressPct: 0,
    });
  });

  it('counts completed and waived tasks as resolved', () => {
    expect(
      summariseChecklist([
        task(ChecklistTaskStatus.COMPLETED),
        task(ChecklistTaskStatus.WAIVED),
        task(ChecklistTaskStatus.PENDING),
        task(ChecklistTaskStatus.COMPLETED),
      ]),
    ).toEqual({
      totalTasks: 4,
      resolvedTasks: 3,
      outstandingTasks: 1,
      progressPct: 75,
    });
  });

  it('ignores optional tasks when calculating required progress', () => {
    expect(
      summariseChecklist([
        task(ChecklistTaskStatus.COMPLETED),
        task(ChecklistTaskStatus.PENDING, false),
      ]),
    ).toEqual({
      totalTasks: 2,
      resolvedTasks: 1,
      outstandingTasks: 0,
      progressPct: 100,
    });
    expect(
      isChecklistComplete([
        task(ChecklistTaskStatus.COMPLETED),
        task(ChecklistTaskStatus.PENDING, false),
      ]),
    ).toBe(true);
  });

  it('treats a checklist with no tasks as complete', () => {
    expect(summariseChecklist([])).toEqual({
      totalTasks: 0,
      resolvedTasks: 0,
      outstandingTasks: 0,
      progressPct: 100,
    });
  });
});

describe('workerStatusForExit', () => {
  it('maps a resignation to RESIGNED', () => {
    expect(workerStatusForExit(ExitReason.RESIGNATION)).toBe(
      WorkerStatus.RESIGNED,
    );
  });

  it('maps every other reason to TERMINATED', () => {
    for (const reason of [
      ExitReason.DISMISSAL,
      ExitReason.CONTRACT_END,
      ExitReason.RETIREMENT,
      ExitReason.REDUNDANCY,
      ExitReason.OTHER,
    ]) {
      expect(workerStatusForExit(reason)).toBe(WorkerStatus.TERMINATED);
    }
  });
});
