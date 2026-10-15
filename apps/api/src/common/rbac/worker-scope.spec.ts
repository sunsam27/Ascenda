import { PermissionScope } from '@ascenda/types';
import type { Prisma } from '@ascenda/db';
import { requestContext } from '../context/request-context';
import {
  buildWorkerScopeWhere,
  resolveReadScope,
  scopeWhereRestricts,
  NO_ACCESS_WHERE,
  type CallerWorker,
} from './worker-scope';

const caller: CallerWorker = {
  id: 'w-manager',
  departmentId: 'd1',
  locationId: 'l1',
};

function fakeTx(found: CallerWorker | null): Prisma.TransactionClient {
  return {
    worker: { findFirst: jest.fn().mockResolvedValue(found) },
  } as unknown as Prisma.TransactionClient;
}

/** Run `fn` with the given request context in scope (AsyncLocalStorage). */
function withContext<T>(
  store: { role?: string; userId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return requestContext.run(store, fn);
}


describe('buildWorkerScopeWhere', () => {
  it('does not restrict ORGANISATION callers', () => {
    expect(buildWorkerScopeWhere(PermissionScope.ORGANISATION, caller)).toEqual(
      {},
    );
  });

  it('limits TEAM callers to themselves and their direct reports', () => {
    expect(buildWorkerScopeWhere(PermissionScope.TEAM, caller)).toEqual({
      OR: [{ id: 'w-manager' }, { managerId: 'w-manager' }],
    });
  });

  it('limits DEPARTMENT and LOCATION callers to their own area', () => {
    expect(buildWorkerScopeWhere(PermissionScope.DEPARTMENT, caller)).toEqual({
      departmentId: 'd1',
    });
    expect(buildWorkerScopeWhere(PermissionScope.LOCATION, caller)).toEqual({
      locationId: 'l1',
    });
  });

  it('limits SELF callers to their own record', () => {
    expect(buildWorkerScopeWhere(PermissionScope.SELF, caller)).toEqual({
      id: 'w-manager',
    });
  });

  it('matches nothing when a narrower scope cannot be resolved', () => {
    expect(buildWorkerScopeWhere(PermissionScope.TEAM, null)).toEqual(
      NO_ACCESS_WHERE,
    );
    expect(buildWorkerScopeWhere(PermissionScope.SELF, null)).toEqual(
      NO_ACCESS_WHERE,
    );
    expect(
      buildWorkerScopeWhere(PermissionScope.DEPARTMENT, {
        ...caller,
        departmentId: null,
      }),
    ).toEqual(NO_ACCESS_WHERE);
    expect(
      buildWorkerScopeWhere(PermissionScope.LOCATION, {
        ...caller,
        locationId: null,
      }),
    ).toEqual(NO_ACCESS_WHERE);
  });
});

describe('scopeWhereRestricts', () => {
  it('treats an empty fragment as unrestricted', () => {
    expect(scopeWhereRestricts({})).toBe(false);
  });

  it('treats a populated fragment as restricting', () => {
    expect(scopeWhereRestricts(NO_ACCESS_WHERE)).toBe(true);
    expect(scopeWhereRestricts({ id: 'x' })).toBe(true);
  });
});

describe('resolveReadScope', () => {
  it('returns an unrestricted fragment for organisation-scoped roles', async () => {
    const tx = fakeTx(caller);
    const result = await withContext(
      { role: 'OWNER', userId: 'u1' },
      () => resolveReadScope(tx, 'workers', 'read'),
    );
    expect(result.scope).toBe(PermissionScope.ORGANISATION);
    expect(result.where).toEqual({});
    expect(tx.worker.findFirst).not.toHaveBeenCalled();
  });

  it('resolves the caller worker and narrows TEAM scope', async () => {
    const tx = fakeTx(caller);
    const result = await withContext(
      { role: 'MANAGER', userId: 'u1' },
      () => resolveReadScope(tx, 'workers', 'read'),
    );
    expect(result.scope).toBe(PermissionScope.TEAM);
    expect(result.caller).toEqual(caller);
    expect(result.where).toEqual({
      OR: [{ id: 'w-manager' }, { managerId: 'w-manager' }],
    });
    expect(tx.worker.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { id: true, departmentId: true, locationId: true },
    });
  });

  it('denies when the role has no matching grant', async () => {
    const tx = fakeTx(caller);
    const result = await withContext(
      { role: 'MANAGER', userId: 'u1' },
      () => resolveReadScope(tx, 'workers', 'delete'),
    );
    expect(result.scope).toBeNull();
    expect(result.where).toEqual(NO_ACCESS_WHERE);
  });

  it('matches nothing when the caller has no linked worker', async () => {
    const tx = fakeTx(null);
    const result = await withContext(
      { role: 'MANAGER', userId: 'u1' },
      () => resolveReadScope(tx, 'workers', 'read'),
    );
    expect(result.caller).toBeNull();
    expect(result.where).toEqual(NO_ACCESS_WHERE);
  });
});

