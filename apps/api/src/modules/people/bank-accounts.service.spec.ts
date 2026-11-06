import { requestContext } from '../../common/context/request-context';
import { encryptAccountNumber } from './domain/bank-crypto';
import { BankAccountsService } from './bank-accounts.service';

describe('provider bank-code controls', () => {
  function fixture() {
    const row = {
      id: 'bank-1', organisationId: 'org1', workerId: 'worker-1',
      bankName: 'Access Bank', bankCode: '044', paystackBankCode: 'old-paystack',
      flutterwaveBankCode: 'old-flutterwave', accountName: 'Ada Example',
      accountNumberEncrypted: encryptAccountNumber('0123456789'),
      accountNumberMasked: '****6789', isPrimary: true, isVerified: false,
      requiresPayrollReview: false, payrollReviewedAt: new Date(), payrollReviewedBy: 'admin',
      createdAt: new Date(), updatedAt: new Date(), createdBy: 'admin',
    };
    const tx = {
      worker: { findFirst: jest.fn(async () => ({ id: 'worker-1' })) },
      bankAccount: {
        findFirst: jest.fn(async () => row),
        update: jest.fn(async ({ data }: { data: object }) => Object.assign(row, data)),
      },
      membership: { findMany: jest.fn(async () => []) },
    };
    const audit = { record: jest.fn() };
    const service = new BankAccountsService({
      withRequestContext: (fn: (client: typeof tx) => unknown) => fn(tx),
    } as never, audit as never, { emit: jest.fn() } as never);
    return { service, tx, row, audit };
  }

  it.each(['new-code', ''])('employees cannot set or clear provider codes (%j)', async (code) => {
    const { service, tx } = fixture();
    await expect(requestContext.run({ organisationId: 'org1', userId: 'employee', role: 'EMPLOYEE_SELF' },
      () => service.update('worker-1', 'bank-1', { paystackBankCode: code })))
      .rejects.toThrow(/Only payroll administrators/);
    expect(tx.bankAccount.update).not.toHaveBeenCalled();
  });

  it('admin changes require payroll review and are audited without raw account details', async () => {
    const { service, row, audit } = fixture();
    const result = await requestContext.run({ organisationId: 'org1', userId: 'admin', role: 'OWNER' },
      () => service.update('worker-1', 'bank-1', { paystackBankCode: ' new-code ' }));
    expect(result.paystackBankCode).toBe('new-code');
    expect(row.requiresPayrollReview).toBe(true);
    expect(row.payrollReviewedAt).toBeNull();
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('0123456789');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      newValue: expect.objectContaining({ paystackBankCode: 'new-code' }),
    }));
  });

  it('clears stale provider overrides when the underlying bank changes', async () => {
    const { service, row } = fixture();
    await requestContext.run({ organisationId: 'org1', userId: 'admin', role: 'OWNER' },
      () => service.update('worker-1', 'bank-1', { bankName: 'Other Bank', bankCode: '999' }));
    expect(row.paystackBankCode).toBeNull();
    expect(row.flutterwaveBankCode).toBeNull();
    expect(row.requiresPayrollReview).toBe(true);
  });
});
