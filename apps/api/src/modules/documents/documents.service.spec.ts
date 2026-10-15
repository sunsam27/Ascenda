import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@ascenda/db';
import { DocumentType } from '@ascenda/types';
import { requestContext } from '../../common/context/request-context';
import {
  DocumentsService,
  MAX_UPLOAD_BYTES,
  decodeBase64Content,
  toDocumentSummary,
} from './documents.service';
import type { ListDocumentsQueryDto } from './dto/list-documents.dto';

const query = (
  overrides: Partial<ListDocumentsQueryDto> = {},
): ListDocumentsQueryDto => ({ page: 1, pageSize: 25, ...overrides });

interface DocRow {
  id: string;
  organisationId: string;
  workerId: string | null;
  type: DocumentType;
  name: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
  worker: {
    firstName: string;
    lastName: string;
    preferredName: string | null;
  } | null;
}

function makeRow(overrides: Partial<DocRow> = {}): DocRow {
  return {
    id: 'doc1',
    organisationId: 'org1',
    workerId: 'w1',
    type: DocumentType.CONTRACT,
    name: 'Employment Contract.pdf',
    storageKey: 'org1/abc',
    mimeType: 'application/pdf',
    sizeBytes: 1234,
    uploadedBy: 'u1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    worker: {
      firstName: 'Ada',
      lastName: 'Obi',
      preferredName: null,
    },
    ...overrides,
  };
}

function matches(row: DocRow, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === 'AND') {
      if (!(cond as unknown[]).every((w) => matches(row, w))) return false;
      continue;
    }
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond === null || typeof cond !== 'object') {
      if (value !== cond) return false;
      continue;
    }
    const contains = (cond as Record<string, unknown>)['contains'];
    if (typeof contains === 'string') {
      if (!String(value).toLowerCase().includes(contains.toLowerCase())) {
        return false;
      }
      continue;
    }
  }
  return true;
}

function buildFixture(seed: DocRow[], workerUserId = 'u-self') {
  const rows = [...seed];
  const stored = new Map<string, Buffer>();
  const auditCalls: Array<{ action: string }> = [];
  let keySeq = 0;

  const document = {
    findMany: async (args: { where?: unknown }) =>
      rows.filter((r) => matches(r, args.where)),
    count: async (args: { where?: unknown }) =>
      rows.filter((r) => matches(r, args.where)).length,
    findFirst: async (args: { where?: unknown }) =>
      rows.find((r) => matches(r, args.where)) ?? null,
    create: async (args: { data: Record<string, unknown> }) => {
      const row = makeRow({
        id: `doc-${rows.length + 1}`,
        ...(args.data as Partial<DocRow>),
      });
      rows.push(row);
      return row;
    },
    delete: async (args: { where: { id: string } }) => {
      const index = rows.findIndex((r) => r.id === args.where.id);
      const [removed] = rows.splice(index, 1);
      return removed;
    },
  };

  const tx = {
    worker: {
      findFirst: async (args: { where?: Record<string, unknown> }) => {
        const where = args.where ?? {};
        if ('userId' in where) {
          return workerUserId ? { id: 'w-self' } : null;
        }
        return { id: (where['id'] as string) ?? 'w1' };
      },
    },
    document,
  };

  const prisma = {
    withRequestContext: <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  } as never;

  const storage = {
    put: async (buffer: Buffer, prefix?: string) => {
      const key = `${prefix ?? ''}/key-${++keySeq}`;
      stored.set(key, buffer);
      return { key };
    },
    get: async (key: string) => stored.get(key) ?? Buffer.from('file'),
    delete: async (key: string) => {
      stored.delete(key);
    },
  } as never;

  const audit = {
    record: async (entry: { action: string }) => {
      auditCalls.push(entry);
    },
  } as never;

  return {
    service: new DocumentsService(prisma, storage, audit),
    rows,
    stored,
    auditCalls,
    asRole: <T>(role: string, userId: string, fn: () => Promise<T>) =>
      requestContext.run({ organisationId: 'org1', userId, role }, fn),
  };
}

describe('decodeBase64Content', () => {
  it('decodes a plain base64 string and a data URL prefix', () => {
    const plain = Buffer.from('hello').toString('base64');
    expect(decodeBase64Content(plain).toString()).toBe('hello');
    expect(decodeBase64Content(`data:application/pdf;base64,${plain}`).toString()).toBe(
      'hello',
    );
  });

  it('rejects empty and oversized payloads', () => {
    expect(() => decodeBase64Content('')).toThrow(BadRequestException);
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString('base64');
    expect(() => decodeBase64Content(big)).toThrow(BadRequestException);
  });
});

describe('toDocumentSummary', () => {
  it('serialises dates, joins the worker name and hides the storage key', () => {
    const summary = toDocumentSummary(makeRow());
    expect(summary.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(summary.workerName).toBe('Ada Obi');
    expect(summary.downloadUrl).toBe('/api/v1/documents/doc1/download');
    expect(JSON.stringify(summary)).not.toContain('org1/abc');
  });

  it('prefers the worker’s preferred name', () => {
    const summary = toDocumentSummary(
      makeRow({
        worker: { firstName: 'Ada', lastName: 'Obi', preferredName: 'Pastor Ada' },
      }),
    );
    expect(summary.workerName).toBe('Pastor Ada');
  });
});

describe('DocumentsService scope', () => {
  const personal = makeRow({
    id: 'own',
    workerId: 'w-self',
    uploadedBy: 'u-self',
  });
  const other = makeRow({
    id: 'other',
    workerId: 'w9',
    name: 'Payroll Policy.pdf',
  });

  it('lets an organisation role see every document', async () => {
    const { service, asRole } = buildFixture([personal, other]);
    const result = await asRole('OWNER', 'u1', () => service.list(query()));
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });

  it('restricts a self-service role to its own worker’s documents', async () => {
    const { service, asRole } = buildFixture([personal, other]);
    const result = await asRole('EMPLOYEE_SELF', 'u-self', () =>
      service.list(query()),
    );
    expect(result.data.map((d) => d.id)).toEqual(['own']);
  });

  it('returns nothing for a role without document access', async () => {
    const { service, asRole } = buildFixture([personal, other]);
    const result = await asRole('MANAGER', 'u1', () => service.list(query()));
    expect(result.data).toHaveLength(0);
  });

  it('filters by type and name search', async () => {
    const { service, asRole } = buildFixture([
      makeRow({ id: 'a', name: 'Payslip January', type: DocumentType.PAYSLIP }),
      makeRow({ id: 'b', name: 'Contract', type: DocumentType.CONTRACT }),
    ]);
    const byType = await asRole('OWNER', 'u1', () =>
      service.list(query({ type: DocumentType.PAYSLIP })),
    );
    const bySearch = await asRole('OWNER', 'u1', () =>
      service.list(query({ search: 'contract' })),
    );
    expect(byType.data.map((d) => d.id)).toEqual(['a']);
    expect(bySearch.data.map((d) => d.id)).toEqual(['b']);
  });

  it('hides other workers’ documents from a self role on direct get', async () => {
    const { service, asRole } = buildFixture([personal, other]);
    await expect(
      asRole('EMPLOYEE_SELF', 'u-self', () => service.get('other')),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('DocumentsService.create', () => {
  it('stores the decoded bytes, records the size and audits the upload', async () => {
    const { service, asRole, stored, auditCalls } = buildFixture([]);
    const content = Buffer.from('signed contract').toString('base64');

    const summary = await asRole('OWNER', 'u1', () =>
      service.create({
        name: 'Contract.pdf',
        type: DocumentType.CONTRACT,
        workerId: 'w1',
        mimeType: 'application/pdf',
        content,
      }),
    );

    expect(summary.sizeBytes).toBe('signed contract'.length);
    expect(stored.size).toBe(1);
    expect(auditCalls[0]?.action).toBe(AuditAction.DOCUMENT_UPLOADED);
  });

  it('rejects an unknown worker', async () => {
    const service = new DocumentsService(
      {
        withRequestContext: <T>(fn: (t: unknown) => Promise<T>) =>
          fn({ worker: { findFirst: async () => null }, document: {} }),
      } as never,
      { put: async () => ({ key: 'k' }) } as never,
      { record: async () => undefined } as never,
    );
    await expect(
      requestContext.run({ organisationId: 'org1', userId: 'u1', role: 'OWNER' }, () =>
        service.create({
          name: 'x',
          type: DocumentType.OTHER,
          workerId: 'missing',
          mimeType: 'text/plain',
          content: Buffer.from('x').toString('base64'),
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('DocumentsService.download / remove', () => {
  it('streams bytes and audits access', async () => {
    const { service, asRole, auditCalls, stored } = buildFixture([makeRow()]);
    stored.set('org1/abc', Buffer.from('bytes'));

    const result = await asRole('OWNER', 'u1', () => service.download('doc1'));
    expect(result.buffer.toString()).toBe('bytes');
    expect(auditCalls[0]?.action).toBe(AuditAction.DOCUMENT_ACCESSED);
  });

  it('deletes the row and its stored blob', async () => {
    const { service, asRole, rows, stored } = buildFixture([makeRow()]);
    stored.set('org1/abc', Buffer.from('bytes'));

    await asRole('OWNER', 'u1', () => service.remove('doc1'));
    expect(rows).toHaveLength(0);
    expect(stored.has('org1/abc')).toBe(false);
  });
});
