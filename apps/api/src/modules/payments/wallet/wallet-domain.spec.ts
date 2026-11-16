import { applyMovement, movement, payrollRequirement, payoutMovement } from './wallet-domain';

describe('employer payroll funding acceptance (PAY-17)', () => {
  const funded = { pendingMinorUnits: 0, availableMinorUnits: 100_000, reservedMinorUnits: 0, paidMinorUnits: 0 };
  it('reserves the approved net plus fees without creating money', () => {
    const quote = payrollRequirement([20_000, 30_000], [100, 100]);
    expect(quote).toEqual({ net: 50_000, fees: 200, required: 50_200 });
    expect(applyMovement(funded, movement({ availableDelta: -quote.required, reservedDelta: quote.required })))
      .toEqual({ ...funded, availableMinorUnits: 49_800, reservedMinorUnits: 50_200 });
  });
  it('rejects overspending, negative/fractional values and overflow', () => {
    expect(() => applyMovement(funded, movement({ availableDelta: -100_001 }))).toThrow();
    for (const value of [-1, 0, 1.1, NaN, Infinity, 2_147_483_648]) expect(() => payrollRequirement([value], [0])).toThrow();
  });
  it('only moves pending deposits to available after confirmation', () => {
    const pending = applyMovement(funded, movement({ pendingDelta: 5_000 }));
    expect(pending.availableMinorUnits).toBe(funded.availableMinorUnits);
    expect(applyMovement(pending, movement({ pendingDelta: -5_000, availableDelta: 4_900 })).availableMinorUnits).toBe(104_900);
  });
  it('settles paid principal and actual fees, releasing the unused fee allowance', () => {
    expect(payoutMovement('PROCESSING', 'PAID', 5_000, 100, 80, 'DEBIT_CONFIRMED'))
      .toEqual(movement({ reservedDelta: -5_100, availableDelta: 20, paidDelta: 5_000 }));
  });
  it('does not release unknown outcomes or infer a refund from a status label', () => {
    expect(payoutMovement('PROCESSING', 'FAILED', 5_000, 100, 0, 'UNKNOWN')).toBeNull();
    expect(payoutMovement('PAID', 'REVERSED', 5_000, 100, 0, 'UNKNOWN')).toBeNull();
    expect(payoutMovement('PROCESSING', 'PROCESSING', 5_000, 100, 0, 'UNKNOWN')).toBeNull();
  });
  it('releases confirmed failed payments, but never regresses or double-settles terminal payments', () => {
    expect(payoutMovement('PROCESSING', 'FAILED', 5_000, 100, 0, 'NOT_DEBITED'))
      .toEqual(movement({ reservedDelta: -5_100, availableDelta: 5_100 }));
    expect(payoutMovement('PAID', 'PAID', 5_000, 100, 100, 'DEBIT_CONFIRMED')).toBeNull();
    expect(payoutMovement('PAID', 'FAILED', 5_000, 100, 0, 'NOT_DEBITED')).toBeNull();
    expect(payoutMovement('FAILED', 'PAID', 5_000, 100, 0, 'DEBIT_CONFIRMED')).toBeNull();
  });
  it('restores only confirmed returned principal, never assumed refunded fees', () => {
    expect(payoutMovement('PAID', 'REVERSED', 5_000, 100, 100, 'RETURN_CONFIRMED'))
      .toEqual(movement({ availableDelta: 5_000, paidDelta: -5_000 }));
  });
});
