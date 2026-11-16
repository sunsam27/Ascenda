export type EmployerWalletState = 'NOT_STARTED' | 'PENDING_VERIFICATION' | 'ACTIVE' | 'REJECTED';

export interface EmployerWalletSummary {
  status: EmployerWalletState;
  currency: 'NGN';
  mode: 'TEST' | 'LIVE' | null;
  providerReady: boolean;
  message: string;
  pendingMinorUnits: number;
  availableMinorUnits: number;
  reservedMinorUnits: number;
  paidMinorUnits: number;
  lastReconciledAt: string | null;
  reconciliationRequired: boolean;
  fundingAccount: { bankName: string; accountName: string; accountNumber: string } | null;
}

export interface EmployerWalletLedgerEntry {
  id: string;
  type: string;
  status: string;
  amountMinorUnits: number;
  currency: string;
  providerReference: string;
  payrollRunId: string | null;
  paymentBatchId: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface EmployerWalletQuote {
  paymentBatchId: string;
  payrollRunId: string;
  currency: 'NGN';
  paymentCount: number;
  netMinorUnits: number;
  feeMinorUnits: number | null;
  requiredMinorUnits: number | null;
  availableMinorUnits: number;
  shortfallMinorUnits: number | null;
  canSubmit: boolean;
  message: string;
}

export interface EmployerWalletPayment {
  reference: string;
  paymentId: string;
  paymentBatchId: string;
  payrollRunId: string;
  workerName: string;
  employeeNumber: string;
  amountMinorUnits: number;
  feeReservedMinorUnits: number;
  status: string;
  attemptNumber: number;
  createdAt: string;
  completedAt: string | null;
}
