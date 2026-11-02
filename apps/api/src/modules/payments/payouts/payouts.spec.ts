import { createHmac } from 'node:crypto';
import { PayoutProvider, PayoutStatus } from '@ascenda/types';
import { FlutterwavePayoutProvider } from './flutterwave-payout.provider';
import { PaystackPayoutProvider } from './paystack-payout.provider';
import {
  providerSupportsCurrency,
  payoutOptions,
} from './payout-support';
import {
  verifyFlutterwaveHash,
  verifyPaystackSignature,
} from './payout-signature';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('payout provider support', () => {
  it('only advertises supported currencies', () => {
    expect(providerSupportsCurrency(PayoutProvider.PAYSTACK, 'NGN')).toBe(true);
    expect(providerSupportsCurrency(PayoutProvider.PAYSTACK, 'USD')).toBe(false);
    expect(
      providerSupportsCurrency(PayoutProvider.FLUTTERWAVE, 'KES'),
    ).toBe(true);
    expect(payoutOptions()).toHaveLength(2);
  });
});

describe('Paystack payout provider', () => {
  const provider = new PaystackPayoutProvider();

  it('parses a successful transfer webhook', () => {
    const event = provider.parseWebhook({
      event: 'transfer.success',
      data: {
        id: 123,
        reference: 'PAY-1',
        status: 'success',
        amount: 50000,
        currency: 'NGN',
      },
    });

    expect(event).toMatchObject({
      reference: 'PAY-1',
      status: PayoutStatus.PAID,
      amountMinorUnits: 50000,
      providerTransferId: '123',
    });
  });

  it('turns an OTP challenge into a clear failure', () => {
    const event = provider.parseWebhook({
      event: 'transfer.failed',
      data: { id: 123, reference: 'PAY-1', status: 'otp' },
    });

    expect(event?.status).toBe(PayoutStatus.FAILED);
    expect(event?.failureReason).toMatch(/OTP/i);
  });
});

describe('Flutterwave payout provider', () => {
  const provider = new FlutterwavePayoutProvider();

  it('converts the wallet balance from major to minor units', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({
        status: 'success',
        data: {
          currency: 'NGN',
          available_balance: 1234.56,
          ledger_balance: 1234.56,
        },
      }),
    ) as unknown as typeof fetch;

    const balance = await provider.getBalance('FLWSECK_TEST-key', 'NGN');
    expect(balance.availableMinorUnits).toBe(123456);
  });

  it('sends transfer amounts in major units', async () => {
    const calls: RequestInit[] = [];
    global.fetch = jest.fn(async (_url, init) => {
      calls.push(init ?? {});
      return jsonResponse({
        status: 'success',
        data: { id: 9, reference: 'PAY-9', status: 'NEW' },
      });
    }) as unknown as typeof fetch;

    const result = await provider.createTransfer('FLWSECK_TEST-key', {
      reference: 'PAY-9',
      amountMinorUnits: 10050,
      currency: 'NGN',
      country: 'NG',
      narration: 'Salary',
      account: {
        accountName: 'Ada Example',
        accountNumber: '0123456789',
        bankCode: '044',
        bankName: 'Access Bank',
        country: 'NG',
      },
    });

    expect(result.status).toBe('PROCESSING');
    expect(result.providerTransferId).toBe('9');
    expect(JSON.parse(calls[0]?.body as string)).toMatchObject({
      amount: 100.5,
      account_number: '0123456789',
      account_bank: '044',
    });
  });

  it('parses a completed transfer webhook', () => {
    const event = provider.parseWebhook({
      event: 'transfer.completed',
      data: {
        id: 77,
        reference: 'PAY-77',
        status: 'SUCCESSFUL',
        amount: 250.25,
        currency: 'NGN',
      },
    });

    expect(event).toMatchObject({
      reference: 'PAY-77',
      status: PayoutStatus.PAID,
      amountMinorUnits: 25025,
      providerTransferId: '77',
    });
  });
});

describe('payout webhook signatures', () => {
  it('verifies Paystack HMAC signatures', () => {
    const raw = Buffer.from('{"event":"transfer.success"}');
    const secret = 'sk_test_secret';
    const signature = createHmac('sha512', secret).update(raw).digest('hex');

    expect(verifyPaystackSignature(raw, signature, secret)).toBe(true);
    expect(verifyPaystackSignature(raw, 'bad', secret)).toBe(false);
  });

  it('verifies the Flutterwave verif-hash', () => {
    expect(verifyFlutterwaveHash('hash-123', 'hash-123')).toBe(true);
    expect(verifyFlutterwaveHash('hash-123', 'other')).toBe(false);
  });
});
