/** Only the identity fields needed to make payment rows understandable. */
export const paymentWorkerSelect = {
  firstName: true,
  lastName: true,
  employeeNumber: true,
} as const;

export interface PaymentWorker {
  firstName: string;
  lastName: string;
  employeeNumber: string;
}

export function paymentWorkerIdentity(worker?: PaymentWorker | null): {
  workerName?: string;
  employeeNumber?: string;
} {
  return {
    workerName: worker
      ? `${worker.firstName} ${worker.lastName}`.trim() || undefined
      : undefined,
    employeeNumber: worker?.employeeNumber || undefined,
  };
}
