import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { StepUpGuard } from '../../common/auth/step-up.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { requestContext } from '../../common/context/request-context';
import { stepUpSecret } from '../identity-access/identity-access.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlanNotificationStore } from './plan-notification.store';

describe('dedicated Ascenda Admin HTTP boundary', () => {
  let app: INestApplication, base: string;
  const jwt = new JwtService();
  let storedAdmin: { isPlatformAdmin: boolean; isActive: boolean };
  const handlers = {
    listPublic: jest.fn(async () => []),
    listAll: jest.fn(async () => []),
    update: jest.fn(async (_id, dto) => dto),
    create: jest.fn(async (dto) => dto),
    archive: jest.fn(async () => ({})),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    storedAdmin = { isPlatformAdmin: true, isActive: true };
    const module = await Test.createTestingModule({
      controllers: [PlansController, PlatformAdminController],
      providers: [
        PlatformAdminGuard,
        StepUpGuard,
        { provide: PlansService, useValue: handlers },
        {
          provide: PlanNotificationStore,
          useValue: { history: jest.fn(async () => ({ data: [], meta: { total: 0 } })) },
        },
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: async () => storedAdmin },
            withRequestContext: async (fn: (tx: object) => unknown) => fn({}),
          },
        },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: () => 'admin-test-secret' } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      if (req.headers['x-test-auth'])
        req.user = {
          sub: 'admin',
          role: 'OWNER',
          organisationId: 'org-a',
          platformAdmin: req.headers['x-test-platform'] === 'true',
        };
      requestContext.run({ userId: req.user?.sub, organisationId: req.user?.organisationId }, next);
    });
    app.useGlobalGuards({
      canActivate(context) {
        const req = context.switchToHttp().getRequest();
        if (req.path === '/plans' && req.method === 'GET') return true;
        if (!req.user) throw new UnauthorizedException();
        return true;
      },
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterEach(async () => {
    await app?.close();
  });
  const token = (sub = 'admin', organisationId = 'org-a') =>
    jwt.sign(
      { sub, organisationId, purpose: 'step_up' },
      { secret: stepUpSecret('admin-test-secret'), expiresIn: '5m' },
    );
  const request = (
    path: string,
    options: {
      method?: string;
      platform?: boolean;
      auth?: boolean;
      stepUp?: string;
      body?: unknown;
    } = {},
  ) =>
    fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.auth !== false ? { 'x-test-auth': 'yes' } : {}),
        ...(options.platform !== false ? { 'x-test-platform': 'true' } : {}),
        ...(options.stepUp ? { 'x-step-up-token': options.stepUp } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  it('requires a platform account, not merely organisation Owner status', async () => {
    expect((await request('/admin/session', { auth: false })).status).toBe(401);
    for (const path of ['/admin/session', '/admin/plan-events', '/plans/admin']) {
      expect((await request(path, { platform: false })).status).toBe(403);
      expect((await request(path)).status).toBe(200);
    }
  });
  it('rechecks revocation/inactive status instead of trusting a stale platform token', async () => {
    storedAdmin.isPlatformAdmin = false;
    expect((await request('/admin/session')).status).toBe(403);
    storedAdmin.isPlatformAdmin = true;
    storedAdmin.isActive = false;
    expect((await request('/plans/admin')).status).toBe(403);
  });
  it('keeps the signup plan catalogue public', async () => {
    expect((await request('/plans', { auth: false })).status).toBe(200);
  });
  it('requires fresh step-up for catalogue mutations', async () => {
    const body = { priceMinorUnits: 20000 };
    expect((await request('/plans/plan', { method: 'PATCH', body })).status).toBe(403);
    for (const stepUp of [token('other-user'), token('admin', 'other-org'), 'invalid']) {
      expect((await request('/plans/plan', { method: 'PATCH', body, stepUp })).status).toBe(403);
    }
    expect((await request('/plans/plan', { method: 'PATCH', body, stepUp: token() })).status).toBe(
      200,
    );
    expect(handlers.update).toHaveBeenCalledTimes(1);
  });
  it.each([
    { priceMinorUnits: -1 },
    { priceMinorUnits: 1.5 },
    { priceMinorUnits: null },
    { priceMinorUnits: 2147483648 },
    { currency: 'bad-code' },
    { priceMinorUnits: 1, isPlatformAdmin: true },
  ])('validates price changes and rejects mass assignment: %j', async (body) => {
    expect((await request('/plans/plan', { method: 'PATCH', body, stepUp: token() })).status).toBe(
      400,
    );
    expect(handlers.update).not.toHaveBeenCalled();
  });
  it('bounds platform history pagination', async () => {
    expect((await request('/admin/plan-events?pageSize=101')).status).toBe(400);
    expect((await request('/admin/plan-events?page=0')).status).toBe(400);
  });
});
