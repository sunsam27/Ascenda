import { Prisma } from '@ascenda/db';
import { applyUsage, remaining, reverseUsage } from './domain/leave-balance';

export interface BalanceKey {
  organisationId: string;
  workerId: string;
  leaveTypeId: string;
  year: number;
}

const dec = (value: number): Prisma.Decimal => new Prisma.Decimal(value);

/**
 * Get the balance row for a (worker, leave type, year), creating it with the
 * leave type's default entitlement on first use. Balances are per calendar year
 * (LVE-05).
 */
export async function ensureBalance(
  tx: Prisma.TransactionClient,
  key: BalanceKey,
  defaultAccrued: number,
) {
  const existing = await tx.leaveBalance.findUnique({
    where: {
      organisationId_workerId_leaveTypeId_year: {
        organisationId: key.organisationId,
        workerId: key.workerId,
        leaveTypeId: key.leaveTypeId,
        year: key.year,
      },
    },
  });
  if (existing) return existing;

  const accrued = Math.max(0, defaultAccrued);
  return tx.leaveBalance.create({
    data: {
      organisationId: key.organisationId,
      workerId: key.workerId,
      leaveTypeId: key.leaveTypeId,
      year: key.year,
      accrued: dec(accrued),
      used: dec(0),
      balance: dec(accrued),
    },
  });
}

/**
 * Consume `days` from a balance — called when a request reaches final approval
 * (LVE-02). Throws {@link InsufficientLeaveBalanceError} unless `allowNegative`.
 */
export async function applyApprovedLeave(
  tx: Prisma.TransactionClient,
  key: BalanceKey,
  defaultAccrued: number,
  days: number,
  allowNegative: boolean,
) {
  const row = await ensureBalance(tx, key, defaultAccrued);
  const next = applyUsage(
    { accrued: Number(row.accrued), used: Number(row.used) },
    days,
    { allowNegative },
  );
  return tx.leaveBalance.update({
    where: { id: row.id },
    data: { used: dec(next.used), balance: dec(remaining(next)) },
  });
}

/** Restore days to a balance when approved leave is cancelled (LVE-02). */
export async function reverseApprovedLeave(
  tx: Prisma.TransactionClient,
  key: BalanceKey,
  defaultAccrued: number,
  days: number,
) {
  const row = await ensureBalance(tx, key, defaultAccrued);
  const next = reverseUsage(
    { accrued: Number(row.accrued), used: Number(row.used) },
    days,
  );
  return tx.leaveBalance.update({
    where: { id: row.id },
    data: { used: dec(next.used), balance: dec(remaining(next)) },
  });
}
