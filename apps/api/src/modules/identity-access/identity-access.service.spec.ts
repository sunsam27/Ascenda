import { SystemRole } from '@ascenda/db';
import {
  IdentityAccessService,
  type SafeUser,
} from './identity-access.service';

function buildService(membership: { organisationId: string; role: string } | null) {
  const prisma = {
    withContext: async <T>(
      _ctx: unknown,
      fn: (tx: unknown) => Promise<T>,
    ): Promise<T> =>
      fn({
        membership: {
          findFirst: async () => membership,
        },
      }),
  } as never;

  const config = {
    get: (_key: string, fallback?: string) => fallback,
  } as never;

  const jwt = {
    sign: () => 'signed-token',
  } as never;

  const audit = {
    record: async () => undefined,
  } as never;

  const mailer = {} as never;

  return new IdentityAccessService(prisma, config, jwt, audit, mailer);
}

function makeUser(isPlatformAdmin: boolean): SafeUser {
  return {
    id: '2bb7f110-55fe-4c35-b740-60fe722d5975',
    email: 'samuel@example.com',
    firstName: 'Samuel',
    lastName: 'Admin',
    avatarUrl: null,
    isMfaEnabled: false,
    isPlatformAdmin,
  };
}

async function loginRedirect(
  isPlatformAdmin: boolean,
  membership: { organisationId: string; role: string } | null,
): Promise<string> {
  const service = buildService(membership);
  jest.spyOn(service, 'validateUser').mockResolvedValue(makeUser(isPlatformAdmin));

  const result = await service.login({
    email: 'samuel@example.com',
    password: 'password-with-any-value',
  });
  return result.redirectTo;
}

describe('IdentityAccessService.login redirect', () => {
  it('sends a platform admin with an active membership to the workspace', async () => {
    expect(
      await loginRedirect(true, {
        organisationId: 'f6bd1e4a-740e-42cf-b1f9-3fa3b09dbda5',
        role: SystemRole.OWNER,
      }),
    ).toBe('/dashboard');
  });

  it('sends a platform admin with a self-service membership to /me', async () => {
    expect(
      await loginRedirect(true, {
        organisationId: 'f6bd1e4a-740e-42cf-b1f9-3fa3b09dbda5',
        role: SystemRole.EMPLOYEE_SELF,
      }),
    ).toBe('/me');
  });

  it('still sends a platform admin with no membership to /admin', async () => {
    expect(await loginRedirect(true, null)).toBe('/admin');
  });

  it('keeps role-based routing for non-platform admins', async () => {
    expect(
      await loginRedirect(false, {
        organisationId: 'f6bd1e4a-740e-42cf-b1f9-3fa3b09dbda5',
        role: SystemRole.OWNER,
      }),
    ).toBe('/dashboard');
    expect(await loginRedirect(false, null)).toBe('/dashboard');
  });
});
