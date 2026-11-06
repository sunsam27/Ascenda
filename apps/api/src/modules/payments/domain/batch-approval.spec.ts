import { paymentBatchSelfApprovalError } from './batch-approval';

describe('paymentBatchSelfApprovalError', () => {
  it('allows a different person to approve', () => {
    expect(
      paymentBatchSelfApprovalError({
        createdById: 'creator-1',
        actorId: 'approver-1',
        actorRole: 'FINANCE_APPROVER',
      }),
    ).toBeNull();
  });

  it('blocks the creator from approving their own batch', () => {
    expect(
      paymentBatchSelfApprovalError({
        createdById: 'creator-1',
        actorId: 'creator-1',
        actorRole: 'FINANCE_APPROVER',
      }),
    ).toMatch(/separation of duties/i);
  });

  it('lets an OWNER self-approve', () => {
    expect(
      paymentBatchSelfApprovalError({
        createdById: 'owner-1',
        actorId: 'owner-1',
        actorRole: 'OWNER',
      }),
    ).toBeNull();
  });
});
