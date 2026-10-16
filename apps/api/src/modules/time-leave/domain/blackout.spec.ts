import { blackoutApplies } from './blackout';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('blackout periods (LVE-05)', () => {
  it('matches a non-recurring window that overlaps the request', () => {
    const window = { startDate: d('2026-12-20'), endDate: d('2026-12-31'), isRecurring: false };
    expect(blackoutApplies(window, d('2026-12-21'), d('2026-12-24'))).toBe(true);
    expect(blackoutApplies(window, d('2026-12-31'), d('2027-01-02'))).toBe(true);
    expect(blackoutApplies(window, d('2026-11-01'), d('2026-11-30'))).toBe(false);
  });

  it('matches an annual recurring window in a later year', () => {
    const window = { startDate: d('2020-12-24'), endDate: d('2020-12-31'), isRecurring: true };
    expect(blackoutApplies(window, d('2027-12-25'), d('2027-12-26'))).toBe(true);
    expect(blackoutApplies(window, d('2027-12-01'), d('2027-12-10'))).toBe(false);
  });

  it('matches a recurring window when a request spans the new year', () => {
    const jan = { startDate: d('2020-01-01'), endDate: d('2020-01-05'), isRecurring: true };
    expect(blackoutApplies(jan, d('2026-12-30'), d('2027-01-03'))).toBe(true);
  });
});
