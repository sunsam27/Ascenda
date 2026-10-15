import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuditAction } from '@ascenda/db';
import { OrganisationType } from '@ascenda/types';
import {
  OrganisationsService,
  sanitizeTerminology,
} from './organisations.service';

type Row = ReturnType<typeof makeRow>;

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'org1',
    name: 'Grace Chapel',
    slug: 'grace-chapel',
    type: 'CHURCH' as const,
    country: 'NG',
    currency: 'NGN',
    timezone: 'Africa/Lagos',
    terminology: { Department: 'Ministry' } as Record<string, string>,
    logoUrl: null as string | null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface AuditEntry {
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}

/** In-memory stand-in for the pieces of Prisma the service touches. */
function buildFixture(seed: Row | null) {
  const state = { rows: seed ? [seed] : [] };

  const tx = {
    organisation: {
      findFirst: async () => state.rows[0] ?? null,
      update: async (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = state.rows.find((r) => r.id === args.where.id);
        if (!row) throw new Error('organisation not found');
        Object.assign(row, args.data);
        return row;
      },
    },
  };

  const prisma = {
    withRequestContext: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as never;

  const auditCalls: AuditEntry[] = [];
  const audit = {
    record: async (entry: AuditEntry) => {
      auditCalls.push(entry);
    },
  } as never;

  return {
    service: new OrganisationsService(prisma, audit),
    get row() {
      return state.rows[0];
    },
    auditCalls,
  };
}

describe('sanitizeTerminology', () => {
  it('trims keys and values and drops blanks', () => {
    expect(
      sanitizeTerminology({
        ' Department ': ' Ministry ',
        Employee: '',
        '   ': 'x',
      }),
    ).toEqual({ Department: 'Ministry' });
  });

  it('rejects non-string values', () => {
    expect(() => sanitizeTerminology({ Employee: 3 as unknown as string })).toThrow(
      BadRequestException,
    );
  });

  it('rejects too many terms', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 41; i++) many[`Term${i}`] = 'X';
    expect(() => sanitizeTerminology(many)).toThrow(BadRequestException);
  });

  it('rejects over-long values', () => {
    expect(() => sanitizeTerminology({ Employee: 'x'.repeat(61) })).toThrow(
      BadRequestException,
    );
  });
});

describe('OrganisationsService.update', () => {
  it('applies only the provided fields', async () => {
    const { service, row } = buildFixture(makeRow());

    const updated = await service.update({
      country: 'GH',
      currency: 'GHS',
    });

    expect(updated.country).toBe('GH');
    expect(updated.currency).toBe('GHS');
    expect(row?.name).toBe('Grace Chapel');
    expect(row?.timezone).toBe('Africa/Lagos');
  });

  it('normalises and persists terminology overrides', async () => {
    const { service, row } = buildFixture(makeRow());

    await service.update({
      terminology: { Employee: 'Pastor', Department: 'Ministry' },
    });

    expect(row?.terminology).toEqual({
      Employee: 'Pastor',
      Department: 'Ministry',
    });
  });

  it('clears logoUrl when an empty string is supplied', async () => {
    const { service, row } = buildFixture(
      makeRow({ logoUrl: 'https://cdn.example/logo.png' }),
    );

    await service.update({ logoUrl: '' });

    expect(row?.logoUrl).toBeNull();
  });

  it('records an audit entry with previous and new values', async () => {
    const { service, auditCalls } = buildFixture(makeRow());

    await service.update({ currency: 'USD' });

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]?.action).toBe(AuditAction.ORGANISATION_UPDATED);
    expect(auditCalls[0]?.targetType).toBe('organisation');
    expect(auditCalls[0]?.previousValue).toEqual({ currency: 'NGN' });
    expect(auditCalls[0]?.newValue).toMatchObject({ currency: 'USD' });
  });

  it('throws when there is no active organisation', async () => {
    const { service } = buildFixture(null);
    await expect(service.update({ currency: 'USD' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a blank name', async () => {
    const { service } = buildFixture(makeRow());
    await expect(service.update({ name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts an organisation type change', async () => {
    const { service, row } = buildFixture(makeRow());
    await service.update({ type: OrganisationType.NGO });
    expect(row?.type).toBe('NGO');
  });
});
