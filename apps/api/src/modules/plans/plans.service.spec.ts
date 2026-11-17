import { PlansService } from './plans.service';
import { requestContext } from '../../common/context/request-context';

describe('platform catalogue transactional changes', () => {
  const existing = {
    id: 'plan',
    code: 'growth',
    name: 'Growth',
    description: null,
    priceMinorUnits: 10000,
    currency: 'NGN',
    billingPeriod: 'ANNUALLY',
    isFree: false,
    isActive: true,
    features: [],
    minHeadcount: null,
    maxHeadcount: null,
    maxSeats: null,
    sortOrder: 1,
  };
  let tx: any;
  let store: any;
  let service: PlansService;
  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(),
      plan: {
        findUnique: jest.fn(async () => existing),
        count: jest.fn(async () => 1),
        update: jest.fn(async ({ data }) => ({ ...existing, ...data })),
        create: jest.fn(async ({ data }) => ({ ...existing, ...data })),
      },
    };
    store = {
      audience: jest.fn(async () => [{ organisationId: 'org-a' }, { organisationId: 'org-b' }]),
      append: jest.fn(async (_tx, input) => ({
        id: 'event',
        organisationCount: input.audience?.length ?? 0,
      })),
    };
    service = new PlansService(
      { withRequestContext: async (fn: (client: any) => unknown) => fn(tx) } as never,
      store,
    );
  });
  const run = <T>(fn: () => Promise<T>) => requestContext.run({ userId: 'admin' }, fn);
  it('saves the new price and durable audience snapshot in the same transaction', async () => {
    const result = await run(() => service.update('plan', { priceMinorUnits: 20000 }));
    expect(result.priceMinorUnits).toBe(20000);
    expect(result.priceChangeNotification).toEqual({ id: 'event', organisationCount: 2 });
    expect(store.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorId: 'admin',
        audience: ['org-a', 'org-b'],
        notice: expect.objectContaining({ oldPriceMinorUnits: 10000, newPriceMinorUnits: 20000 }),
      }),
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
  it('does not queue price emails for identical prices or description-only changes', async () => {
    await run(() =>
      service.update('plan', { priceMinorUnits: 10000, description: 'New description' }),
    );
    expect(store.audience).not.toHaveBeenCalled();
    expect(store.append.mock.calls[0][1].notice).toBeNull();
  });
  it('refuses unauthenticated mutations and reports required migration instead of false success', async () => {
    await expect(service.update('plan', {})).rejects.toThrow('session required');
    store.append.mockRejectedValueOnce({ code: 'P2010', meta: { code: '42P01' } });
    await expect(run(() => service.update('plan', { priceMinorUnits: 20000 }))).rejects.toThrow(
      'migration 04',
    );
  });
  it('preserves the last active free tier', async () => {
    tx.plan.findUnique.mockResolvedValue({ ...existing, priceMinorUnits: 0, isFree: true });
    tx.plan.count.mockResolvedValue(0);
    await expect(run(() => service.update('plan', { priceMinorUnits: 1 }))).rejects.toThrow(
      'only active free plan',
    );
    expect(tx.plan.update).not.toHaveBeenCalled();
    expect(store.audience).not.toHaveBeenCalled();
  });
});
