import {
  canPerformRunAction,
  isInApprovalChain,
  isRunImmutable,
  runActionError,
} from './run-state';

describe('runActionError', () => {
  it('allows prepare only from DRAFT or IN_REVIEW', () => {
    expect(runActionError('prepare', 'DRAFT')).toBeNull();
    expect(runActionError('prepare', 'IN_REVIEW')).toBeNull();
    expect(runActionError('prepare', 'PENDING_APPROVAL')).toContain('DRAFT');
    expect(runActionError('prepare', 'APPROVED')).toContain('DRAFT');
    expect(runActionError('prepare', 'LOCKED')).toContain('DRAFT');
  });

  it('never allows a reversal run to be re-prepared', () => {
    expect(runActionError('prepare', 'DRAFT', { isReversal: true })).toContain(
      'Reversal',
    );
    expect(
      runActionError('prepare', 'IN_REVIEW', { isReversal: true }),
    ).toContain('Reversal');
  });

  it('allows review only from DRAFT', () => {
    expect(runActionError('review', 'DRAFT')).toBeNull();
    expect(runActionError('review', 'IN_REVIEW')).toContain('DRAFT');
  });

  it('locks item overrides out of the approval chain and beyond', () => {
    expect(runActionError('override', 'DRAFT')).toBeNull();
    expect(runActionError('override', 'IN_REVIEW')).toBeNull();
    expect(runActionError('override', 'PENDING_APPROVAL')).toContain(
      'overridden',
    );
    expect(runActionError('override', 'APPROVED')).toContain('overridden');
  });

  it('allows submit from DRAFT or IN_REVIEW only', () => {
    expect(runActionError('submit', 'DRAFT')).toBeNull();
    expect(runActionError('submit', 'IN_REVIEW')).toBeNull();
    expect(runActionError('submit', 'PENDING_APPROVAL')).toContain('submit');
    expect(runActionError('submit', 'PROCESSED')).toContain('submit');
  });

  it('restricts acknowledge, approve, and reject to PENDING_APPROVAL', () => {
    expect(runActionError('acknowledge', 'PENDING_APPROVAL')).toBeNull();
    expect(runActionError('approve', 'PENDING_APPROVAL')).toBeNull();
    expect(runActionError('reject', 'PENDING_APPROVAL')).toBeNull();
    expect(runActionError('acknowledge', 'IN_REVIEW')).toContain(
      'PENDING_APPROVAL',
    );
    expect(runActionError('approve', 'APPROVED')).toContain('PENDING_APPROVAL');
    expect(runActionError('reject', 'DRAFT')).toContain('PENDING_APPROVAL');
  });

  it('allows process only from APPROVED and lock only from PROCESSED', () => {
    expect(runActionError('process', 'APPROVED')).toBeNull();
    expect(runActionError('process', 'PROCESSED')).toContain('APPROVED');
    expect(runActionError('lock', 'PROCESSED')).toBeNull();
    expect(runActionError('lock', 'APPROVED')).toContain('locked');
  });

  it('allows reverse from APPROVED, PROCESSED, and LOCKED — never twice', () => {
    expect(runActionError('reverse', 'APPROVED')).toBeNull();
    expect(runActionError('reverse', 'PROCESSED')).toBeNull();
    expect(runActionError('reverse', 'LOCKED')).toBeNull();
    expect(runActionError('reverse', 'DRAFT')).toContain('approved');
    expect(
      runActionError('reverse', 'LOCKED', { isReversed: true }),
    ).toContain('already been reversed');
  });
});

describe('canPerformRunAction', () => {
  it('mirrors runActionError', () => {
    expect(canPerformRunAction('submit', 'IN_REVIEW')).toBe(true);
    expect(canPerformRunAction('submit', 'APPROVED')).toBe(false);
  });
});

describe('isRunImmutable / isInApprovalChain', () => {
  it('treats approved and later statuses as immutable', () => {
    expect(isRunImmutable('DRAFT')).toBe(false);
    expect(isRunImmutable('IN_REVIEW')).toBe(false);
    expect(isRunImmutable('PENDING_APPROVAL')).toBe(false);
    expect(isRunImmutable('APPROVED')).toBe(true);
    expect(isRunImmutable('PROCESSED')).toBe(true);
    expect(isRunImmutable('LOCKED')).toBe(true);
  });

  it('marks only PENDING_APPROVAL as in-chain', () => {
    expect(isInApprovalChain('PENDING_APPROVAL')).toBe(true);
    expect(isInApprovalChain('IN_REVIEW')).toBe(false);
    expect(isInApprovalChain('APPROVED')).toBe(false);
  });
});
