import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RbacGuard } from '../../../common/rbac/rbac.guard';
import { StepUpGuard } from '../../../common/auth/step-up.guard';
import { stepUpSecret } from '../../identity-access/identity-access.service';
import { EmployerWalletController, EmployerWalletWebhooksController } from './wallet.controller';
import { EmployerWalletService } from './wallet.service';
import { EmployerFundingRegistry } from './wallet-provider';
import { PaymentsController } from '../payments.controller';
import { PaymentsService } from '../payments.service';
import { PayoutsController } from '../payouts/payouts.controller';
import { PayoutsService } from '../payouts/payouts.service';

describe('employer funding HTTP access and validation', () => {
  let app: INestApplication, base: string;
  const jwt = new JwtService();
  const org = 'e5341971-45eb-4eb5-861e-6822bbb2d3ef';
  const batch = '36dad108-d348-4944-ab84-b23351e89acf';
  const handlers = {
    summary: jest.fn(async () => ({ status: 'NOT_STARTED', providerReady: false, fundingAccount: null })),
    setup: jest.fn(async () => ({ status: 'PENDING_VERIFICATION' })), syncSetup: jest.fn(),
    ledger: jest.fn(async () => ({ data: [] })), history: jest.fn(async () => ({ data: [] })),
    quote: jest.fn(async () => ({ canSubmit: false })), submit: jest.fn(), reconcile: jest.fn(),
    webhook: jest.fn(async () => new EmployerFundingRegistry().require()),
  };
  const token = (sub = 'owner', organisationId = org) => jwt.sign({ sub, organisationId, purpose: 'step_up' }, { secret: stepUpSecret('test-secret'), expiresIn: '5m' });
  const headers = (role: string, stepUp = false) => ({ 'Content-Type': 'application/json', 'x-test-role': role, ...(stepUp ? { 'x-step-up-token': token() } : {}) });
  const profile = { legalName: 'Company A', registrationNumber: 'RC1234', companyAddress: 'Company address', representativeName: 'Owner A', representativeEmail: 'owner@example.com', representativePhone: '08000000000', representativeRole: 'Director', authorised: true };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      // Deliberately register the old generic payment controller first.
      controllers: [PaymentsController, PayoutsController, EmployerWalletController, EmployerWalletWebhooksController],
      providers: [StepUpGuard, { provide: EmployerWalletService, useValue: handlers }, { provide: PaymentsService, useValue: {} }, { provide: PayoutsService, useValue: {} },
        { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: { get: () => 'test-secret' } }],
    }).overrideGuard(AuthGuard('jwt')).useValue({ canActivate(ctx: any) {
      if (!ctx.switchToHttp().getRequest().user) throw new UnauthorizedException();
      return true;
    } }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: unknown, next: () => void) => {
      if (req.headers['x-test-role']) req.user = { sub: 'owner', role: req.headers['x-test-role'], organisationId: org };
      next();
    });
    app.useGlobalGuards(new RbacGuard(new Reflector()));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/payments/employer-wallet`;
  });
  afterAll(async () => { await app?.close(); });

  it('routes the wallet summary rather than treating it as a payment UUID', async () => {
    const result = await fetch(base, { headers: headers('OWNER') });
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ providerReady: false, fundingAccount: null });
  });
  it.each(['', '/ledger', '/history', `/batches/${batch}/quote`, `/batches/${batch}/retry-quote`])('protects organisation funding reads at %s', async (path) => {
    expect((await fetch(`${base}${path}`)).status).toBe(403);
    expect((await fetch(`${base}${path}`, { headers: headers('EMPLOYEE_SELF') })).status).toBe(403);
    expect((await fetch(`${base}${path}`, { headers: headers('OWNER') })).status).toBe(200);
  });
  it('restricts setup to settings administrators and requires a fresh user/org-bound token', async () => {
    const body = JSON.stringify(profile);
    expect((await fetch(`${base}/setup`, { method: 'POST', headers: headers('FINANCE_APPROVER', true), body })).status).toBe(403);
    expect((await fetch(`${base}/setup`, { method: 'POST', headers: headers('OWNER'), body })).status).toBe(403);
    for (const bad of [token('another-user'), token('owner', 'another-org')]) {
      expect((await fetch(`${base}/setup`, { method: 'POST', headers: { ...headers('OWNER'), 'x-step-up-token': bad }, body })).status).toBe(403);
    }
    expect((await fetch(`${base}/setup`, { method: 'POST', headers: headers('OWNER', true), body })).status).toBe(201);
  });
  it('rejects attempted balance credits and provider credentials in setup', async () => {
    for (const extra of [{ availableMinorUnits: 1_000_000 }, { secretKey: 'do-not-accept' }, { status: 'ACTIVE' }, { providerWalletReference: 'foreign' }]) {
      expect((await fetch(`${base}/setup`, { method: 'POST', headers: headers('OWNER', true), body: JSON.stringify({ ...profile, ...extra }) })).status).toBe(400);
    }
    expect((await fetch(`${base}/setup`, { method: 'POST', headers: headers('OWNER', true), body: JSON.stringify({ ...profile, authorised: false }) })).status).toBe(400);
  });
  it.each(['pay', 'retry'])('requires payment approval and step-up for %s', async (action) => {
    const body = JSON.stringify({ requestKey: batch, expectedRequiredMinorUnits: 100 });
    const url = `${base}/batches/${batch}/${action}`;
    expect((await fetch(url, { method: 'POST', headers: headers('PAYROLL_ADMINISTRATOR', true), body })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: headers('FINANCE_APPROVER'), body })).status).toBe(403);
    expect((await fetch(url, { method: 'POST', headers: headers('FINANCE_APPROVER', true), body })).status).toBe(201);
    expect((await fetch(url, { method: 'POST', headers: headers('FINANCE_APPROVER', true), body: JSON.stringify({ requestKey: batch, expectedRequiredMinorUnits: -1 }) })).status).toBe(400);
  });
  it('fails closed on unconfigured webhooks and exposes no manual deposit/balance-credit API', async () => {
    expect((await fetch(`${base}/webhooks/${org}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(503);
    for (const path of ['credit', 'deposit', 'balance', 'activate']) {
      expect((await fetch(`${base}/${path}`, { method: 'POST', headers: headers('OWNER', true), body: '{}' })).status).toBe(404);
    }
  });

  it('removes direct-bank setup and merchant-owned provider connection APIs', async () => {
    const payments = base.replace('/employer-wallet', '');
    for (const [method, path] of [
      ['GET', '/bank-connectors'], ['POST', '/bank-connectors/GTBANK/connect'],
      ['GET', '/payout-options'], ['PUT', '/payout-account'], ['DELETE', '/payout-account'],
    ]) {
      const response = await fetch(`${payments}${path}`, { method, headers: headers('OWNER', true) });
      expect(response.status).toBe(404);
    }
  });
});
