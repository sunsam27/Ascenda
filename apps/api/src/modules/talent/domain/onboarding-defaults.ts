import { randomUUID } from 'node:crypto';
import { OnboardingTaskType, Prisma } from '@ascenda/db';

export interface DefaultOnboardingTask {
  type: OnboardingTaskType;
  title: string;
  description: string;
  sortOrder: number;
}

/** The ONB-01 checklist. Every task is required unless waived by HR. */
export const DEFAULT_ONBOARDING_TASKS: DefaultOnboardingTask[] = [
  {
    type: OnboardingTaskType.PERSONAL_INFO,
    title: 'Personal information completed',
    description: 'Confirm contact details, emergency contact and personal data.',
    sortOrder: 1,
  },
  {
    type: OnboardingTaskType.ID_DOCUMENT,
    title: 'ID document uploaded',
    description: 'Upload a valid identity document to the document store.',
    sortOrder: 2,
  },
  {
    type: OnboardingTaskType.BANK_DETAILS,
    title: 'Bank details provided',
    description: 'Capture the bank account used for salary payments.',
    sortOrder: 3,
  },
  {
    type: OnboardingTaskType.AGREEMENT_SIGNATURE,
    title: 'Employment agreement signed',
    description: 'Collect the signed employment agreement.',
    sortOrder: 4,
  },
  {
    type: OnboardingTaskType.POLICY_ACKNOWLEDGEMENT,
    title: 'Policies acknowledged',
    description: 'Confirm the worker has read the organisation policies.',
    sortOrder: 5,
  },
  {
    type: OnboardingTaskType.MANAGER_MEETING,
    title: 'Manager meeting',
    description: 'Introduce the worker to their manager and agree expectations.',
    sortOrder: 6,
  },
  {
    type: OnboardingTaskType.ORIENTATION,
    title: 'Orientation',
    description: 'Walk through the organisation, team and ways of working.',
    sortOrder: 7,
  },
  {
    type: OnboardingTaskType.EQUIPMENT,
    title: 'Equipment issued',
    description: 'Issue the equipment the role requires and record acceptance.',
    sortOrder: 8,
  },
  {
    type: OnboardingTaskType.TRAINING,
    title: 'Training completed',
    description: 'Complete role, safety and compliance training.',
    sortOrder: 9,
  },
];

const CHUNK_SIZE = 1000;

function chunks<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/**
 * ONB-02: create checklists for workers added through any path (direct create
 * or CSV import). Existing checklists are left untouched, so this is safe to
 * call repeatedly and lazily for older workers.
 */
export async function createOnboardingForWorkers(
  tx: Prisma.TransactionClient,
  organisationId: string,
  workerIds: string[],
  createdBy: string,
): Promise<number> {
  const uniqueWorkerIds = [...new Set(workerIds)];
  if (uniqueWorkerIds.length === 0) return 0;

  const existing = await tx.onboardingChecklist.findMany({
    where: { workerId: { in: uniqueWorkerIds } },
    select: { workerId: true },
  });
  const existingWorkerIds = new Set(existing.map((row) => row.workerId));
  const missing = uniqueWorkerIds.filter((id) => !existingWorkerIds.has(id));
  if (missing.length === 0) return 0;

  const checklists = missing.map((workerId) => ({
    id: randomUUID(),
    organisationId,
    workerId,
    createdBy,
  }));

  for (const batch of chunks(checklists)) {
    await tx.onboardingChecklist.createMany({ data: batch });
  }

  const tasks = checklists.flatMap((checklist) =>
    DEFAULT_ONBOARDING_TASKS.map((task) => ({
      id: randomUUID(),
      organisationId,
      checklistId: checklist.id,
      type: task.type,
      title: task.title,
      description: task.description,
      isRequired: true,
      sortOrder: task.sortOrder,
    })),
  );

  for (const batch of chunks(tasks)) {
    await tx.onboardingTask.createMany({ data: batch });
  }

  return checklists.length;
}
