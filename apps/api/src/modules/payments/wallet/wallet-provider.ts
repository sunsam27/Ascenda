import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface EmployerApplication {
  legalName: string;
  registrationNumber: string;
  companyAddress: string;
  representativeName: string;
  representativeEmail: string;
  representativePhone: string;
  representativeRole: string;
}

export interface ProviderWallet {
  setupReference: string;
  walletReference?: string;
  state: 'PENDING_VERIFICATION' | 'ACTIVE' | 'REJECTED';
  /** ACTIVE requires verified corporate KYB/mandate, not merely a PSA's ACTIVE flag. */
  employerVerified: boolean;
  fundingAccount?: { bankName: string; accountName: string; accountNumber: string };
}

export interface FundingEvidence {
  walletReference: string;
  reference: string;
  currency: 'NGN';
  amountMinorUnits: number;
  feeMinorUnits: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REFUNDED';
  /** Must be fetched from the provider, not copied from an unverified webhook. */
  verified: true;
  occurredAt: Date;
}

export interface EmployerTransfer {
  walletReference: string;
  reference: string;
  currency: 'NGN';
  amountMinorUnits: number;
  accountNumber: string;
  accountName: string;
  bankCode: string;
}

export interface PayoutEvidence {
  walletReference: string;
  reference: string;
  currency: 'NGN';
  amountMinorUnits: number;
  feeMinorUnits: number;
  status: 'PROCESSING' | 'PAID' | 'FAILED' | 'REVERSED';
  fundsMovement: 'UNKNOWN' | 'DEBIT_CONFIRMED' | 'NOT_DEBITED' | 'RETURN_CONFIRMED';
  verified: true;
  providerTransferId?: string;
}

/** Server-only approved adapters. No credentials, account identifiers or evidence from request DTOs. */
export interface EmployerFundingProvider {
  readonly id: string;
  readonly mode: 'TEST' | 'LIVE';
  /** Must recover an uncertain creation by this persisted reference, never blindly recreate. */
  createOrRetrieve(setupReference: string, application: EmployerApplication): Promise<ProviderWallet>;
  balance(walletReference: string): Promise<{ availableMinorUnits: number; currency: 'NGN' }>;
  /** Includes provider-confirmed per-transfer fees; reference binds the quote to its request. */
  quote(transfers: EmployerTransfer[]): Promise<{ reference: string; feeMinorUnits: number }[]>;
  /** Must use the subaccount as the debit source and reference as provider idempotency key. */
  submit(transfer: EmployerTransfer): Promise<void>;
  verifyPayout(walletReference: string, reference: string): Promise<PayoutEvidence>;
  fundingTransactions(walletReference: string): Promise<FundingEvidence[]>;
  /** Verify current version's signature and re-query critical transaction data before returning evidence. */
  webhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<{
    walletReference: string;
    funding?: FundingEvidence;
    payout?: PayoutEvidence;
  } | null>;
}

@Injectable()
export class EmployerFundingRegistry {
  // No runtime adapter is approved. Existing merchant payout adapters must NOT
  // be registered here: they debit an organisation-owned merchant wallet.
  configured(): EmployerFundingProvider | null { return null; }

  require(): EmployerFundingProvider {
    const provider = this.configured();
    if (!provider) throw new ServiceUnavailableException('Employer funding is awaiting payment-partner approval. No funding account or live payments are enabled.');
    return provider;
  }
}
