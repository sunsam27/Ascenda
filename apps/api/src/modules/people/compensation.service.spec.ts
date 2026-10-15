import { BadRequestException, ConflictException } from '@nestjs/common';
import { PayFrequency } from '@ascenda/types';
import { requestContext } from '../../common/context/request-context';
import {
  CompensationService,
  periodsOverlap,
  toCompensationRecord,
} from './compensation.service';

type Row = ReturnType<typeof makeRow>;

function makeRow(
  workerId: string,
  validFrom: string,
  validTo: string | null,
  grossAmountMinorUnits = 500_000,
) {
  return {
    id: `c-${validFrom}`,
    organisationId: 'org1',
    workerId,
    grossAmountMinorUnits,
    currency: 'NGN',
    payFrequency: 'MONTHLY' as const,
    validFrom: new Date(validFrom),
    validTo: validTo ? new Date(validTo) : null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: 'u1',
  };
}

function eq(value: unknown, expected: unknown): boolean {
  if (value instanceof Date && expected instanceof Date) {
    return value.getTime() === expected.getTime();
  }
  return value === expected;
}

function matches(row: Record<string, unknown>, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === 'AND') {
      if (!(cond as unknown[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!(cond as unknown[]).some((w) => matches(row, w))) return false;
      continue;
    }
    const value = row[key];
    if (
      cond === null ||
      typeof cond !== 'object' ||
      cond instanceof Date ||
      Array.isArray(cond)
    ) {
      if (!eq(value, cond)) return false;
      continue;
    }
    const operand = (cond as Record<string, unknown>)['gt'];
    if (operand !== undefined) {
      if (!(num(value) > num(operand))) return false;
      continue;
    }
    const lte = (cond as Record<string, unknown>)['lte'];
    if (lte !== undefined) {
      if (!(num(value) <= num(lte))) return false;
      continue;
    }
    const lt = (cond as Record<string, unknown>)['lt'];
    if (lt !== undefined) {
      if (!(num(value) < num(lt))) return false;
      continue;
    }
    const not = (cond as Record<string, unknown>)['not'];
    if (not !== undefined) {
      if (eq(value, not)) return false;
      continue;
    }
  }
  return true;
}

function num(value: unknown): number {
  return value instanceof Date ? value.getTime() : (value as number);
}

function sortRows(rows: Row[], orderBy?: Record<string, string>): Row[] {
  if (!orderBy?.['validFrom']) return [...rows];
  const dir = orderBy['validFrom'] === 'desc' ? -1 : 1;
  return [...rows].sort(
    (a, b) => dir * (a.validFrom.getTime() - b.validFrom.getTime()),
  );
}

/** In-memory stand-in for the pieces of Prisma the service touches. */
function buildFixture(seed: Row[]) {
  const rows = [...seed];

  const record = {
    findMany: async (args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, string>;
      exclude?: string;
    }) =>
      sortRows(
        rows.filter((r) => matches(r, args.where)),
        args.orderBy,
      ),
    findFirst: async (args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, string>;
    }) =>
      sortRows(rows.filter((r) => matches(r, args.where)), args.orderBy)[0] ??
      null,
    create: async (args: {
      data: Record<string, unknown> & { workerId: string };
    }) => {
      const row = {
        ...makeRow(args.data.workerId, '2020-01-01', null),
        id: `c-new-${rows.length + 1}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: 'u1',
        ...args.data,
      } as unknown as Row;
      rows.push(row);
      return row;
    },
    updateMany: async (args: {
      where?: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const row of rows) {
        if (matches(row, args.where)) {
          Object.assign(row, args.data);
          count++;
        }
      }
      return { count };
    },
    update: async (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const row = rows.find((r) => matches(r, args.where));
      if (!row) throw new Error('record not found');
      Object.assign(row, args.data);
      return row;
    },
    delete: async (args: { where: Record<string, unknown> }) => {
      const index = rows.findIndex((r) => matches(r, args.where));
      const [removed] = rows.splice(index, 1);
      return removed;
    },
  };

  const tx = {
    worker: {
      findFirst: async (args: { where?: Record<string, unknown> }) =>
        matches({ id: 'w1' }, args.where) ? { id: 'w1' } : null,
    },
    organisation: { findUnique: async () => ({ currency: 'NGN' }) },
    compensationRecord: record,
  };

  const prisma = {
    withRequestContext: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as never;

  return {
    service: new CompensationService(prisma),
    rows,
    asOwner: <T>(fn: () => Promise<T>) =>
      requestContext.run(
        { organisationId: 'org1', userId: 'u1', role: 'OWNER' },
        fn,
      ),
  };
}

describe('periodsOverlap', () => {
  const a = new Date('2026-01-01T00:00:00.000Z');
  const b = new Date('2026-04-01T00:00:00.000Z');
  const c = new Date('2026-07-01T00:00:00.000Z');

  it('detects a shared boundary as non-overlapping (half-open intervals)', () => {
    expect(periodsOverlap(a, b, b, c)).toBe(false);
    expect(periodsOverlap(a, b, b, null)).toBe(false);
    expect(periodsOverlap(a, null, b, c)).toBe(true);
  });

  it('detects interior and open-ended overlap', () => {
    expect(periodsOverlap(a, c, b, null)).toBe(true);
    expect(periodsOverlap(b, null, a, b)).toBe(false);
    expect(periodsOverlap(a, b, a, b)).toBe(true);
  });
});

describe('toCompensationRecord', () => {
  it('serialises dates and drops a null validTo / notes', () => {
    const record = toCompensationRecord(makeRow('w1', '2026-01-01', null));
    expect(record.validFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(record.validTo).toBeUndefined();
    expect(record.notes).toBeUndefined();
    expect(record.payFrequency).toBe('MONTHLY');
    expect(record.grossAmountMinorUnits).toBe(500_000);
  });
});

describe('CompensationService.create (effective dating)', () => {
  it('closes the previous open record the day the new rate starts', async () => {
    const prior = makeRow('w1', '2026-01-01', null, 500_000);
    const { service, rows, asOwner } = buildFixture([prior]);

    const created = await asOwner(() =>
      service.create('w1', {
        grossAmountMinorUnits: 650_000,
        payFrequency: PayFrequency.MONTHLY,
        validFrom: '2026-04-01',
      }),
    );

    expect(created.validTo).toBeUndefined();
    expect(prior.validTo?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(rows).toHaveLength(2);
  });

  it('caps a new open-ended record at the next scheduled change', async () => {
    const future = makeRow('w1', '2026-07-01', null, 800_000);
    const { service, rows, asOwner } = buildFixture([future]);

    const created = await asOwner(() =>
      service.create('w1', {
        grossAmountMinorUnits: 450_000,
        payFrequency: PayFrequency.MONTHLY,
        validFrom: '2026-01-01',
      }),
    );

    expect(created.validTo).toBe('2026-07-01T00:00:00.000Z');
    expect(future.validTo).toBeNull();
    expect(rows).toHaveLength(2);
  });

  it('rejects a period that overlaps a closed record', async () => {
    const { service, asOwner } = buildFixture([
      makeRow('w1', '2026-01-01', '2026-04-01'),
    ]);

    await expect(
      asOwner(() =>
        service.create('w1', {
          grossAmountMinorUnits: 1,
          payFrequency: PayFrequency.MONTHLY,
          validFrom: '2026-02-01',
        }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an end date that is not after the start', async () => {
    const { service, asOwner } = buildFixture([]);
    await expect(
      asOwner(() =>
        service.create('w1', {
          grossAmountMinorUnits: 1,
          payFrequency: PayFrequency.MONTHLY,
          validFrom: '2026-05-01',
          validTo: '2026-05-01',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('falls back to the organisation currency and upper-cases a supplied one', async () => {
    const { service, asOwner, rows } = buildFixture([]);

    const defaulted = await asOwner(() =>
      service.create('w1', {
        grossAmountMinorUnits: 100,
        payFrequency: PayFrequency.WEEKLY,
        validFrom: '2026-01-01',
      }),
    );
    const supplied = await asOwner(() =>
      service.create('w1', {
        grossAmountMinorUnits: 200,
        currency: 'gbp',
        payFrequency: PayFrequency.WEEKLY,
        validFrom: '2026-02-01',
      }),
    );

    expect(defaulted.currency).toBe('NGN');
    expect(supplied.currency).toBe('GBP');
    expect(rows).toHaveLength(2);
  });
});

describe('CompensationService.getCurrent', () => {
  it('returns the rate covering the requested date and null when none', async () => {
    const { service, asOwner } = buildFixture([
      makeRow('w1', '2026-01-01', '2026-04-01', 500_000),
      makeRow('w1', '2026-04-01', null, 650_000),
    ]);

    const historic = await asOwner(() =>
      service.getCurrent('w1', '2026-02-01'),
    );
    const current = await asOwner(() => service.getCurrent('w1', '2026-06-01'));

    expect(historic?.grossAmountMinorUnits).toBe(500_000);
    expect(current?.grossAmountMinorUnits).toBe(650_000);
    expect(current?.validTo).toBeUndefined();
  });

  it('returns null for a date before the first record', async () => {
    const { service, asOwner } = buildFixture([
      makeRow('w1', '2026-04-01', null),
    ]);
    expect(await asOwner(() => service.getCurrent('w1', '2026-01-01'))).toBeNull();
  });
});
