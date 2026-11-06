import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { requestContext, getRequestContext } from '../../common/context/request-context';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { UploadSafetyService } from '../../common/storage/upload-safety.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentWorkflowsService } from './document-workflows.service';

type Row = Record<string, any>;
/** Actual HTTP/validation/RBAC/upload service; identity, RLS and storage are doubles. */
describe('Documents HTTP boundary', () => {
  let app: INestApplication;
  let base: string;
  let rows: Row[];
  let stored: Map<string, Buffer>;
  const workflows = { publishPolicy: jest.fn(), publishAnnouncement: jest.fn(), acknowledge: jest.fn(),
    announcements: jest.fn(), policyReport: jest.fn(), updateDocument: jest.fn() };
  beforeEach(async () => {
    rows = []; stored = new Map(); jest.clearAllMocks();
    const matches = (row: Row, where: Row): boolean => {
      if (row.organisationId !== getRequestContext()?.organisationId) return false;
      if (where.AND) return where.AND.every((part: Row) => matches(row, part));
      if (where.OR) return where.OR.some((part: Row) => matches(row, part));
      if (where.policyRecipients) return false;
      if (where.id && where.id !== row.id) return false;
      if ('deletedAt' in where && row.deletedAt !== where.deletedAt) return false;
      if (where.workerId && row.workerId !== where.workerId) return false;
      if (where.type?.not && row.type === where.type.not) return false;
      return true;
    };
    const tx = {
      worker: { findFirst: jest.fn(async ({ where }: Row) => where.userId ? { id: 'own-worker' } : { id: where.id }) },
      document: {
        findMany: jest.fn(async ({ where }: Row) => rows.filter((r) => matches(r, where))),
        count: jest.fn(async ({ where }: Row) => rows.filter((r) => matches(r, where)).length),
        findFirst: jest.fn(async ({ where }: Row) => rows.find((r) => matches(r, where)) ?? null),
        create: jest.fn(async ({ data }: Row) => {
          const row = { ...data, id: '00000000-0000-4000-8000-000000000001', worker: null, policyRecipients: [],
            deletedAt: null, policyPublishedAt: null, createdAt: new Date(), updatedAt: new Date() };
          rows.push(row); return row;
        }),
      },
    };
    const prisma = { withRequestContext: async (fn: (tx: Row) => unknown) => fn(tx) };
    const storage = { put: async (buffer: Buffer, organisationId: string) => {
      const key = `${organisationId}/file`; stored.set(key, buffer); return { key };
    }, get: async (key: string) => stored.get(key), signedDownload: async () => undefined, delete: jest.fn() };
    const service = new DocumentsService(prisma as never, storage as never, { record: jest.fn() } as never, new UploadSafetyService());
    const module = await Test.createTestingModule({ controllers: [DocumentsController], providers: [
      { provide: DocumentsService, useValue: service }, { provide: DocumentWorkflowsService, useValue: workflows },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: Row, _res: unknown, next: () => void) => {
      const role = req.headers['x-test-role'];
      if (role) req.user = { role };
      requestContext.run({ organisationId: req.headers['x-test-org'] ?? 'org1', userId: 'reader', role }, next);
    });
    app.useGlobalGuards({ canActivate(ctx) { if (!ctx.switchToHttp().getRequest().user) throw new UnauthorizedException(); return true; } },
      new RbacGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterEach(async () => { await app?.close(); });
  function request(method: string, path: string, body?: unknown, role?: string, organisationId = 'org1') {
    return fetch(`${base}/documents${path}`, { method, headers: { 'Content-Type': 'application/json',
      ...(role ? { 'x-test-role': role } : {}), 'x-test-org': organisationId }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const upload = { name: 'Contract.pdf', type: 'CONTRACT', mimeType: 'application/pdf',
    content: Buffer.from('%PDF-1.7\nfixture\n%%EOF').toString('base64') };

  it('denies unauthenticated access and self-service uploads/deletions', async () => {
    expect((await request('GET', '')).status).toBe(401);
    expect((await request('POST', '', upload, 'EMPLOYEE_SELF')).status).toBe(403);
    expect((await request('DELETE', '/some-id', undefined, 'EMPLOYEE_SELF')).status).toBe(403);
  });
  it('allows HR uploads and authenticated downloads without exposing storage keys', async () => {
    const response = await request('POST', '', upload, 'HR_ADMINISTRATOR');
    expect(response.status).toBe(201);
    const result = await response.json() as Row;
    expect(JSON.stringify(result)).not.toContain('storageKey');
    const download = await request('GET', `/${result.data.id}/download`, undefined, 'HR_ADMINISTRATOR');
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(await download.text()).toContain('%PDF-');
  });
  it('returns 404 for another tenant or another worker, including direct downloads', async () => {
    const response = await request('POST', '', upload, 'OWNER');
    const { data } = await response.json() as Row;
    expect((await request('GET', `/${data.id}`, undefined, 'OWNER', 'org2')).status).toBe(404);
    expect((await request('GET', `/${data.id}/download`, undefined, 'OWNER', 'org2')).status).toBe(404);
    expect((await request('GET', `/${data.id}/download`, undefined, 'EMPLOYEE_SELF')).status).toBe(404);
  });
  it('rejects fake MIME types and over-posting without storing bytes', async () => {
    expect((await request('POST', '', { ...upload, mimeType: 'image/jpeg' }, 'OWNER')).status).toBe(400);
    expect((await request('POST', '', { ...upload, storageKey: 'other-org/private' }, 'OWNER')).status).toBe(400);
    expect(stored.size).toBe(0);
  });
  it('protects policy publication and announcement creation from self-service users', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect((await request('POST', `/${id}/publish`, {}, 'EMPLOYEE_SELF')).status).toBe(403);
    expect((await request('POST', '/announcements', { title: 'Test', body: 'Message' }, 'EMPLOYEE_SELF')).status).toBe(403);
    expect((await request('POST', `/${id}/publish`, {}, 'HR_ADMINISTRATOR')).status).toBe(201);
    expect(workflows.publishPolicy).toHaveBeenCalledWith(id, expect.anything());
  });
});
