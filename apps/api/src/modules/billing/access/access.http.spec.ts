import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminGuard } from '../../../common/auth/platform-admin.guard';
import { StepUpGuard } from '../../../common/auth/step-up.guard';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { requestContext } from '../../../common/context/request-context';
import { stepUpSecret } from '../../identity-access/identity-access.service';
import { AdminSubscriptionAccessController, SubscriptionAccessController } from './access.controller';
import { SubscriptionAccessService } from './access.service';

describe('subscription access admin HTTP boundary', () => {
  let app: INestApplication, base: string;
  const jwt = new JwtService();
  let storedAdmin = { isPlatformAdmin: true, isActive: true };
  const handlers = {
    planPolicies: jest.fn(async () => ({ data: [], enforcementEnabled: true })),
    updatePolicy: jest.fn(async (_id: string, dto: object) => dto),
    organisations: jest.fn(async () => ({ data: [], meta: { total: 0 } })),
    adminDetail: jest.fn(async () => ({})),
    updateOrganisation: jest.fn(async (_id: string, dto: object) => dto),
    snapshot: jest.fn(async () => ({ features: {} })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storedAdmin = { isPlatformAdmin: true, isActive: true };
    const module = await Test.createTestingModule({
      controllers: [AdminSubscriptionAccessController, SubscriptionAccessController],
      providers: [
        PlatformAdminGuard,
        StepUpGuard,
        { provide: SubscriptionAccessService, useValue: handlers },
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

  it('keeps access policies platform-admin only and reflects live revocation', async () => {
    for (const path of ['/admin/access/plans', '/admin/access/organisations']) {
      expect((await request(path, { auth: false })).status).toBe(401);
      expect((await request(path, { platform: false })).status).toBe(403);
      expect((await request(path)).status).toBe(200);
    }
    storedAdmin.isPlatformAdmin = false;
    expect((await request('/admin/access/plans')).status).toBe(403);
  });

  it('requires step-up for every access mutation', async () => {
    const plan = {
      enabledFeatures: { people: true, timeLeave: true, documents: true, payroll: false, payments: false, analytics: false },
      trialDays: 0,
      trialFeatures: { people: false, timeLeave: false, documents: false, payroll: false, payments: false, analytics: false },
      defaultDemoDays: 14,
      reason: 'Reviewed free tier policy',
    };
    expect((await request('/admin/access/plans/00000000-0000-4000-8000-000000000001', { method: 'PATCH', body: plan })).status).toBe(403);
    expect((await request('/admin/access/plans/00000000-0000-4000-8000-000000000001', { method: 'PATCH', body: plan, stepUp: token('other-user') })).status).toBe(403);
    expect((await request('/admin/access/plans/00000000-0000-4000-8000-000000000001', { method: 'PATCH', body: plan, stepUp: token() })).status).toBe(200);
    expect(handlers.updatePolicy).toHaveBeenCalledTimes(1);
  });

  it('validates feature flags and finite durations and rejects mass assignment', async () => {
    const features = { people: false, timeLeave: false, documents: false, payroll: true, payments: false, analytics: false };
    const path = '/admin/access/organisations/00000000-0000-4000-8000-000000000001';
    const invalid = [
      { name: 'unknown action', body: { action: 'unknown', reason: 'Valid reason' } },
      { name: 'short reason', body: { action: 'demo', reason: 'bad' } },
      { name: 'non-boolean feature', body: { action: 'demo', features: { payroll: 'yes' }, reason: 'Valid reason' } },
      { name: 'zero-day demo', body: { action: 'demo', features, days: 0, reason: 'Valid reason' } },
      { name: 'mass assignment', body: { action: 'demo', features, reason: 'Valid reason', manualState: 'SUSPENDED' } },
    ];
    const statuses: Record<string, number> = {};
    for (const { name, body } of invalid) {
      statuses[name] = (await request(path, { method: 'PATCH', body, stepUp: token() })).status;
    }
    expect(statuses).toEqual({
      'unknown action': 400,
      'short reason': 400,
      'non-boolean feature': 400,
      'zero-day demo': 400,
      'mass assignment': 400,
    });
    expect(handlers.updateOrganisation).not.toHaveBeenCalled();
    expect((await request(path, { method: 'PATCH', body: { action: 'demo', features, days: 14, reason: 'Customer evaluation' }, stepUp: token() })).status).toBe(200);
    expect(handlers.updateOrganisation).toHaveBeenCalledTimes(1);
  });

  it('bounds organisation pagination', async () => {
    expect((await request('/admin/access/organisations?pageSize=101')).status).toBe(400);
    expect((await request('/admin/access/organisations?page=0')).status).toBe(400);
  });
});
