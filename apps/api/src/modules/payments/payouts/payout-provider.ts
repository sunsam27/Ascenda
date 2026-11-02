import type { PayoutProvider, PayoutStatus } from '@ascenda/types';

export interface PayoutBankAccount {
  accountName: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  country: string;
}

export interface PayoutBalance {
  currency: string;
  availableMinorUnits: number;
  raw: unknown;
}

export interface CreateTransferInput {
  reference: string;
  amountMinorUnits: number;
  currency: string;
  country: string;
  narration: string;
  account: PayoutBankAccount;
}

export interface TransferResult {
  status: 'PROCESSING' | 'PAID' | 'FAILED' | 'REVERSED';
  providerTransferId?: string;
  recipientCode?: string;
  failureReason?: string;
  raw: unknown;
}

export interface VerifyTransferInput {
  reference: string;
  providerTransferId?: string;
}

export interface WebhookTransferUpdate {
  eventKey: string;
  eventType: string;
  reference: string;
  status: PayoutStatus;
  providerTransferId?: string;
  amountMinorUnits?: number;
  currency?: string;
  failureReason?: string;
  raw: unknown;
}

export interface PayoutGateway {
  readonly provider: PayoutProvider;
  getBalance(secretKey: string, currency: string): Promise<PayoutBalance>;
  createTransfer(
    secretKey: string,
    input: CreateTransferInput,
  ): Promise<TransferResult>;
  verifyTransfer(
    secretKey: string,
    input: VerifyTransferInput,
  ): Promise<TransferResult>;
  parseWebhook(payload: unknown): WebhookTransferUpdate | null;
}

export class PayoutProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retriable = false,
  ) {
    super(message);
    this.name = 'PayoutProviderError';
  }
}
