import { PlanPriceNotificationsService } from './plan-price-notifications.service';
import { requestContext } from '../../common/context/request-context';
import { priceNotice } from './plan-price.domain';
import { PlanNotificationStore } from './plan-notification.store';
import { MailerService } from '../../common/mailer/mailer.service';

describe('durable price email delivery', () => {
  const payload = priceNotice(
    {
      id: 'plan',
      name: 'Growth',
      priceMinorUnits: 10000,
      currency: 'NGN',
      billingPeriod: 'ANNUALLY',
    } as never,
    { priceMinorUnits: 20000 },
  )!;
  const event = {
    id: 'event',
    actorId: 'admin',
    planId: 'plan',
    notificationPayload: payload,
    audienceOrganisationIds: ['org-a', 'org-b'],
    fanoutCursor: 0,
  };
  const row = {
    id: 'email',
    organisationId: 'org-a',
    recipientUserId: 'owner',
    payload,
    attempts: 1,
  };
  let tx: any;
  let store: any;
  let mailer: any;
  let prisma: any;
  let service: PlanPriceNotificationsService;
  beforeEach(() => {
    tx = {
      organisation: { findFirst: jest.fn(async () => ({ id: 'org-a', name: 'Company' })) },
      membership: {
        findMany: jest.fn(async () => [{ userId: 'owner' }]),
        findUnique: jest.fn(async () => ({
          role: 'OWNER',
          isActive: true,
          user: { isActive: true, email: 'owner@example.invalid', firstName: 'Owner' },
        })),
      },
    };
    prisma = { withContext: jest.fn(async (_ctx, fn) => fn(tx)) };
    store = {
      pending: jest.fn(async () => [event]),
      enqueue: jest.fn(),
      advance: jest.fn(),
      claim: jest.fn(async () => [row]),
      finish: jest.fn(),
    };
    mailer = { sendPlanPriceChange: jest.fn(async () => true) };
    service = new PlanPriceNotificationsService(prisma, store, mailer);
  });
  const deliver = () =>
    requestContext.run({ organisationId: 'org-a' }, () => service.deliverForCurrentOrganisation());
  it('fans out the snapshotted affected organisations through RLS, not a privileged tenant query', async () => {
    await service.fanOut({} as never);
    expect(prisma.withContext.mock.calls.map(([ctx]: [any]) => ctx.organisationId)).toEqual([
      'org-a',
      'org-b',
    ]);
    expect(store.enqueue).toHaveBeenCalledWith(tx, event, 'org-a', 'owner');
    expect(store.enqueue).toHaveBeenCalledWith(tx, event, 'org-b', 'owner');
    expect(store.advance).toHaveBeenCalledWith({}, event, 2, 0);
  });
  it('finishes the earlier audience before fan-out of a later change on the same plan', async () => {
    const first = {
      ...event,
      audienceOrganisationIds: Array.from({ length: 51 }, (_, i) => `org-${i}`),
    };
    const second = { ...event, id: 'newer-event' };
    store.pending.mockResolvedValue([first, second]);
    await service.fanOut({} as never);
    expect(store.enqueue).toHaveBeenCalledTimes(50);
    expect(store.advance).toHaveBeenCalledTimes(1);
    expect(store.advance).toHaveBeenCalledWith({}, first, 50, 0);
  });
  it('does not advance after a failed enqueue so restart can recover the same audience', async () => {
    store.enqueue.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.fanOut({} as never)).rejects.toThrow();
    expect(store.advance).not.toHaveBeenCalled();
  });
  it('records skipped inactive organisations or missing owners without sending', async () => {
    tx.membership.findMany.mockResolvedValue([]);
    await service.fanOut({} as never);
    expect(store.advance).toHaveBeenCalledWith({}, event, 2, 2);
    expect(store.enqueue).not.toHaveBeenCalled();
  });
  it('marks accepted SMTP only after send, using a stable message id input and exact old/new prices', async () => {
    await deliver();
    expect(mailer.sendPlanPriceChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'email',
        to: 'owner@example.invalid',
        body: expect.stringContaining('NGN 100.00 / year'),
      }),
    );
    expect(store.finish.mock.calls[0][3]).toBe('SENT');
  });
  it('retains failed or unconfigured SMTP for retry instead of marking it sent', async () => {
    mailer.sendPlanPriceChange.mockResolvedValue(false);
    await deliver();
    expect(store.finish.mock.calls[0][3]).toBe('PENDING');
    expect(store.finish.mock.calls[0][4]).toBeInstanceOf(Date);
  });
  it('does not email a revoked Owner or inactive user', async () => {
    tx.membership.findUnique.mockResolvedValue({
      role: 'MANAGER',
      isActive: true,
      user: { isActive: true },
    });
    await deliver();
    expect(mailer.sendPlanPriceChange).not.toHaveBeenCalled();
    expect(store.finish.mock.calls[0][3]).toBe('SKIPPED');
  });
  it('requires tenant context before claiming any recipient records', async () => {
    await expect(service.deliverForCurrentOrganisation()).rejects.toThrow('Organisation context');
    expect(store.claim).not.toHaveBeenCalled();
  });
  it('uses conflict-safe inserts and lease/claim-token recovery at the SQL boundary', async () => {
    const sql = new PlanNotificationStore();
    const client = { $executeRaw: jest.fn(), $queryRaw: jest.fn(async () => []) } as any;
    await sql.enqueue(client, event, 'org-a', 'owner');
    expect(client.$executeRaw.mock.calls[0][0].join('')).toContain('ON CONFLICT');
    await sql.claim(client, 'org-a', 'token');
    const query = client.$queryRaw.mock.calls[0][0].join('');
    expect(query).toContain('FOR UPDATE SKIP LOCKED');
    expect(query).toContain("interval '15 minutes'");
    await sql.finish(client, row, 'token', 'SENT', new Date());
    expect(client.$executeRaw.mock.calls[1][0].join('')).toContain('"claimToken"=');
  });
  it('does not claim SMTP success in local development', async () => {
    const smtp = new MailerService({ get: () => undefined } as never);
    expect(
      await smtp.sendPlanPriceChange({
        id: 'email',
        to: 'test@example.invalid',
        name: 'Owner',
        title: 'Price update',
        body: 'Changed',
      }),
    ).toBe(false);
    const sendMail = jest.fn(async (_input: any) => ({}));
    (smtp as any).transporter = { sendMail };
    await smtp.sendPlanPriceChange({
      id: 'email',
      to: 'test@example.invalid',
      name: '<Owner>',
      title: 'Price update',
      body: '<unsafe>',
    });
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      messageId: '<ascenda-plan-price-email@notifications.ascenda.io>',
    });
    expect(sendMail.mock.calls[0]![0].html).not.toContain('<unsafe>');
  });
});
