// ─────────────────────────────────────────────────────────────────────────────
// READ SCOPE
//
// RLS enforces tenant (organisation) isolation, but it does not know about the
// caller's *scope* within a tenant. Once the RBAC guard has admitted a caller
// (e.g. a MANAGER with `workers:read @ TEAM`), services narrow their queries to
// exactly the rows that scope allows via `resolveReadScope()`.
//
// `buildWorkerScopeWhere` is kept pure so the scoping rules can be unit-tested
// without a DB. `resolveReadScope` looks up the acting user's own worker record
// (by `Worker.userId`) to resolve TEAM / DEPARTMENT / LOCATION / SELF scopes.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from '@ascenda/db';
import { Permission, PermissionScope } from '@ascenda/types';
import { getRequestContext } from '../context/request-context';
import { getEffectiveScope } from './permissions';

/** The acting user's own worker record, used to resolve TEAM/DEPARTMENT/etc. */
export interface CallerWorker {
  id: string;
  departmentId: string | null;
  locationId: string | null;
}

/** Sentinel id that can never match a real worker — an empty result set. */
export const NO_ACCESS_WHERE = { id: '__ascenda_no_access__' } as const;

/**
 * Build the `where` fragment that limits workers to the caller's scope.
 *
 * - ORGANISATION → `{}` (everyone in the tenant; RLS already bounds the tenant)
 * - TEAM         → the manager plus their direct reports
 * - DEPARTMENT   → the caller's department
 * - LOCATION     → the caller's location
 * - SELF         → the caller's own record only
 *
 * When a narrower scope cannot be resolved (e.g. the caller has no linked
 * worker record) the result matches nothing, which is the safe default.
 */
export function buildWorkerScopeWhere(
  scope: PermissionScope,
  caller: CallerWorker | null,
): Prisma.WorkerWhereInput {
  switch (scope) {
    case PermissionScope.ORGANISATION:
      return {};
    case PermissionScope.TEAM:
      return caller
        ? { OR: [{ id: caller.id }, { managerId: caller.id }] }
        : { ...NO_ACCESS_WHERE };
    case PermissionScope.DEPARTMENT:
      return caller?.departmentId
        ? { departmentId: caller.departmentId }
        : { ...NO_ACCESS_WHERE };
    case PermissionScope.LOCATION:
      return caller?.locationId
        ? { locationId: caller.locationId }
        : { ...NO_ACCESS_WHERE };
    case PermissionScope.SELF:
      return caller ? { id: caller.id } : { ...NO_ACCESS_WHERE };
    default:
      return { ...NO_ACCESS_WHERE };
  }
}

/** True when the fragment restricts the result set (an empty `{}` does not). */
export function scopeWhereRestricts(where: Prisma.WorkerWhereInput): boolean {
  return Object.keys(where).length > 0;
}

export interface ReadScope {
  /** The acting user's effective scope, or null when they have no grant. */
  scope: PermissionScope | null;
  /** The acting user's linked worker record, when one exists. */
  caller: CallerWorker | null;
  /** Worker `where` fragment for this scope (empty for ORGANISATION). */
  where: Prisma.WorkerWhereInput;
}

/**
 * Resolve the caller's effective read scope for `resource` and translate it
 * into a worker `where` fragment. ORGANISATION callers see the whole tenant;
 * narrower scopes resolve the caller's own worker record first.
 */
export async function resolveReadScope(
  tx: Prisma.TransactionClient,
  resource: string,
  action: Permission['action'],
): Promise<ReadScope> {
  const ctx = getRequestContext();
  const scope = getEffectiveScope(ctx?.role, resource, action);

  if (scope === PermissionScope.ORGANISATION) {
    return { scope, caller: null, where: {} };
  }
  if (!scope) {
    return {
      scope: null,
      caller: null,
      where: buildWorkerScopeWhere(PermissionScope.SELF, null),
    };
  }

  let caller: CallerWorker | null = null;
  if (ctx?.userId) {
    caller = await tx.worker.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, departmentId: true, locationId: true },
    });
  }
  return { scope, caller, where: buildWorkerScopeWhere(scope, caller) };
}
