import { randomUUID } from 'node:crypto';
import { OffboardingTaskType, Prisma } from '@ascenda/db';

export interface DefaultOffboardingTask {
  type: OffboardingTaskType;
  title: string;
  description: string;
  sortOrder: number;
}

/** The ONB-03 exit checklist. HR can waive tasks that do not apply. */
export const DEFAULT_OFFBOARDING_TASKS: DefaultOffboardingTask[] = [
  {
    type: OffboardingTaskType.FINAL_PAY,
    title: 'Final pay processed',
    description:
      'Confirm the final payroll run includes the worker through their last working date.',
    sortOrder: 1,
  },
  {
    type: OffboardingTaskType.EQUIPMENT_RETURN,
    title: 'Equipment returned',
    description: 'Record the return of all organisation equipment.',
    sortOrder: 2,
  },
  {
    type: OffboardingTaskType.ACCESS_REMOVAL,
    title: 'System access removed',
    description: 'Revoke workspace, email and system access.',
    sortOrder: 3,
  },
  {
    type: OffboardingTaskType.EXIT_INTERVIEW,
    title: 'Exit interview completed',
    description: 'Capture feedback and the reason for leaving.',
    sortOrder: 4,
  },
  {
    type: OffboardingTaskType.KNOWLEDGE_TRANSFER,
    title: 'Knowledge transfer completed',
    description: 'Hand over responsibilities, files and open work.',
    sortOrder: 5,
  },
];

/** Build the default task rows for a newly created exit case. */
export function buildOffboardingTasks(
  organisationId: string,
  offboardingCaseId: string,
): Prisma.OffboardingTaskCreateManyInput[] {
  return DEFAULT_OFFBOARDING_TASKS.map((task) => ({
    id: randomUUID(),
    organisationId,
    offboardingCaseId,
    type: task.type,
    title: task.title,
    description: task.description,
    isRequired: true,
    sortOrder: task.sortOrder,
  }));
}
