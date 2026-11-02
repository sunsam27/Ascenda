import { Injectable } from '@nestjs/common';
import { PayoutProvider, PayoutStatus } from '@ascenda/types';
import {
  asJsonRecord,
  asJsonArray,
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

const PAYSTACK_API = 'https://api.paystack.co';

const RECIPIENT_TYPE_BY_CURRENCY: Record<string, string> = {
  NGN: 'nuban',
  GHS: 'ghipss',
  ZAR: 'basa',
  KES: 'kepss',
};

const OTP_REASON =
  'Paystack blocked this transfer because transfer OTP is enabled. Disable transfer OTP in the Paystack dashboard before using automated payouts.';

function mapTransferStatus(status: string | undefined): TransferResult['status'] {
  switch (status?.toLowerCase()) {
    case 'success':
    case 'successful':
      return 'PAID';
    case 'failed':
    case 'reversed':
      return status.toLowerCase() === 'reversed' ? 'REVERSED' : 'FAILED';
    case 'otp':
      return 'FAILED';
    default:
      return 'PROCESSING';
  }
}

function failureReason(data: Record<string, unknown>): string | undefined {
  return (
    stringValue(data.reason) ??
    stringValue(data.gateway_response) ??
    stringValue(data.complete_message)
  );
}

@Injectable()
export class PaystackPayoutProvider implements PayoutGateway {
  readonly provider = PayoutProvider.PAYSTACK;

  async getBalance(
    secretKey: string,
    currency: string,
  ): Promise<PayoutBalance> {
    const body = asJsonRecord(
      await payoutRequest(this.provider, `${PAYSTACK_API}/balance`, {
        headers: { Authorization: `Bearer ${secretKey}` },
      }),
    );
    const balances = asJsonArray(body.data);
    const match = balances.find(
      (item) =>
        stringValue(item.currency)?.toUpperCase() === currency.toUpperCase(),
    );
    if (!match) {
      throw new PayoutProviderError(
        `Paystack did not return a ${currency.toUpperCase()} balance for this account.`,
      );
    }
    const balance = numberValue(match.balance);
    if (balance === undefined) {
      throw new PayoutProviderError(
        'Paystack returned an unreadable balance for this account.',
      );
    }
    return {
      currency: currency.toUpperCase(),
      availableMinorUnits: Math.round(balance),
      raw: body,
    };
  }

  async createTransfer(
    secretKey: string,
    input: CreateTransferInput,
  ): Promise<TransferResult> {
    const recipientType =
      RECIPIENT_TYPE_BY_CURRENCY[input.currency.toUpperCase()] ?? 'nuban';

    const recipientBody = asJsonRecord(
      await payoutRequest(this.provider, `${PAYSTACK_API}/transferrecipient`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: recipientType,
          name: input.account.accountName,
          account_number: input.account.accountNumber,
          bank_code: input.account.bankCode,
          currency: input.currency.toUpperCase(),
        }),
      }),
    );
    const recipient = asJsonRecord(recipientBody.data);
    const recipientCode = stringValue(recipient.recipient_code);
    if (!recipientCode) {
      throw new PayoutProviderError(
        'Paystack did not return a transfer recipient code.',
      );
    }

    const transferBody = asJsonRecord(
      await payoutRequest(this.provider, `${PAYSTACK_API}/transfer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'balance',
          amount: input.amountMinorUnits,
          currency: input.currency.toUpperCase(),
          reference: input.reference,
          recipient: recipientCode,
          reason: input.narration,
        }),
      }),
    );
    if (transferBody.status === false) {
      throw new PayoutProviderError(
        stringValue(transferBody.message) ?? 'Paystack rejected the transfer.',
      );
    }

    const transfer = asJsonRecord(transferBody.data);
    const rawStatus = stringValue(transfer.status);
    const status = mapTransferStatus(rawStatus);
    return {
      status,
      providerTransferId:
        idValue(transfer.transfer_code) ?? idValue(transfer.id),
      recipientCode,
      failureReason:
        rawStatus?.toLowerCase() === 'otp'
          ? OTP_REASON
          : failureReason(transfer),
      raw: transferBody,
    };
  }

  async verifyTransfer(
    secretKey: string,
    input: VerifyTransferInput,
  ): Promise<TransferResult> {
    const body = asJsonRecord(
      await payoutRequest(
        this.provider,
        `${PAYSTACK_API}/transfer/verify/${encodeURIComponent(input.reference)}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      ),
    );
    const transfer = asJsonRecord(body.data);
    const rawStatus = stringValue(transfer.status);
    return {
      status: mapTransferStatus(rawStatus),
      providerTransferId:
        idValue(transfer.transfer_code) ?? idValue(transfer.id),
      recipientCode: stringValue(
        asJsonRecord(transfer.recipient).recipient_code,
      ),
      failureReason:
        rawStatus?.toLowerCase() === 'otp'
          ? OTP_REASON
          : failureReason(transfer),
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
    const status =
      event === 'transfer.success'
        ? PayoutStatus.PAID
        : event === 'transfer.failed'
          ? PayoutStatus.FAILED
          : event === 'transfer.reversed'
            ? PayoutStatus.REVERSED
            : mapTransferStatus(rawStatus) === 'PAID'
              ? PayoutStatus.PAID
              : mapTransferStatus(rawStatus) === 'FAILED'
                ? PayoutStatus.FAILED
                : mapTransferStatus(rawStatus) === 'REVERSED'
                  ? PayoutStatus.REVERSED
                  : PayoutStatus.PROCESSING;

    const id = idValue(data.id) ?? idValue(data.transfer_code);
    return {
      eventKey: `paystack:${event}:${id ?? reference}:${rawStatus ?? status}`,
      eventType: event,
      reference,
      status,
      providerTransferId: id,
      amountMinorUnits: numberValue(data.amount),
      currency: stringValue(data.currency)?.toUpperCase(),
      failureReason:
        rawStatus?.toLowerCase() === 'otp' ? OTP_REASON : failureReason(data),
      raw: payload,
    };
  }
}

function asJsonRecordSafe(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}
