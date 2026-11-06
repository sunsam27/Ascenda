import { getRequestContext, requestContext } from '../../../common/context/request-context';
import { createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { StepUpGuard } from '../../../common/auth/step-up.guard';
import { RbacGuard } from '../../../common/rbac/rbac.guard';
import { stepUpSecret } from '../../identity-access/identity-access.service';
import { PayoutsController } from './payouts.controller';
import { PayoutWebhooksController } from './payout-webhooks.controller';
import { PaystackPayoutProvider } from './paystack-payout.provider';
import {
  PaymentBatchStatus,
  PaymentStatus,
  PayoutAccountStatus,
  PayoutProvider,
  PayoutStatus,
} from '@ascenda/types';
import { encryptAccountNumber } from '../../people/domain/bank-crypto';
import { PayoutProviderError } from './payout-provider';
import { PayoutsService } from './payouts.service';

type AnyRecord = Record<string, any>;

function payout(overrides: AnyRecord): AnyRecord {
  return {
    id: 'payout-1',
    organisationId: 'org1',
    payoutAccountId: 'account-1',
    paymentBatchId: 'batch-1',
    paymentId: 'payment-1',
    workerId: 'worker-1',
    provider: PayoutProvider.PAYSTACK,
    status: PayoutStatus.FAILED,
    amountMinorUnits: 10_000,
    currency: 'NGN',
    reference: 'PAY-1',
    providerTransferId: null,
    recipientCode: null,
    recipientName: 'Ada Example',
    bankName: 'Access Bank',
    bankCode: '044',
    accountNumberMasked: '****6789',
    failureReason: 'Provider rejected the transfer.',
    providerPayload: null,
    attemptCount: 1,
    lastAttemptAt: null,
    lastCheckedAt: null,
    requestedAt: new Date(Date.now() - 20 * 60 * 1000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function payment(overrides: AnyRecord): AnyRecord {
  return {
    id: 'payment-1',
    organisationId: 'org1',
    payrollRunId: null,
    paymentBatchId: 'batch-1',
    workerId: 'worker-1',
    amountMinorUnits: 10_000,
    currency: 'NGN',
    status: PaymentStatus.FAILED,
    reference: 'PAY-1',
    description: 'Salary',
    processedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-1',
    ...overrides,
  };
}

function batch(overrides: AnyRecord): AnyRecord {
  return {
    id: 'batch-1',
    organisationId: 'org1',
    payrollRunId: null,
    payoutAccountId: 'account-1',
    reference: 'BATCH-1',
    label: 'September payroll',
    status: PaymentBatchStatus.PARTIALLY_PAID,
    currency: 'NGN',
    totalMinorUnits: 20_000,
    paymentCount: 2,
    approvedAt: new Date(),
    approvedBy: 'approver-1',
    exportedAt: null,
    exportedBy: null,
    payoutStartedAt: new Date(),
    payoutCompletedAt: new Date(),
    paidAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    createdBy: 'creator-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface StoreOptions {
  batch: AnyRecord;
  payouts: AnyRecord[];
  payments: AnyRecord[];
  account: AnyRecord;
  workers: AnyRecord[];
  bankAccounts: AnyRecord[];
}

function fakePrisma(store: StoreOptions) {
  const batchRow = store.batch;
  const payouts = new Map(store.payouts.map((row) => [row.id, row]));
  const payments = new Map(store.payments.map((row) => [row.id, row]));
  const batchPayments = () =>
    store.payments.map((row) => ({
      ...row,
      payout: [...payouts.values()].find((p) => p.paymentId === row.id),
    }));

  const tx = {
    paymentBatch: {
      findFirst: jest.fn(async ({ id, where }: AnyRecord) => {
        if (getRequestContext()?.organisationId !== batchRow.organisationId) return null;
        const wanted = id ?? where?.id;
        return wanted && wanted !== batchRow.id
          ? null
          : { ...batchRow, payments: batchPayments() };
      }),
      updateMany: jest.fn(async ({ where, data }: AnyRecord) => {
        const allowed: string[] = typeof where?.status === 'string'
          ? [where.status] : where?.status?.in ?? [];
        if (where?.id !== batchRow.id || !allowed.includes(batchRow.status)) {
          return { count: 0 };
        }
        Object.assign(batchRow, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: AnyRecord) => {
        Object.assign(batchRow, data);
        return batchRow;
      }),
    },
    payout: {
      count: jest.fn(async () => payouts.size),
      create: jest.fn(async ({ data }: AnyRecord) => {
        const row = payout({ ...data, id: `payout-${payouts.size + 1}` });
        payouts.set(row.id, row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: AnyRecord) =>
        [...payouts.values()].find((row) => row.reference === where.reference) ?? null),
      findUnique: jest.fn(async ({ where }: AnyRecord) => {
        const row = payouts.get(where.id);
        return row ? { ...row, paymentBatch: batchRow } : null;
      }),
      findMany: jest.fn(async ({ where, include }: AnyRecord) => {
        let rows = [...payouts.values()];
        if (where?.paymentBatchId) {
          rows = rows.filter((row) => row.paymentBatchId === where.paymentBatchId);
        }
        if (where?.status?.in) {
          rows = rows.filter((row) => where.status.in.includes(row.status));
        }
        return rows.map((row) => ({
          ...row,
          ...(include?.payoutAccount ? { payoutAccount: store.account } : {}),
          ...(include?.worker ? { worker: store.workers.find((worker) => worker.id === row.workerId) } : {}),
        }));
      }),
      update: jest.fn(async ({ where, data }: AnyRecord) => {
        const row = payouts.get(where.id);
        if (!row) throw new Error('payout not found');
        Object.assign(row, data);
        return row;
      }),
    },
    payment: {
      update: jest.fn(async ({ where, data }: AnyRecord) => {
        const row = payments.get(where.id);
        if (!row) throw new Error('payment not found');
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: AnyRecord) => {
        let count = 0;
        for (const row of payments.values()) {
          if (
            row.paymentBatchId === where.paymentBatchId &&
            row.status === where.status
          ) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
    payoutAccount: {
      findUnique: jest.fn(async () => store.account),
      updateMany: jest.fn(async ({ data }: AnyRecord) => {
        Object.assign(store.account, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: AnyRecord) => {
        Object.assign(store.account, data);
        return store.account;
      }),
    },
    worker: {
      findMany: jest.fn(async () => store.workers),
    },
    bankAccount: {
      findMany: jest.fn(async () => store.bankAccounts),
    },
    membership: {
      findMany: jest.fn(async () => [{ userId: 'approver-1' }]),
    },
    payoutWebhookEvent: {
      findUnique: jest.fn(async () => null as AnyRecord | null),
      create: jest.fn(async () => ({ id: 'event-1' })),
      update: jest.fn(async () => ({ id: 'event-1' })),
    },
  };

  return {
    prisma: {
      withRequestContext: (fn: (client: AnyRecord) => Promise<unknown>) =>
        fn(tx),
      withContext: (_ctx: unknown, fn: (client: AnyRecord) => Promise<unknown>) =>
        fn(tx),
    },
    tx,
    batchRow,
    payouts,
    payments,
  };
}

function bankAccount(workerId: string): AnyRecord {
  return {
    id: `bank-${workerId}`,
    workerId,
    accountName: 'Ada Example',
    bankName: 'Access Bank',
    bankCode: '044',
    accountNumberEncrypted: encryptAccountNumber('0123456789'),
    requiresPayrollReview: false,
    isPrimary: true,
    createdAt: new Date(),
  };
}

function serviceFor(
  prisma: AnyRecord,
  gateway: AnyRecord,
  audit: AnyRecord,
  notifications: AnyRecord,
) {
  const resolvedGateway: AnyRecord = {
    getBalance: jest.fn(async () => ({
      currency: 'NGN',
      availableMinorUnits: 100_000,
      raw: {},
    })),
    createTransfer: jest.fn(),
    verifyTransfer: jest.fn(),
    ...gateway,
  };
  return new PayoutsService(
    prisma as never,
    audit as never,
    notifications as never,
    { get: () => resolvedGateway } as never,
    { get: () => undefined } as never,
  );
}

function account(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: 'account-1',
    organisationId: 'org1',
    provider: PayoutProvider.PAYSTACK,
    mode: 'TEST',
    country: 'NG',
    currency: 'NGN',
    accountName: 'Ascenda',
    secretKeyEncrypted: encryptAccountNumber('sk_test_key'),
    webhookSecretEncrypted: null,
    keyLast4: 'key',
    status: PayoutAccountStatus.ACTIVE,
    balanceMinorUnits: 100_000,
    balanceCurrency: 'NGN',
    balanceCheckedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    ...overrides,
  };
}

describe('PayoutsService retry', () => {
  it('retries only failed transfers with a fresh reference', async () => {
    const paidPayout = payout({
      id: 'payout-paid',
      paymentId: 'payment-paid',
      workerId: 'worker-1',
      reference: 'PAY-PAID',
      status: PayoutStatus.PAID,
    });
    const failedPayout = payout({
      id: 'payout-failed',
      paymentId: 'payment-failed',
      workerId: 'worker-2',
      reference: 'PAY-FAILED',
      status: PayoutStatus.FAILED,
    });
    const paidPayment = payment({
      id: 'payment-paid',
      workerId: 'worker-1',
      reference: 'PAY-PAID',
      status: PaymentStatus.PAID,
    });
    const failedPayment = payment({
      id: 'payment-failed',
      workerId: 'worker-2',
      reference: 'PAY-FAILED',
      status: PaymentStatus.FAILED,
    });
    const store: StoreOptions = {
      batch: batch({}),
      payouts: [paidPayout, failedPayout],
      payments: [paidPayment, failedPayment],
      account: account(),
      workers: [
        { id: 'worker-1', firstName: 'Ada', lastName: 'Example' },
        { id: 'worker-2', firstName: 'Bola', lastName: 'Example' },
      ],
      bankAccounts: [bankAccount('worker-1'), bankAccount('worker-2')],
    };
    const { prisma, batchRow, payouts, payments } = fakePrisma(store);
    const createTransfer = jest.fn(async (..._args: unknown[]) => ({
      status: 'PAID',
      providerTransferId: 'transfer-2',
      raw: { ok: true },
    }));
    const audit = {
      record: jest.fn(async (_entry: AnyRecord) => undefined),
    };
    const notifications = { emit: jest.fn(async () => undefined) };
    const service = serviceFor(
      prisma,
      { createTransfer, verifyTransfer: jest.fn() },
      audit,
      notifications,
    );

    const result = await requestContext.run(
      { organisationId: 'org1', userId: 'user-1' },
      () => service.retryBatchPayouts('batch-1'),
    );

    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(createTransfer.mock.calls[0]![1]).toMatchObject({
      reference: 'PAY-FAILED-R2',
      amountMinorUnits: 10_000,
    });
    expect(payouts.get('payout-failed')).toMatchObject({
      status: PayoutStatus.PAID,
      attemptCount: 2,
      providerTransferId: 'transfer-2',
    });
    expect(payments.get('payment-failed')?.status).toBe(PaymentStatus.PAID);
    expect(batchRow.status).toBe(PaymentBatchStatus.PAID);
    expect(result.batch.status).toBe(PaymentBatchStatus.PAID);

    const actions = audit.record.mock.calls.map(
      (call) => (call[0] as AnyRecord).action,
    );
    expect(actions).toContain('PAYOUT_BATCH_INITIATED');
    expect(actions).toContain('PAYOUT_STATUS_CHANGED');
    const retryAudit = audit.record.mock.calls
      .map((call) => call[0] as AnyRecord)
      .find((entry) => entry.newValue?.retry === true);
    expect(retryAudit?.newValue).toMatchObject({
      retry: true,
      paymentCount: 1,
      totalMinorUnits: 10_000,
    });
  });

  it('uses the provider-specific bank code when one is configured', async () => {
    const failedPayout = payout({
      id: 'payout-failed',
      paymentId: 'payment-failed',
      workerId: 'worker-1',
      reference: 'PAY-FAILED',
    });
    const failedPayment = payment({
      id: 'payment-failed',
      workerId: 'worker-1',
      reference: 'PAY-FAILED',
      status: PaymentStatus.FAILED,
    });
    const store: StoreOptions = {
      batch: batch({ status: PaymentBatchStatus.FAILED, paymentCount: 1 }),
      payouts: [failedPayout],
      payments: [failedPayment],
      account: account(),
      workers: [{ id: 'worker-1', firstName: 'Ada', lastName: 'Example', employeeNumber: 'EMP-001' }],
      bankAccounts: [
        { ...bankAccount('worker-1'), paystackBankCode: '058' },
      ],
    };
    const { prisma } = fakePrisma(store);
    const createTransfer = jest.fn(async (..._args: unknown[]) => ({
      status: 'PAID',
      raw: { ok: true },
    }));
    const service = serviceFor(
      prisma,
      { createTransfer },
      { record: jest.fn() },
      { emit: jest.fn() },
    );

    await requestContext.run(
      { organisationId: 'org1', userId: 'user-1' },
      () => service.retryBatchPayouts('batch-1'),
    );

    expect(createTransfer.mock.calls[0]![1]).toMatchObject({
      account: { bankCode: '058' },
    });
  });

  it('refreshes the live provider balance before retrying', async () => {
    const failedPayout = payout({
      id: 'payout-failed',
      paymentId: 'payment-failed',
      workerId: 'worker-1',
      reference: 'PAY-FAILED',
    });
    const failedPayment = payment({
      id: 'payment-failed',
      workerId: 'worker-1',
      reference: 'PAY-FAILED',
      status: PaymentStatus.FAILED,
    });
    const store: StoreOptions = {
      batch: batch({ status: PaymentBatchStatus.FAILED, paymentCount: 1 }),
      payouts: [failedPayout],
      payments: [failedPayment],
      account: account(),
      workers: [{ id: 'worker-1', firstName: 'Ada', lastName: 'Example' }],
      bankAccounts: [bankAccount('worker-1')],
    };
    const { prisma } = fakePrisma(store);
    const getBalance = jest.fn(async () => ({
      currency: 'NGN',
      availableMinorUnits: 5_000,
      raw: {},
    }));
    const createTransfer = jest.fn();
    const service = serviceFor(
      prisma,
      { getBalance, createTransfer },
      { record: jest.fn() },
      { emit: jest.fn() },
    );

    await expect(
      requestContext.run(
        { organisationId: 'org1', userId: 'user-1' },
        () => service.retryBatchPayouts('batch-1'),
      ),
    ).rejects.toThrow(/balance/i);

    expect(getBalance).toHaveBeenCalled();
    expect(store.account.balanceMinorUnits).toBe(5_000);
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('refuses to retry a paid batch', async () => {
    const store: StoreOptions = {
      batch: batch({ status: PaymentBatchStatus.PAID }),
      payouts: [],
      payments: [],
      account: account(),
      workers: [],
      bankAccounts: [],
    };
    const { prisma } = fakePrisma(store);
    const service = serviceFor(
      prisma,
      { createTransfer: jest.fn(), verifyTransfer: jest.fn() },
      { record: jest.fn() },
      { emit: jest.fn() },
    );

    await expect(
      requestContext.run(
        { organisationId: 'org1', userId: 'user-1' },
        () => service.retryBatchPayouts('batch-1'),
      ),
    ).rejects.toThrow(/failed or partially paid/i);
  });
});

/** HTTP integration: real controllers, service, RBAC, step-up and signatures.
 * Identity, database transactions/RLS and provider network are test doubles.
 * No real wallet or database is touched. */
describe('Payout HTTP lifecycle', () => {
  const batchId = '00000000-0000-4000-8000-000000000001';
  const orgId = '00000000-0000-4000-8000-000000000002';
  const jwt = new JwtService();
  const secret = 'payout-http-tests-only';
  let app: INestApplication;
  let base: string;
  let state: ReturnType<typeof fakePrisma>;
  let gateway: AnyRecord;
  let audit: AnyRecord;

  beforeEach(async () => {
    state = fakePrisma({
      batch: batch({ id: batchId, organisationId: orgId,
        status: PaymentBatchStatus.APPROVED, totalMinorUnits: 10_000, paymentCount: 1 }),
      payouts: [],
      payments: [payment({ paymentBatchId: batchId, status: PaymentStatus.APPROVED })],
      account: account({ organisationId: orgId }),
      workers: [{ id: 'worker-1', firstName: 'Ada', lastName: 'Example', employeeNumber: 'EMP-001' }],
      bankAccounts: [{ ...bankAccount('worker-1'), paystackBankCode: 'provider-code' }],
    });
    gateway = {
      getBalance: jest.fn(async () => ({ currency: 'NGN', availableMinorUnits: 100_000, raw: {} })),
      createTransfer: jest.fn(async () => ({ status: 'PROCESSING', raw: {} })),
      verifyTransfer: jest.fn(async () => ({ status: 'PAID', raw: {} })),
      parseWebhook: (payload: unknown) => new PaystackPayoutProvider().parseWebhook(payload),
    };
    audit = { record: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [PayoutsController, PayoutWebhooksController],
      providers: [
        { provide: PayoutsService, useValue: serviceFor(state.prisma, gateway, audit, { emit: jest.fn() }) },
        StepUpGuard,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => secret } },
      ],
    }).overrideGuard(AuthGuard('jwt')).useValue({
      canActivate: (ctx: AnyRecord) => {
        if (!ctx.switchToHttp().getRequest().user) throw new UnauthorizedException();
        return true;
      },
    }).compile();
    app = module.createNestApplication({ rawBody: true });
    // Simulated authenticated identity. Actual permission/step-up guards remain enabled.
    app.use((req: AnyRecord, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'];
      const organisationId = req.headers['x-test-org'] ?? orgId;
      if (role) req.user = { sub: 'user-1', role, organisationId };
      requestContext.run({ organisationId, userId: 'user-1', role }, next);
    });
    app.useGlobalGuards(new RbacGuard(new Reflector()));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterEach(async () => { await app?.close(); });

  function post(path: string, options: { role?: string; stepUp?: boolean; org?: string } = {}) {
    const headers: Record<string, string> = {};
    if (options.role) headers['x-test-role'] = options.role;
    if (options.org) headers['x-test-org'] = options.org;
    if (options.stepUp) headers['x-step-up-token'] = jwt.sign({
      sub: 'user-1', purpose: 'step_up', organisationId: options.org ?? orgId,
    }, { secret: stepUpSecret(secret), expiresIn: '5m' });
    return fetch(`${base}/payments/batches/${batchId}/${path}`, { method: 'POST', headers });
  }

  it('requires permission and step-up for initiation and retry', async () => {
    for (const path of ['payout', 'payout/retry']) {
      expect((await post(path)).status).toBe(403);
      expect((await post(path, { role: 'EMPLOYEE_SELF', stepUp: true })).status).toBe(403);
      expect((await post(path, { role: 'OWNER' })).status).toBe(403);
    }
    expect(gateway.createTransfer).not.toHaveBeenCalled();
  });

  it('initiates once, routes with the provider code, then accepts a signed webhook once', async () => {
    const response = await post('payout', { role: 'OWNER', stepUp: true });
    expect(response.status).toBe(200);
    const result = (await response.json()) as AnyRecord;
    expect(result.batch.status).toBe('PROCESSING');
    expect(result.payouts[0]).toMatchObject({ workerName: 'Ada Example', employeeNumber: 'EMP-001' });
    expect(gateway.getBalance).toHaveBeenCalledTimes(1);
    expect(gateway.createTransfer).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ account: expect.objectContaining({ bankCode: 'provider-code' }) }));
    expect((await post('payout', { role: 'OWNER', stepUp: true })).status).toBe(409);
    expect(gateway.createTransfer).toHaveBeenCalledTimes(1);
    const body = JSON.stringify({ event: 'transfer.success', data: {
      id: 123, reference: 'PAY-1', status: 'success', amount: 10_000, currency: 'NGN',
    } });
    const webhook = (signature: string) => fetch(`${base}/payments/webhooks/paystack/${orgId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature }, body,
    });
    expect((await webhook('invalid')).status).toBe(401);
    expect(state.batchRow.status).toBe('PROCESSING');
    const signature = createHmac('sha512', 'sk_test_key').update(body).digest('hex');
    expect((await webhook(signature)).status).toBe(200);
    expect(state.batchRow.status).toBe('PAID');
    state.tx.payoutWebhookEvent.findUnique.mockResolvedValue({ id: 'event-1', processedAt: new Date() });
    expect((await webhook(signature)).status).toBe(200);
    expect(gateway.verifyTransfer).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PAYOUT_STATUS_CHANGED', newValue: expect.objectContaining({ source: 'WEBHOOK' }),
    }));
  });

  it('fails closed on balance lookup errors without claiming the batch', async () => {
    gateway.getBalance.mockRejectedValue(new Error('provider unavailable'));
    expect((await post('payout', { role: 'OWNER', stepUp: true })).status).toBe(400);
    expect(state.batchRow.status).toBe('APPROVED');
    expect(state.payouts.size).toBe(0);
    expect(gateway.createTransfer).not.toHaveBeenCalled();
  });

  it.each([
    ['PAYSTACK', 'paystack-code'],
    ['FLUTTERWAVE', 'flutterwave-code'],
  ])('selects the %s override independently of the other provider', async (provider, code) => {
    const connected = await state.tx.payoutAccount.findUnique();
    connected.provider = provider;
    state.tx.bankAccount.findMany.mockResolvedValue([{
      ...bankAccount('worker-1'), paystackBankCode: 'paystack-code',
      flutterwaveBankCode: 'flutterwave-code',
    }]);
    expect((await post('payout', { role: 'OWNER', stepUp: true })).status).toBe(200);
    expect(gateway.createTransfer).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ account: expect.objectContaining({ bankCode: code }) }));
  });

  it('uses the generic code when the active provider override is unset', async () => {
    state.tx.bankAccount.findMany.mockResolvedValue([bankAccount('worker-1')]);
    expect((await post('payout', { role: 'OWNER', stepUp: true })).status).toBe(200);
    expect(gateway.createTransfer).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ account: expect.objectContaining({ bankCode: '044' }) }));
  });

  it.each([
    { currency: 'NGN', availableMinorUnits: 5_000 },
    { currency: 'USD', availableMinorUnits: 100_000 },
    { currency: 'NGN', availableMinorUnits: 100.5 },
  ])('does not initiate against an insufficient or invalid live balance (%j)', async (balance) => {
    gateway.getBalance.mockResolvedValue({ ...balance, raw: {} });
    expect((await post('payout', { role: 'OWNER', stepUp: true })).status).toBe(400);
    expect(state.batchRow.status).toBe('APPROVED');
    expect(gateway.createTransfer).not.toHaveBeenCalled();
  });

  it('retries a rejected transfer with a fresh reference, but never a paid one', async () => {
    gateway.createTransfer.mockResolvedValueOnce({ status: 'FAILED', failureReason: 'Rejected', raw: {} });
    expect((await post('payout', { role: 'OWNER', stepUp: true })).status).toBe(200);
    gateway.createTransfer.mockResolvedValue({ status: 'PAID', raw: {} });
    expect((await post('payout/retry', { role: 'OWNER', stepUp: true })).status).toBe(200);
    expect(gateway.createTransfer).toHaveBeenLastCalledWith(expect.any(String),
      expect.objectContaining({ reference: 'PAY-1-R2' }));
    expect(state.batchRow.status).toBe('PAID');
    expect((await post('payout/retry', { role: 'OWNER', stepUp: true })).status).toBe(409);
    expect(gateway.createTransfer).toHaveBeenCalledTimes(2);
  });

  it('returns 404 for a batch outside the request tenant (simulated RLS)', async () => {
    for (const path of ['payout', 'payout/retry']) {
      expect((await post(path, { role: 'OWNER', stepUp: true,
        org: '00000000-0000-4000-8000-000000000099' })).status).toBe(404);
    }
    expect(gateway.createTransfer).not.toHaveBeenCalled();
    expect(state.tx.paymentBatch.updateMany).not.toHaveBeenCalled();
  });
});

describe('PayoutsService reconciliation', () => {
  it('persists a terminal result from the provider', async () => {
    const stale = payout({
      id: 'payout-processing',
      paymentId: 'payment-processing',
      paymentBatchId: 'batch-1',
      reference: 'PAY-3',
      status: PayoutStatus.PROCESSING,
      providerTransferId: 'transfer-3',
      failureReason: null,
    });
    const stalePayment = payment({
      id: 'payment-processing',
      paymentBatchId: 'batch-1',
      reference: 'PAY-3',
      status: PaymentStatus.PROCESSING,
      amountMinorUnits: 10_000,
    });
    const store: StoreOptions = {
      batch: batch({
        id: 'batch-1',
        status: PaymentBatchStatus.PROCESSING,
        totalMinorUnits: 10_000,
        paymentCount: 1,
      }),
      payouts: [stale],
      payments: [stalePayment],
      account: account(),
      workers: [],
      bankAccounts: [],
    };
    const { prisma, batchRow, payouts, payments } = fakePrisma(store);
    const verifyTransfer = jest.fn(async () => ({
      status: 'PAID',
      providerTransferId: 'transfer-3',
      raw: { verified: true },
    }));
    const audit = {
      record: jest.fn(async (_entry: AnyRecord) => undefined),
    };
    const service = serviceFor(
      prisma,
      { createTransfer: jest.fn(), verifyTransfer },
      audit,
      { emit: jest.fn() },
    );

    const result = await requestContext.run(
      { organisationId: 'org1', userId: 'user-1' },
      () => service.reconcileStalePayouts(),
    );

    expect(result).toEqual({ checked: 1, updated: 1, errors: 0 });
    expect(verifyTransfer).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reference: 'PAY-3' }),
    );
    expect(payouts.get('payout-processing')?.status).toBe(PayoutStatus.PAID);
    expect(payments.get('payment-processing')?.status).toBe(PaymentStatus.PAID);
    expect(batchRow.status).toBe(PaymentBatchStatus.PAID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAYOUT_STATUS_CHANGED',
        newValue: expect.objectContaining({ source: 'RECONCILIATION' }),
      }),
    );
  });

  it('keeps an indeterminate attempt processing instead of allowing a retry', async () => {
    const failed = payout({
      id: 'payout-failed',
      paymentId: 'payment-failed',
      paymentBatchId: 'batch-1',
      reference: 'PAY-1',
      status: PayoutStatus.FAILED,
      failureReason: 'Timed out.',
    });
    const store: StoreOptions = {
      batch: batch({ status: PaymentBatchStatus.FAILED }),
      payouts: [failed],
      payments: [
        payment({ id: 'payment-failed', status: PaymentStatus.FAILED }),
      ],
      account: account(),
      workers: [
        { id: 'worker-1', firstName: 'Ada', lastName: 'Example' },
      ],
      bankAccounts: [bankAccount('worker-1')],
    };
    const { prisma, batchRow, payouts, payments } = fakePrisma(store);
    const service = serviceFor(
      prisma,
      {
        createTransfer: jest.fn(async () => {
          throw new PayoutProviderError('network timeout', undefined, true);
        }),
        verifyTransfer: jest.fn(),
      },
      { record: jest.fn() },
      { emit: jest.fn() },
    );

    await requestContext.run(
      { organisationId: 'org1', userId: 'user-1' },
      () => service.retryBatchPayouts('batch-1'),
    );

    // The transfer may have reached the provider, so it must not be retryable.
    expect(payouts.get('payout-failed')).toMatchObject({
      status: PayoutStatus.PROCESSING,
      reference: 'PAY-1-R2',
    });
    expect(payments.get('payment-failed')?.status).toBe(
      PaymentStatus.PROCESSING,
    );
    expect(batchRow.status).toBe(PaymentBatchStatus.PROCESSING);
  });

  it('marks a payout failed when the provider definitively cannot find it', async () => {
    const stale = payout({
      id: 'payout-processing',
      paymentId: 'payment-processing',
      paymentBatchId: 'batch-1',
      status: PayoutStatus.PROCESSING,
      failureReason: null,
    });
    const store: StoreOptions = {
      batch: batch({
        id: 'batch-1',
        status: PaymentBatchStatus.PROCESSING,
        totalMinorUnits: 10_000,
        paymentCount: 1,
      }),
      payouts: [stale],
      payments: [
        payment({
          id: 'payment-processing',
          paymentBatchId: 'batch-1',
          status: PaymentStatus.PROCESSING,
        }),
      ],
      account: account(),
      workers: [],
      bankAccounts: [],
    };
    const { prisma, batchRow, payouts } = fakePrisma(store);
    const audit = {
      record: jest.fn(async (_entry: AnyRecord) => undefined),
    };
    const service = serviceFor(
      prisma,
      {
        createTransfer: jest.fn(),
        verifyTransfer: jest.fn(async () => {
          throw new PayoutProviderError('not found', 404);
        }),
      },
      audit,
      { emit: jest.fn() },
    );

    const result = await requestContext.run(
      { organisationId: 'org1', userId: 'user-1' },
      () => service.reconcileStalePayouts(),
    );

    expect(result).toEqual({ checked: 1, updated: 1, errors: 1 });
    expect(payouts.get('payout-processing')?.status).toBe(PayoutStatus.FAILED);
    expect(batchRow.status).toBe(PaymentBatchStatus.FAILED);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({ source: 'RECONCILIATION' }),
      }),
    );
  });

  it('leaves a payout processing when the provider lookup fails', async () => {
    const stale = payout({
      id: 'payout-processing',
      paymentId: 'payment-processing',
      paymentBatchId: 'batch-1',
      status: PayoutStatus.PROCESSING,
      failureReason: null,
    });
    const store: StoreOptions = {
      batch: batch({
        id: 'batch-1',
        status: PaymentBatchStatus.PROCESSING,
        totalMinorUnits: 10_000,
        paymentCount: 1,
      }),
      payouts: [stale],
      payments: [
        payment({
          id: 'payment-processing',
          paymentBatchId: 'batch-1',
          status: PaymentStatus.PROCESSING,
        }),
      ],
      account: account(),
      workers: [],
      bankAccounts: [],
    };
    const { prisma, payouts } = fakePrisma(store);
    const service = serviceFor(
      prisma,
      {
        createTransfer: jest.fn(),
        verifyTransfer: jest.fn(async () => {
          throw new Error('provider unavailable');
        }),
      },
      { record: jest.fn() },
      { emit: jest.fn() },
    );

    const result = await requestContext.run(
      { organisationId: 'org1', userId: 'user-1' },
      () => service.reconcileStalePayouts(),
    );

    expect(result).toEqual({ checked: 1, updated: 0, errors: 1 });
    expect(payouts.get('payout-processing')?.status).toBe(
      PayoutStatus.PROCESSING,
    );
    expect(payouts.get('payout-processing')?.lastCheckedAt).toBeInstanceOf(
      Date,
    );
  });
});
