// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT BATCH APPROVAL — SEPARATION OF DUTIES
//
// Mirrors the payroll-run rule: the person who prepared a batch may not approve
// it unless they are an OWNER (owners already override the approval chain).
// Money movement is irreversible, so maker and checker must be different people
// wherever the organisation has more than one.
// ─────────────────────────────────────────────────────────────────────────────

export function paymentBatchSelfApprovalError({
  createdById,
  actorId,
  actorRole,
}: {
  createdById: string;
  actorId: string;
  actorRole: string;
}): string | null {
  if (createdById !== actorId) return null;
  if (actorRole === 'OWNER') return null;
  return 'Separation of duties: only an OWNER can approve a payment batch they created';
}
