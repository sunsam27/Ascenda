import { randomUUID } from 'node:crypto';
import { requestContext } from '../../../common/context/request-context';
import { encryptAccountNumber, decryptAccountNumber } from '../../people/domain/bank-crypto';
import { EmployerWalletService } from './wallet.service';
import { EmployerFundingRegistry, FundingEvidence } from './wallet-provider';

const ORG = 'org-a';
const OWNER = 'owner-a';
const inOrg = <T>(fn: () => T, organisationId = ORG) => requestContext.run({ organisationId, userId: OWNER, role: 'OWNER' }, fn);

/** Transaction/RLS double only: real PostgreSQL coverage is in employer-wallet-rls.cjs. */
function fixture() {
  const wallet: any = {
    id: 'wallet-a', organisationId: ORG, createdBy: OWNER, setupReference: 'setup-a', status: 'ACTIVE', provider: 'FLUTTERWAVE', mode: 'TEST',
    providerWalletReference: 'provider-wallet-a', pendingMinorUnits: 0, availableMinorUnits: 100_000, reservedMinorUnits: 0, paidMinorUnits: 0,
    reconciliationRequired: false, lastReconciledAt: null,
  };
  const run: any = { id: 'run-a', status: 'PROCESSED', approvedAt: new Date(), approvedById: 'finance-a', reversedAt: null, reversalOfRunId: null };
  const batch: any = { id: 'batch-a', organisationId: ORG, currency: 'NGN', totalMinorUnits: 5_000, paymentCount: 1, status: 'APPROVED', exportedAt: null, payrollRunId: run.id, payrollRun: run };
  const payment: any = { id: 'payment-a', workerId: 'worker-a', amountMinorUnits: 5_000, currency: 'NGN', reference: 'PAY-a', status: 'APPROVED', paymentBatchId: batch.id };
  const entries: any[] = [], deposits: any[] = [], attempts: any[] = [], reservations: any[] = [];
  const matches = (row: any, where: any): boolean => !where || Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((clause: any) => matches(row, clause));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      if ('lt' in value) return row[key] < value.lt;
      if (key.includes('_')) return matches(row, value);
    }
    return row[key] === value;
  });
  const table = (rows: any[]) => ({
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((row) => matches(row, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any) => rows.find((row) => matches(row, where)) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((row) => matches(row, where))),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((row) => matches(row, where)).length),
    create: jest.fn(async ({ data }: any) => { const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), submittedAt: null, status: 'QUEUED', ...data }; rows.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = rows.find((value) => matches(value, where)); if (!row) throw new Error('Not found'); Object.assign(row, data); return { ...row }; }),
    updateMany: jest.fn(async ({ where, data }: any) => { const found = rows.filter((value) => matches(value, where)); found.forEach((row) => Object.assign(row, data)); return { count: found.length }; }),
    upsert: jest.fn(async ({ where, create, update }: any) => { let row = rows.find((value) => matches(value, where)); if (!row) { row = { id: randomUUID(), ...create }; rows.push(row); } else Object.assign(row, update); return { ...row }; }),
  });
  const tx: any = {
    $queryRaw: jest.fn(async () => []), payrollWallet: table([wallet]), payrollWalletLedger: table(entries), payrollWalletDeposit: table(deposits),
    payrollWalletAttempt: table(attempts), payrollWalletReservation: table(reservations), auditLog: table([]), payment: table([payment]),
    paymentBatch: { ...table([batch]), findFirst: jest.fn(async ({ where }: any) => where.id === batch.id ? { ...batch, payments: [{ ...payment }] } : null) },
    payout: { count: jest.fn(async () => 0) },
    payslip: { findMany: jest.fn(async () => [{ workerId: 'worker-a', currency: 'NGN', netMinorUnits: 5_000 }]) },
    bankAccount: { findMany: jest.fn(async () => [{ workerId: 'worker-a', requiresPayrollReview: false, accountNumberEncrypted: encryptAccountNumber('0123456789'), accountName: 'Worker A', bankCode: '044', flutterwaveBankCode: '044' }]) },
    organisation: { findFirst: jest.fn(async () => ({ country: 'NG', currency: 'NGN' })) },
  };
  tx.payrollWalletAttempt.findMany.mockImplementation(async ({ where, include, orderBy }: any = {}) => {
    const rows = attempts.filter((row) => matches(row, where));
    if (orderBy?.attemptNumber === 'desc') rows.sort((a, b) => b.attemptNumber - a.attemptNumber);
    return rows.map((row) => include?.wallet ? { ...row, wallet } : row);
  });
  // Serialize this double's transactions and roll back failed work. This tests
  // service behaviour, not PostgreSQL's lock implementation.
  let tail: Promise<unknown> = Promise.resolve();
  const transact = (ctx: any, fn: any) => {
    const result = tail.then(async () => {
      if (ctx.organisationId !== ORG) return fn({ ...tx, payrollWallet: { ...tx.payrollWallet, findUnique: async () => null }, paymentBatch: { findFirst: async () => null } });
      const before = structuredClone({ wallet, batch, payment, entries, deposits, attempts, reservations });
      try { return await fn(tx); } catch (error) {
        Object.assign(wallet, before.wallet); Object.assign(batch, before.batch); Object.assign(payment, before.payment);
        for (const [rows, snapshot] of [[entries, before.entries], [deposits, before.deposits], [attempts, before.attempts], [reservations, before.reservations]] as const) rows.splice(0, rows.length, ...snapshot);
        throw error;
      }
    });
    tail = result.catch(() => undefined);
    return result;
  };
  const prisma: any = { withContext: (ctx: any, fn: any) => transact(ctx, fn), withRequestContext: (fn: any) => transact(requestContext.getStore(), fn) };
  const provider: any = {
    id: 'FLUTTERWAVE', mode: 'TEST',
    balance: jest.fn(async () => ({ availableMinorUnits: 100_000, currency: 'NGN' })),
    quote: jest.fn(async (transfers: any[]) => transfers.map((transfer) => ({ reference: transfer.reference, feeMinorUnits: 100 }))),
    submit: jest.fn(async () => undefined),
    verifyPayout: jest.fn(async (_wallet: string, reference: string) => ({ verified: true, walletReference: 'provider-wallet-a', reference, amountMinorUnits: 5_000, currency: 'NGN', feeMinorUnits: 0, status: 'PROCESSING', fundsMovement: 'UNKNOWN' })),
    webhook: jest.fn(), createOrRetrieve: jest.fn(), fundingTransactions: jest.fn(async () => []),
  };
  const registry: any = { configured: () => provider, require: () => provider };
  const service = new EmployerWalletService(prisma, registry);
  return { service, registry, provider, tx, wallet, run, batch, payment, entries, deposits, attempts, reservations };
}

describe('employer wallet service safeguards', () => {
  const key = process.env.BANK_ENCRYPTION_KEY;
  beforeEach(() => { process.env.BANK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); });
  afterAll(() => { if (key === undefined) delete process.env.BANK_ENCRYPTION_KEY; else process.env.BANK_ENCRYPTION_KEY = key; });

  const funding = (overrides: Partial<FundingEvidence> = {}): FundingEvidence => ({
    verified: true, walletReference: 'provider-wallet-a', reference: 'deposit-a', amountMinorUnits: 10_000, feeMinorUnits: 100, currency: 'NGN', status: 'CONFIRMED', occurredAt: new Date(), ...overrides,
  });

  it('ships with no approved adapter and never invents an active account', async () => {
    const registry = new EmployerFundingRegistry();
    expect(registry.configured()).toBeNull(); expect(() => registry.require()).toThrow('awaiting payment-partner approval');
    const f = fixture(); f.registry.configured = () => null;
    f.wallet.status = 'PENDING_VERIFICATION'; f.wallet.applicationEncrypted = encryptAccountNumber('{}');
    const result = await inOrg(() => f.service.syncSetup());
    expect(result.status).toBe('PENDING_VERIFICATION'); expect(result.fundingAccount).toBeNull();
    expect(f.provider.createOrRetrieve).not.toHaveBeenCalled();
  });

  it('rejects missing organisation context and foreign batch IDs', async () => {
    const f = fixture();
    await expect(f.service.summary()).rejects.toThrow('No active organisation');
    await expect(inOrg(() => f.service.quote('batch-a'), 'org-b')).rejects.toThrow('Payment batch not found');
  });

  it('stores only encrypted application details and keeps unconfigured setup pending', async () => {
    const f = fixture(); f.wallet.status = 'NOT_STARTED'; f.registry.configured = () => null;
    await inOrg(() => f.service.setup({ legalName: 'Company A', registrationNumber: 'RC1234', companyAddress: 'Company address', representativeName: 'Owner A', representativeEmail: 'owner@example.com', representativePhone: '08000000000', representativeRole: 'Director', authorised: true }));
    expect(f.wallet.status).toBe('PENDING_VERIFICATION');
    expect(f.wallet.applicationEncrypted).not.toContain('RC1234');
    expect(JSON.parse(decryptAccountNumber(f.wallet.applicationEncrypted)).legalName).toBe('Company A');
    expect(JSON.stringify(f.entries)).not.toContain('owner@example.com');
    await expect(inOrg(() => f.service.setup({} as any))).rejects.toThrow();
  });

  it('does not treat a provider PSA ACTIVE flag as corporate verification', async () => {
    const f = fixture(); f.wallet.status = 'PENDING_VERIFICATION'; f.wallet.applicationEncrypted = encryptAccountNumber('{}');
    f.provider.createOrRetrieve.mockResolvedValue({ setupReference: 'setup-a', state: 'ACTIVE', employerVerified: false, walletReference: 'provider-wallet-a', fundingAccount: { accountNumber: '1234567890', bankName: 'Bank', accountName: 'Company' } });
    await inOrg(() => f.service.syncSetup()); expect(f.wallet.status).toBe('PENDING_VERIFICATION');
  });

  it('records pending funding without credit and deduplicates confirmed deposit credits and fees', async () => {
    const f = fixture();
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', funding: funding({ status: 'PENDING' }) });
    await f.service.webhook(ORG, Buffer.from('{}'), {});
    expect(f.wallet.pendingMinorUnits).toBe(10_000); expect(f.wallet.availableMinorUnits).toBe(100_000);
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', funding: funding() });
    await Promise.all([f.service.webhook(ORG, Buffer.from('{}'), {}), f.service.webhook(ORG, Buffer.from('{}'), {})]);
    expect(f.wallet.pendingMinorUnits).toBe(0); expect(f.wallet.availableMinorUnits).toBe(109_900);
    expect(f.deposits).toHaveLength(1); expect(f.entries.filter((entry) => entry.type === 'FEE')).toHaveLength(1);
  });

  it('rejects unauthenticated adapter evidence, signature errors and cross-wallet credit', async () => {
    const f = fixture();
    f.provider.webhook.mockRejectedValue(new Error('signature invalid'));
    await expect(f.service.webhook(ORG, Buffer.from('{}'), {})).rejects.toThrow();
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', funding: funding({ verified: false } as any) });
    await expect(f.service.webhook(ORG, Buffer.from('{}'), {})).rejects.toThrow('Unverified');
    f.provider.webhook.mockResolvedValue({ walletReference: 'another-wallet', funding: funding() });
    await expect(f.service.webhook(ORG, Buffer.from('{}'), {})).rejects.toThrow('not found');
    expect(f.wallet.availableMinorUnits).toBe(100_000); expect(f.entries).toHaveLength(0);
  });

  it('shows a fee-inclusive shortfall without reserving money', async () => {
    const f = fixture(); f.wallet.availableMinorUnits = 4_000;
    const quote = await inOrg(() => f.service.quote('batch-a'));
    expect(quote).toMatchObject({ requiredMinorUnits: 5_100, shortfallMinorUnits: 1_100, canSubmit: false });
    await expect(inOrg(() => f.service.submit('batch-a', { requestKey: randomUUID(), expectedRequiredMinorUnits: 5_100 }))).rejects.toThrow('Insufficient');
    expect(f.attempts).toHaveLength(0);
  });

  it('rolls back a funding credit and journal when the transactional audit fails', async () => {
    const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', funding: funding() });
    await expect(f.service.webhook(ORG, Buffer.from('{}'), {})).rejects.toThrow('audit unavailable');
    expect(f.wallet.availableMinorUnits).toBe(100_000); expect(f.deposits).toHaveLength(0); expect(f.entries).toHaveLength(0);
  });

  it('freezes spending rather than overdrawing a confirmed funding refund', async () => {
    const f = fixture();
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', funding: funding() });
    await f.service.webhook(ORG, Buffer.from('{}'), {});
    f.wallet.availableMinorUnits = 0; // Represents funds already reserved/spent in this test double.
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', funding: funding({ status: 'REFUNDED' }) });
    await f.service.webhook(ORG, Buffer.from('{}'), {});
    expect(f.wallet.availableMinorUnits).toBe(0); expect(f.wallet.reconciliationRequired).toBe(true);
    expect((await inOrg(() => f.service.quote('batch-a'))).canSubmit).toBe(false);
  });

  it('rejects payment amounts that differ from frozen net payslips', async () => {
    const f = fixture(); f.tx.payslip.findMany.mockResolvedValue([{ workerId: 'worker-a', currency: 'NGN', netMinorUnits: 4_000 }]);
    await expect(inOrg(() => f.service.quote('batch-a'))).rejects.toThrow('frozen net payslips');
    expect(f.provider.quote).not.toHaveBeenCalled();
  });

  it('accepts only one of two concurrent submissions for the same batch', async () => {
    const f = fixture();
    const results = await Promise.allSettled([1, 2].map(() => inOrg(() => f.service.submit('batch-a', { requestKey: randomUUID(), expectedRequiredMinorUnits: 5_100 }))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.reservations).toHaveLength(1); expect(f.attempts).toHaveLength(1);
    expect(f.wallet.availableMinorUnits).toBe(94_900); expect(f.provider.submit).toHaveBeenCalledTimes(1);
  });

  it('reserves and dispatches once, preserving request idempotency and unknown outcomes', async () => {
    const f = fixture(); const request = { requestKey: randomUUID(), expectedRequiredMinorUnits: 5_100 };
    await inOrg(() => f.service.submit('batch-a', request));
    const replay = await inOrg(() => f.service.submit('batch-a', request));
    expect(replay.replayed).toBe(true); expect(f.provider.submit).toHaveBeenCalledTimes(1);
    expect(f.wallet.availableMinorUnits).toBe(94_900); expect(f.wallet.reservedMinorUnits).toBe(5_100);
    expect(f.attempts).toHaveLength(1); expect(f.batch.status).toBe('PROCESSING');
    expect(f.tx.$queryRaw.mock.calls.some(([sql]: any) => sql.join('').includes('FOR UPDATE'))).toBe(true);
    await expect(inOrg(() => f.service.submit('batch-a', { ...request, requestKey: randomUUID() }))).rejects.toThrow();
  });

  it('does not silently pay changed fees or exported/unapproved/reversed payroll', async () => {
    for (const change of ['fee', 'export', 'approval', 'reversal']) {
      const f = fixture();
      if (change === 'export') f.batch.exportedAt = new Date();
      if (change === 'approval') f.run.approvedAt = null;
      if (change === 'reversal') f.run.reversedAt = new Date();
      await expect(inOrg(() => f.service.submit('batch-a', { requestKey: randomUUID(), expectedRequiredMinorUnits: change === 'fee' ? 5_000 : 5_100 }))).rejects.toThrow();
      expect(f.provider.submit).not.toHaveBeenCalled();
    }
  });

  it('settles once, returns confirmed principal once and preserves paid/fee history', async () => {
    const f = fixture(); await inOrg(() => f.service.submit('batch-a', { requestKey: randomUUID(), expectedRequiredMinorUnits: 5_100 }));
    const result = { verified: true, walletReference: 'provider-wallet-a', reference: f.attempts[0].reference, currency: 'NGN', amountMinorUnits: 5_000, feeMinorUnits: 80, status: 'PAID', fundsMovement: 'DEBIT_CONFIRMED' };
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', payout: result });
    await f.service.webhook(ORG, Buffer.from('{}'), {}); await f.service.webhook(ORG, Buffer.from('{}'), {});
    expect(f.wallet).toMatchObject({ reservedMinorUnits: 0, paidMinorUnits: 5_000, availableMinorUnits: 94_920 });
    expect(f.batch.status).toBe('PAID'); expect(f.payment.status).toBe('PAID');
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', payout: { ...result, status: 'REVERSED', fundsMovement: 'RETURN_CONFIRMED' } });
    await f.service.webhook(ORG, Buffer.from('{}'), {}); await f.service.webhook(ORG, Buffer.from('{}'), {});
    expect(f.wallet).toMatchObject({ reservedMinorUnits: 0, paidMinorUnits: 0, availableMinorUnits: 99_920 });
  });

  it('releases only a verified no-debit failure and preserves a separate retry attempt', async () => {
    const f = fixture(); await inOrg(() => f.service.submit('batch-a', { requestKey: randomUUID(), expectedRequiredMinorUnits: 5_100 }));
    const failed = { verified: true, walletReference: 'provider-wallet-a', reference: f.attempts[0].reference, currency: 'NGN', amountMinorUnits: 5_000, feeMinorUnits: 0, status: 'FAILED', fundsMovement: 'UNKNOWN' };
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', payout: failed });
    await f.service.webhook(ORG, Buffer.from('{}'), {}); expect(f.wallet.reservedMinorUnits).toBe(5_100);
    f.provider.webhook.mockResolvedValue({ walletReference: 'provider-wallet-a', payout: { ...failed, fundsMovement: 'NOT_DEBITED' } });
    await f.service.webhook(ORG, Buffer.from('{}'), {}); expect(f.wallet.availableMinorUnits).toBe(100_000);
    await inOrg(() => f.service.submit('batch-a', { requestKey: randomUUID(), expectedRequiredMinorUnits: 5_100 }, true));
    expect(f.attempts).toHaveLength(2); expect(f.attempts[0].status).toBe('FAILED'); expect(f.attempts[1].attemptNumber).toBe(2);
    expect(f.attempts[1].reference).not.toBe(f.attempts[0].reference);
  });
});
