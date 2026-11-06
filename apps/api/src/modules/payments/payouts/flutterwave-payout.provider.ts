import { Injectable } from '@nestjs/common';
import { PayoutProvider, PayoutStatus } from '@ascenda/types';
import {
  asJsonArray,
  asJsonRecord,
  idValue,
  numberValue,
  payoutRequest,
  stringValue,
} from './payout-http';
import {
  PayoutProviderError,
  type CreateTransferInput,
  type PayoutBalance,
  type PayoutGateway,
  type TransferResult,
  type VerifyTransferInput,
  type WebhookTransferUpdate,
} from './payout-provider';

const FLUTTERWAVE_API = 'https://api.flutterwave.com/v3';

function toMajorUnits(minorUnits: number): number {
  return Number((minorUnits / 100).toFixed(2));
}

function toMinorUnits(majorUnits: number): number {
  return Math.round(majorUnits * 100);
}

function mapTransferStatus(status: string | undefined): TransferResult['status'] {
  switch (status?.toLowerCase()) {
    case 'successful':
    case 'success':
      return 'PAID';
    case 'failed':
      return 'FAILED';
    case 'reversed':
      return 'REVERSED';
    default:
      return 'PROCESSING';
  }
}

function failureReason(data: Record<string, unknown>): string | undefined {
  return stringValue(data.complete_message) ?? stringValue(data.message);
}

function payoutStatus(
  event: string,
  rawStatus: string | undefined,
): PayoutStatus {
  const mapped = mapTransferStatus(rawStatus);
  if (mapped === 'PAID') return PayoutStatus.PAID;
  if (mapped === 'FAILED') return PayoutStatus.FAILED;
  if (mapped === 'REVERSED') return PayoutStatus.REVERSED;
  if (event === 'transfer.failed') return PayoutStatus.FAILED;
  if (event === 'transfer.reversed') return PayoutStatus.REVERSED;
  return PayoutStatus.PROCESSING;
}

@Injectable()
export class FlutterwavePayoutProvider implements PayoutGateway {
  readonly provider = PayoutProvider.FLUTTERWAVE;

  async getBalance(
    secretKey: string,
    currency: string,
  ): Promise<PayoutBalance> {
    const body = asJsonRecord(
      await payoutRequest(
        this.provider,
        `${FLUTTERWAVE_API}/balances/${encodeURIComponent(currency.toUpperCase())}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      ),
    );
    const data = asJsonRecord(body.data);
    const available =
      numberValue(data.available_balance) ?? numberValue(data.ledger_balance);
    if (available === undefined) {
      throw new PayoutProviderError(
        `Flutterwave did not return a ${currency.toUpperCase()} balance for this account.`,
      );
    }
    return {
      currency: stringValue(data.currency)?.toUpperCase() ?? currency.toUpperCase(),
      availableMinorUnits: toMinorUnits(available),
      raw: body,
    };
  }

  async createTransfer(
    secretKey: string,
    input: CreateTransferInput,
  ): Promise<TransferResult> {
    const body = asJsonRecord(
      await payoutRequest(this.provider, `${FLUTTERWAVE_API}/transfers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_bank: input.account.bankCode,
          account_number: input.account.accountNumber,
          amount: toMajorUnits(input.amountMinorUnits),
          currency: input.currency.toUpperCase(),
          narration: input.narration,
          reference: input.reference,
          beneficiary_name: input.account.accountName,
        }),
      }),
    );
    if (body.status === 'error') {
      // Explicit rejection: the transfer was not created, so it is safe to
      // record as FAILED (422) rather than waiting for reconciliation.
      throw new PayoutProviderError(
        stringValue(body.message) ?? 'Flutterwave rejected the transfer.',
        422,
      );
    }
    const transfer = asJsonRecord(body.data);
    const rawStatus = stringValue(transfer.status);
    return {
      status: mapTransferStatus(rawStatus),
      providerTransferId:
        idValue(transfer.id) ?? idValue(transfer.reference),
      failureReason: failureReason(transfer),
      raw: body,
    };
  }

  async verifyTransfer(
    secretKey: string,
    input: VerifyTransferInput,
  ): Promise<TransferResult> {
    const url = input.providerTransferId
      ? `${FLUTTERWAVE_API}/transfers/${encodeURIComponent(input.providerTransferId)}`
      : `${FLUTTERWAVE_API}/transfers?reference=${encodeURIComponent(input.reference)}`;
    const body = asJsonRecord(
      await payoutRequest(this.provider, url, {
        headers: { Authorization: `Bearer ${secretKey}` },
      }),
    );
    const transfer = Array.isArray(body.data)
      ? (asJsonArray(body.data)[0] ?? null)
      : asJsonRecord(body.data);
    if (!transfer) {
      throw new PayoutProviderError(
        'Flutterwave could not find this transfer.',
      );
    }
    const rawStatus = stringValue(transfer.status);
    return {
      status: mapTransferStatus(rawStatus),
      providerTransferId:
        idValue(transfer.id) ?? idValue(transfer.reference),
      failureReason: failureReason(transfer),
      raw: body,
    };
  }

  parseWebhook(payload: unknown): WebhookTransferUpdate | null {
    const root = asJsonRecordSafe(payload);
    if (!root) return null;
    const event = stringValue(root.event);
    if (!event?.startsWith('transfer.')) return null;

    const data = asJsonRecordSafe(root.data);
    if (!data) return null;
    const reference = stringValue(data.reference);
    if (!reference) return null;

    const rawStatus = stringValue(data.status);
    const id = idValue(data.id) ?? idValue(data.transfer_id);
    const amount = numberValue(data.amount);
    return {
      eventKey: `flutterwave:${event}:${id ?? reference}:${rawStatus ?? 'unknown'}`,
      eventType: event,
      reference,
      status: payoutStatus(event, rawStatus),
      providerTransferId: id,
      amountMinorUnits: amount === undefined ? undefined : toMinorUnits(amount),
      currency: stringValue(data.currency)?.toUpperCase(),
      failureReason: failureReason(data),
      raw: payload,
    };
  }
}

function asJsonRecordSafe(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}
