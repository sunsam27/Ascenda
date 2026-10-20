import { of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from '../../modules/audit/audit.service';

function makeContext(
  method: string,
  path: string,
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, path, url: path, params, body }),
    }),
  } as never;
}

describe('AuditInterceptor', () => {
  let record: jest.Mock;
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    record = jest.fn().mockResolvedValue(undefined);
    interceptor = new AuditInterceptor({ record } as unknown as AuditService);
  });

  function run(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string>,
  ): unknown {
    let result: unknown;
    interceptor
      .intercept(makeContext(method, path, body, params), {
        handle: () => of({ ok: true }),
      } as never)
      .subscribe((value: unknown) => {
        result = value;
      });
    return result;
  }

  it('audits a normal worker create', () => {
    run('POST', '/api/v1/workers', { firstName: 'Ada' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({
      action: 'WORKER_CREATED',
      targetType: 'workers',
    });
  });

  it('audits a worker update and delete', () => {
    run('PATCH', '/api/v1/workers/w1', { jobTitle: 'Pastor' }, { id: 'w1' });
    run('DELETE', '/api/v1/workers/w1', undefined, { id: 'w1' });
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0]![0].action).toBe('WORKER_UPDATED');
    expect(record.mock.calls[1]![0].action).toBe('WORKER_DELETED');
  });

  it('does NOT audit the CSV import commit (service audits a summary)', () => {
    run('POST', '/api/v1/workers/import', { csv: 'a,b,c' });
    expect(record).not.toHaveBeenCalled();
  });

  it('does NOT audit the read-only import preview', () => {
    run('POST', '/api/v1/workers/import/preview', { csv: 'a,b,c' });
    expect(record).not.toHaveBeenCalled();
  });

  it('does not audit auth routes (recorded explicitly by the service)', () => {
    run('POST', '/api/v1/auth/login', { email: 'a@b.c' });
    run('POST', '/api/v1/auth/logout');
    expect(record).not.toHaveBeenCalled();
  });

  it('audits a payroll run creation (PAY-06)', () => {
    run('POST', '/api/v1/payroll/runs', { periodStart: '2026-01-01' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({
      action: 'PAYROLL_RUN_CREATED',
      targetType: 'payroll',
    });
  });

  it('does NOT audit payroll setup routes (services audit them explicitly)', () => {
    run('POST', '/api/v1/payroll/pay-calendars', { name: 'Monthly' });
    run('POST', '/api/v1/payroll/recurring-items', { name: 'Cooperative' });
    run('PATCH', '/api/v1/payroll/pay-calendars/pc1', { name: 'Renamed' });
    run('DELETE', '/api/v1/payroll/recurring-items/r1');
    expect(record).not.toHaveBeenCalled();
  });

  it('skips non-state-changing methods', () => {
    run('GET', '/api/v1/workers', undefined, { id: 'w1' });
    run('GET', '/api/v1/organisations');
    expect(record).not.toHaveBeenCalled();
  });
});
