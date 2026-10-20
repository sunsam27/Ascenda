// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL RUN LIFECYCLE (PRD PAY-06 / PAY-07)
// Pure functions — no I/O. The run moves
//   DRAFT → IN_REVIEW → PENDING_APPROVAL → APPROVED → PROCESSED → LOCKED
// with two lateral moves: reject (PENDING_APPROVAL → IN_REVIEW) and reverse
// (any post-approval status → new DRAFT reversal run; the original is only
// stamped, never mutated). An approved run is immutable: corrections happen
// via reversal or in the next period — never by editing lines in place.
// ─────────────────────────────────────────────────────────────────────────────

export type RunStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PROCESSED'
  | 'LOCKED';

export type RunAction =
  | 'prepare'
  | 'review'
  | 'override'
  | 'submit'
  | 'acknowledge'
  | 'approve'
  | 'reject'
  | 'process'
  | 'lock'
  | 'reverse';

export interface RunActionContext {
  /** PAY-06: a reversal run is a mirror — it can never be re-prepared. */
  isReversal?: boolean;
  /** PAY-06: an already-reversed original can never be reversed again. */
  isReversed?: boolean;
}

/**
 * Returns a human-readable reason the action is not allowed from `status`,
 * or `null` when the action is permitted. Callers assert at the service edge.
 */
export function runActionError(
  action: RunAction,
  status: RunStatus,
  ctx: RunActionContext = {},
): string | null {
  if (action === 'prepare') {
    if (ctx.isReversal) {
      return 'Reversal runs carry mirrored items and cannot be re-prepared';
    }
    if (status === 'DRAFT' || status === 'IN_REVIEW') return null;
    return `A run can only be prepared while DRAFT or IN_REVIEW (currently ${status})`;
  }

  switch (action) {
    case 'review':
      return status === 'DRAFT'
        ? null
        : `A run can only enter review from DRAFT (currently ${status})`;
    case 'override':
      return status === 'DRAFT' || status === 'IN_REVIEW'
        ? null
        : `Items can only be overridden while the run is DRAFT or IN_REVIEW (currently ${status})`;
    case 'submit':
      return status === 'DRAFT' || status === 'IN_REVIEW'
        ? null
        : `A run can only be submitted from DRAFT or IN_REVIEW (currently ${status})`;
    case 'acknowledge':
      return status === 'PENDING_APPROVAL'
        ? null
        : `Warnings can only be acknowledged while the run is PENDING_APPROVAL (currently ${status})`;
    case 'approve':
    case 'reject':
      return status === 'PENDING_APPROVAL'
        ? null
        : `A run can only be approved or rejected while PENDING_APPROVAL (currently ${status})`;
    case 'process':
      return status === 'APPROVED'
        ? null
        : `Payments can only be processed for an APPROVED run (currently ${status})`;
    case 'lock':
      return status === 'PROCESSED'
        ? null
        : `A run can only be locked after processing (currently ${status})`;
    case 'reverse':
      if (ctx.isReversed) {
        return 'This run has already been reversed';
      }
      return status === 'APPROVED' ||
        status === 'PROCESSED' ||
        status === 'LOCKED'
        ? null
        : `Only approved, processed, or locked runs can be reversed (currently ${status})`;
  }
}

/** Boolean convenience wrapper around {@link runActionError}. */
export function canPerformRunAction(
  action: RunAction,
  status: RunStatus,
  ctx: RunActionContext = {},
): boolean {
  return runActionError(action, status, ctx) === null;
}

/**
 * PAY-06: statuses in which a run is immutable — items, totals, and notes are
 * frozen; only reverse/lock-style terminal actions apply.
 */
export function isRunImmutable(status: RunStatus): boolean {
  return (
    status === 'APPROVED' || status === 'PROCESSED' || status === 'LOCKED'
  );
}

/** PAY-07: statuses a prepared run may sit in once submitted (chain started). */
export function isInApprovalChain(status: RunStatus): boolean {
  return status === 'PENDING_APPROVAL';
}
