import { requestContext } from '../../../common/context/request-context';
import { PaymentsService } from '../payments.service';
import { paymentWorkerIdentity, paymentWorkerSelect } from './payment-worker';

describe('payment worker identity', () => {
  it('shows full names and employee numbers, including workers with identical names', () => {
    expect(paymentWorkerIdentity({ firstName: 'Ada', lastName: 'Example', employeeNumber: 'EMP-001' }))
      .toEqual({ workerName: 'Ada Example', employeeNumber: 'EMP-001' });
    expect(paymentWorkerIdentity({ firstName: 'Ada', lastName: 'Example', employeeNumber: 'EMP-002' }))
      .toEqual({ workerName: 'Ada Example', employeeNumber: 'EMP-002' });
  });

  it('does not substitute internal IDs for missing names', () => {
    expect(paymentWorkerIdentity(null)).toEqual({ workerName: undefined, employeeNumber: undefined });
  });

  it('returns worker identity from payment list and detail queries within the tenant transaction', async () => {
    const row = {
      id: 'payment-1', organisationId: 'org-1', workerId: 'worker-1',
      payrollRunId: null, paymentBatchId: null, amountMinorUnits: 10_000,
      currency: 'NGN', status: 'PENDING', reference: 'PAY-001', description: 'Salary',
      processedAt: null, createdAt: new Date(), updatedAt: new Date(),
      worker: { firstName: 'Ada', lastName: 'Example', employeeNumber: 'EMP-001' },
    };
    const tx = { payment: {
      findMany: jest.fn(async () => [row]),
      count: jest.fn(async () => 1),
      findFirst: jest.fn(async () => row),
    } };
    const withRequestContext = jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx));
    const service = new PaymentsService({ withRequestContext } as never,
      { record: jest.fn() } as never, { emit: jest.fn() } as never);
    await requestContext.run({ organisationId: 'org-1', userId: 'user-1' }, async () => {
      const listed = await service.list({ page: 1, pageSize: 50 });
      const detail = await service.get('payment-1');
      expect(listed.data[0]).toMatchObject({ workerName: 'Ada Example', employeeNumber: 'EMP-001' });
      expect(detail).toMatchObject({ workerName: 'Ada Example', employeeNumber: 'EMP-001' });
    });
    expect(withRequestContext).toHaveBeenCalledTimes(2);
    expect(tx.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { worker: { select: paymentWorkerSelect } },
    }));
    expect(tx.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: { worker: { select: paymentWorkerSelect } },
    }));
  });
});
