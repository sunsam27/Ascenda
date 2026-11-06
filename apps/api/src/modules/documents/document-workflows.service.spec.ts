import { DocumentWorkflowsService } from './document-workflows.service';
import { requestContext, getRequestContext } from '../../common/context/request-context';

type Row = Record<string, any>;
function fixture() {
  const doc: Row = { id: 'policy-1', organisationId: 'org1', type: 'POLICY', workerId: null,
    expiresAt: null, policyPublishedAt: null, deletedAt: null };
  const policies: Row[] = [];
  const announcements: Row[] = [];
  const recipients: Row[] = [];
  const members = [{ userId: 'reader-1', user: { firstName: 'Ada', lastName: 'Example' } }];
  const tx = {
    document: {
      findFirst: jest.fn(async ({ where }: Row) => where.id === doc.id && getRequestContext()?.organisationId === doc.organisationId ? { ...doc } : null),
      updateMany: jest.fn(async ({ data }: Row) => {
        if (doc.policyPublishedAt) return { count: 0 };
        Object.assign(doc, data); return { count: 1 };
      }),
      update: jest.fn(async ({ data }: Row) => Object.assign(doc, data)),
      findMany: jest.fn(async (_args: Row): Promise<Row[]> => []), delete: jest.fn(),
    },
    department: { findFirst: jest.fn(async () => null as Row | null) },
    location: { findFirst: jest.fn(async () => null as Row | null) },
    worker: { findMany: jest.fn(async () => [{ userId: 'reader-1' }]), findFirst: jest.fn(async () => null) },
    membership: { findMany: jest.fn(async () => members), findFirst: jest.fn(async () => ({ id: 'membership-1' })) },
    policyRecipient: {
      createMany: jest.fn(async ({ data }: Row) => { policies.push(...data.map((r: Row) => ({ ...r, id: `policy-recipient-${policies.length}`, acknowledgedAt: null, notifiedAt: null }))); return { count: data.length }; }),
      findMany: jest.fn(async ({ where }: Row) => policies.filter((r) => where.notifiedAt === null ? !r.notifiedAt : true)),
      findFirst: jest.fn(async ({ where }: Row) => policies.find((r) => r.userId === where.userId && r.documentId === where.documentId && r.organisationId === where.organisationId) ?? null),
      update: jest.fn(async ({ where, data }: Row) => Object.assign(policies.find((r) => r.id === where.id)!, data)),
      updateMany: jest.fn(async ({ where, data }: Row) => { Object.assign(policies.find((r) => r.id === where.id)!, data); return { count: 1 }; }),
    },
    announcement: {
      create: jest.fn(async ({ data }: Row) => { const row = { ...data, id: 'announcement-1', createdAt: new Date() };
        announcements.push(row); recipients.push(...data.recipients.create.map((r: Row) => ({ ...r, id: 'a-recipient-1', announcement: row, notifiedAt: null }))); return row; }),
      findMany: jest.fn(async () => announcements), count: jest.fn(async () => announcements.length),
    },
    announcementRecipient: {
      findMany: jest.fn(async () => recipients.filter((r) => !r.notifiedAt)),
      update: jest.fn(async ({ where, data }: Row) => Object.assign(recipients.find((r) => r.id === where.id)!, data)),
    },
  };
  const prisma = { withRequestContext: async (fn: (tx: Row) => unknown) => fn(tx) };
  const audit = { record: jest.fn() };
  const notifications = { emit: jest.fn(async () => 1) };
  const storage = { delete: jest.fn() };
  const service = new DocumentWorkflowsService(prisma as never, audit as never, notifications as never, storage as never);
  const run = <T>(fn: () => Promise<T>, userId = 'owner', organisationId = 'org1', role = 'OWNER') =>
    requestContext.run({ organisationId, userId, role }, fn);
  return { doc, policies, announcements, recipients, tx, service, notifications, audit, storage, run };
}

describe('document policy workflows', () => {
  it('snapshots active readers, publishes once, audits and sends notifications', async () => {
    const f = fixture();
    expect(await f.run(() => f.service.publishPolicy('policy-1', {}))).toEqual({ id: 'policy-1', recipientCount: 1 });
    expect(f.policies[0]).toMatchObject({ userId: 'reader-1', organisationId: 'org1' });
    expect(f.notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ intents: [expect.objectContaining({ type: 'POLICY_AVAILABLE' })] }));
    expect(f.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'POLICY_PUBLISHED' }));
    await expect(f.run(() => f.service.publishPolicy('policy-1', {}))).rejects.toThrow(/already been published/);
  });
  it('does not publish private worker files or expired policies', async () => {
    const f = fixture(); f.doc.workerId = 'worker-1';
    await expect(f.run(() => f.service.publishPolicy('policy-1', {}))).rejects.toThrow(/private worker file/);
    f.doc.workerId = null; f.doc.expiresAt = new Date('2000-01-01');
    await expect(f.run(() => f.service.publishPolicy('policy-1', {}))).rejects.toThrow(/expired/);
  });
  it('does not accept a department or policy from another tenant', async () => {
    const f = fixture();
    await expect(f.run(() => f.service.publishPolicy('policy-1', { departmentId: 'foreign' }))).rejects.toThrow(/Department not found/);
    await expect(f.run(() => f.service.publishPolicy('policy-1', {}), 'owner', 'org2')).rejects.toThrow(/not found/);
  });
  it('records only the authenticated recipient acknowledgement and preserves the original timestamp', async () => {
    const f = fixture();
    await f.run(() => f.service.publishPolicy('policy-1', {}));
    await expect(f.run(() => f.service.acknowledge('policy-1'), 'unassigned')).rejects.toThrow(/not assigned/);
    const first = await f.run(() => f.service.acknowledge('policy-1'), 'reader-1');
    expect(await f.run(() => f.service.acknowledge('policy-1'), 'reader-1')).toEqual(first);
    expect(f.tx.policyRecipient.updateMany).toHaveBeenCalledTimes(1);
    expect(await f.run(() => f.service.policyReport('policy-1'))).toEqual([
      expect.objectContaining({ name: 'Ada Example', acknowledgedAt: first.acknowledgedAt }),
    ]);
  });
  it('keeps published policy versions immutable', async () => {
    const f = fixture(); f.doc.policyPublishedAt = new Date();
    await expect(f.run(() => f.service.updateDocument('policy-1', { name: 'replacement' }))).rejects.toThrow(/immutable/);
  });
  it('updates expiry and resets the reminder marker', async () => {
    const f = fixture();
    await f.run(() => f.service.updateDocument('policy-1', { expiresAt: '2027-01-01T00:00:00Z' }));
    expect(f.doc.expiryRemindedAt).toBeNull();
    expect(f.doc.expiresAt).toEqual(new Date('2027-01-01T00:00:00Z'));
  });
  it('rejects an edit if the policy was concurrently published', async () => {
    const f = fixture(); f.tx.document.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.run(() => f.service.updateDocument('policy-1', { name: 'New name' }))).rejects.toThrow(/changed/);
  });
});

describe('document maintenance', () => {
  it('retries inaccessible tombstones and keeps failures for the next pass', async () => {
    const f = fixture();
    f.tx.document.findMany.mockImplementation(async ({ where }: Row) => where.deletedAt?.not === null
      ? [{ id: 'deleted-1', storageKey: 'org1/blob' }] as never : []);
    f.storage.delete.mockRejectedValueOnce(new Error('storage unavailable'));
    await f.run(() => f.service.maintenance());
    expect(f.tx.document.delete).not.toHaveBeenCalled();
    await f.run(() => f.service.maintenance());
    expect(f.tx.document.delete).toHaveBeenCalledWith({ where: { id: 'deleted-1' } });
  });
  it('queues expiry and overdue-policy reminders and records reminder markers', async () => {
    const f = fixture();
    f.tx.document.findMany.mockImplementation(async ({ where }: Row) => where.expiresAt
      ? [{ id: 'expiring-1', workerId: null, type: 'CONTRACT' }] as never : []);
    f.policies.push({ id: 'reminder-1', userId: 'reader-1', organisationId: 'org1', documentId: 'policy-1',
      notifiedAt: new Date(), acknowledgedAt: null, createdAt: new Date('2000-01-01') });
    await f.run(() => f.service.maintenance());
    expect(f.notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ intents: [expect.objectContaining({ type: 'DOCUMENT_EXPIRING' })] }));
    expect(f.notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ intents: [expect.objectContaining({ type: 'POLICY_REMINDER' })] }));
    expect(f.policies[0]?.remindedAt).toBeInstanceOf(Date);
    expect(f.tx.policyRecipient.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ acknowledgedAt: null }) }));
  });
});

describe('announcement delivery', () => {
  it('targets the selected worker category and queues in-app/email notifications', async () => {
    const f = fixture();
    await f.run(() => f.service.publishAnnouncement({ title: 'Training', body: 'Join the session', category: 'VOLUNTEER' as never }));
    expect(f.tx.worker.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ category: 'VOLUNTEER', status: 'ACTIVE' }) }));
    expect(f.notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ intents: [expect.objectContaining({ title: 'Training', type: 'ANNOUNCEMENT_AVAILABLE' })] }));
  });
  it('filters the employee announcement list by the authenticated recipient', async () => {
    const f = fixture();
    await f.run(() => f.service.announcements(), 'reader-1', 'org1', 'EMPLOYEE_SELF');
    expect(f.tx.announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      organisationId: 'org1', recipients: { some: { userId: 'reader-1' } },
    } }));
  });
  it('keeps failed notification deliveries pending for a later scheduler retry', async () => {
    const f = fixture(); f.notifications.emit.mockRejectedValueOnce(new Error('database unavailable'));
    const created = await f.run(() => f.service.publishAnnouncement({ title: 'Hello', body: 'A message' }));
    expect(created.id).toBe('announcement-1');
    expect(f.recipients[0]?.notifiedAt).toBeNull();
    await f.run(() => f.service.deliverPending());
    expect(f.recipients[0]?.notifiedAt).toBeInstanceOf(Date);
  });
  it('does not notify a removed member', async () => {
    const f = fixture(); f.tx.membership.findFirst.mockResolvedValue(null as never);
    await f.run(() => f.service.publishAnnouncement({ title: 'Hello', body: 'A message' }));
    expect(f.notifications.emit).not.toHaveBeenCalled();
  });
});
