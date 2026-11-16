/** Employer funding only. Money remains with the payment partner. */
export const MONEY_LIMIT = 2_147_483_647;

export function money(value: number, positive = false): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MONEY_LIMIT || (positive && value <= 0)) {
    throw new Error('Invalid integer minor-unit amount');
  }
  return value;
}

export interface WalletBalances {
  pendingMinorUnits: number;
  availableMinorUnits: number;
  reservedMinorUnits: number;
  paidMinorUnits: number;
}

export interface LedgerMovement {
  pendingDelta: number;
  availableDelta: number;
  reservedDelta: number;
  paidDelta: number;
}

export const movement = (values: Partial<LedgerMovement>): LedgerMovement => ({
  pendingDelta: 0, availableDelta: 0, reservedDelta: 0, paidDelta: 0, ...values,
});

export function applyMovement(balance: WalletBalances, delta: LedgerMovement): WalletBalances {
  const result = {
    pendingMinorUnits: money(balance.pendingMinorUnits + money(delta.pendingDelta)),
    availableMinorUnits: money(balance.availableMinorUnits + money(delta.availableDelta)),
    reservedMinorUnits: money(balance.reservedMinorUnits + money(delta.reservedDelta)),
    paidMinorUnits: money(balance.paidMinorUnits + money(delta.paidDelta)),
  };
  if (Object.values(result).some((value) => value < 0)) throw new Error('Insufficient or inconsistent wallet funds');
  return result;
}

export function payrollRequirement(amounts: number[], fees: number[]): { net: number; fees: number; required: number } {
  if (!amounts.length || amounts.length !== fees.length) throw new Error('Invalid payroll quote');
  const net = amounts.reduce((sum, amount) => money(sum + money(amount, true)), 0);
  const totalFees = fees.reduce((sum, fee) => {
    money(fee);
    if (fee < 0) throw new Error('Invalid payroll fee');
    return money(sum + fee);
  }, 0);
  return { net, fees: totalFees, required: money(net + totalFees, true) };
}

/** A timeout/404 is never proof that a transfer was not debited. */
export function payoutMovement(
  current: string,
  outcome: 'PROCESSING' | 'PAID' | 'FAILED' | 'REVERSED',
  amount: number,
  feeReserved: number,
  actualFee: number,
  evidence: 'UNKNOWN' | 'DEBIT_CONFIRMED' | 'NOT_DEBITED' | 'RETURN_CONFIRMED',
): LedgerMovement | null {
  money(amount, true); money(feeReserved); money(actualFee);
  if (feeReserved < 0 || actualFee < 0 || actualFee > feeReserved) throw new Error('Fee requires reconciliation');
  if (current === outcome || current === 'REVERSED' || (current === 'FAILED' && outcome !== 'FAILED')) return null;
  if (current === 'PAID') {
    if (outcome !== 'REVERSED' || evidence !== 'RETURN_CONFIRMED') return null;
    // Only the confirmed returned principal is restored. Fees are not assumed refunded.
    return movement({ availableDelta: amount, paidDelta: -amount });
  }
  if (outcome === 'PAID' && evidence === 'DEBIT_CONFIRMED') {
    return movement({ reservedDelta: -(amount + feeReserved), availableDelta: feeReserved - actualFee, paidDelta: amount });
  }
  if ((outcome === 'FAILED' && evidence === 'NOT_DEBITED') || (outcome === 'REVERSED' && evidence === 'RETURN_CONFIRMED')) {
    return movement({ reservedDelta: -(amount + feeReserved), availableDelta: amount + feeReserved - actualFee });
  }
  return null;
}
