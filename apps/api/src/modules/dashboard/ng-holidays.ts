// ─────────────────────────────────────────────────────────────────────────────
// NIGERIAN PUBLIC HOLIDAYS (static dataset)
//
// Reference data for the dashboard insights rail. Kept as a plain year-keyed
// dataset for now; Phase 2 introduces a tenant-editable Holiday calendar model
// and this becomes the seed for the launch country.
//
// Lunar-calendar holidays (Eid al-Fitr, Eid al-Adha, Eid al-Mawlid) are confirmed
// by moon sighting each year and may shift by a day; the dates below are the
// Federal Ministry of Information declarations for the year.
// ─────────────────────────────────────────────────────────────────────────────

export interface PublicHoliday {
  /** ISO 8601 date, "YYYY-MM-DD". */
  date: string;
  name: string;
}

export const NG_HOLIDAYS: Record<number, PublicHoliday[]> = {
  2026: [
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-03-19', name: 'Eid El-Fitr Holiday' },
    { date: '2026-03-20', name: 'Eid El-Fitr' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-04-06', name: 'Easter Monday' },
    { date: '2026-05-01', name: "Workers' Day" },
    { date: '2026-05-27', name: 'Eid ul-Adha' },
    { date: '2026-05-28', name: 'Eid ul-Adha Holiday' },
    { date: '2026-06-12', name: 'Democracy Day' },
    { date: '2026-08-25', name: 'Eid ul-Mawlid' },
    { date: '2026-10-01', name: 'Independence Day' },
    { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2026-12-26', name: 'Boxing Day' },
  ],
};

/**
 * Public holidays for a country in a given month (1–12), sorted by date.
 * Returns an empty list for countries years we don't have data for yet.
 */
export function getHolidaysForMonth(
  country: string,
  year: number,
  month: number,
): PublicHoliday[] {
  if (country.toUpperCase() !== 'NG') {
    return [];
  }
  const all = NG_HOLIDAYS[year] ?? [];
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return all
    .filter((holiday) => holiday.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));
}
