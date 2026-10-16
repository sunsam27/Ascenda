// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION MATRIX
// Source of truth for what each system role may do (SECURITY.md §4).
//
// Model: `resource` + `action` + `scope`. Default is DENY — a role only has the
// permissions listed here. Scope ordering runs self < team < department <
// location < organisation, so an ORGANISATION grant satisfies a SELF request.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Permission,
  PermissionScope,
  SystemRole,
} from '@ascenda/types';

type Action = Permission['action'];

const ALL_ACTIONS: Action[] = [
  'read',
  'create',
  'update',
  'delete',
  'approve',
  'export',
];

function perm(
  resource: string,
  actions: Action[],
  scope: PermissionScope,
): Permission[] {
  return actions.map((action) => ({ resource, action, scope }));
}

const READ = ['read'] as Action[];
const CRUD = ['read', 'create', 'update', 'delete'] as Action[];

const BUSINESS_RESOURCES = [
  'organisations',
  'memberships',
  'workers',
  'departments',
  'locations',
  'leave',
  'attendance',
  'holidays',
  'blackout_periods',
  'compensation',
  'bank_accounts',
  'payroll',
  'payments',
  'documents',
  'approvals',
  'analytics',
  'settings',
  'audit_logs',
];

const PERMISSIONS_BY_ROLE: Record<SystemRole, Permission[]> = {
  [SystemRole.OWNER]: [
    ...BUSINESS_RESOURCES.flatMap((r) =>
      perm(r, ALL_ACTIONS, PermissionScope.ORGANISATION),
    ),
  ],

  [SystemRole.HR_ADMINISTRATOR]: [
    ...perm('workers', CRUD, PermissionScope.ORGANISATION),
    ...perm('departments', CRUD, PermissionScope.ORGANISATION),
    ...perm('locations', CRUD, PermissionScope.ORGANISATION),
    ...perm('leave', ['read', 'create', 'update', 'approve'], PermissionScope.ORGANISATION),
    ...perm('attendance', CRUD, PermissionScope.ORGANISATION),
    ...perm('holidays', CRUD, PermissionScope.ORGANISATION),
    ...perm('blackout_periods', CRUD, PermissionScope.ORGANISATION),
    ...perm('compensation', READ, PermissionScope.ORGANISATION),
    ...perm('analytics', READ, PermissionScope.ORGANISATION),
  ],

  [SystemRole.PAYROLL_ADMINISTRATOR]: [
    ...perm('payroll', ['read', 'create', 'update'], PermissionScope.ORGANISATION),
    ...perm('payments', ['read', 'create', 'update'], PermissionScope.ORGANISATION),
    ...perm('compensation', CRUD, PermissionScope.ORGANISATION),
    ...perm('bank_accounts', READ, PermissionScope.ORGANISATION),
    ...perm('analytics', READ, PermissionScope.ORGANISATION),
  ],

  [SystemRole.FINANCE_APPROVER]: [
    ...perm('payroll', ['read', 'approve', 'export'], PermissionScope.ORGANISATION),
    ...perm('payments', ['read', 'approve', 'export'], PermissionScope.ORGANISATION),
    ...perm('compensation', READ, PermissionScope.ORGANISATION),
    ...perm('analytics', READ, PermissionScope.ORGANISATION),
  ],

  [SystemRole.MANAGER]: [
    ...perm('workers', READ, PermissionScope.TEAM),
    ...perm('leave', ['read', 'approve'], PermissionScope.TEAM),
    // A manager may also request leave for *themselves* (SELF), which still
    // routes through their own manager / HR approval chain.
    ...perm('leave', ['create'], PermissionScope.SELF),
    ...perm('attendance', READ, PermissionScope.TEAM),
    // Managers capture their team's attendance (ATT-01: "manual entry by
    // manager / HR") and clock in/out for themselves.
    ...perm('attendance', ['create'], PermissionScope.TEAM),
    ...perm('holidays', READ, PermissionScope.ORGANISATION),
    ...perm('blackout_periods', READ, PermissionScope.ORGANISATION),
    ...perm('analytics', READ, PermissionScope.TEAM),
  ],

  [SystemRole.EMPLOYEE_SELF]: [
    ...perm('workers', READ, PermissionScope.SELF),
    ...perm('leave', ['read', 'create'], PermissionScope.SELF),
    ...perm('attendance', ['read', 'create'], PermissionScope.SELF),
    ...perm('holidays', READ, PermissionScope.ORGANISATION),
    ...perm('blackout_periods', READ, PermissionScope.ORGANISATION),
    ...perm('documents', READ, PermissionScope.SELF),
  ],

  [SystemRole.VOLUNTEER_SELF]: [
    ...perm('workers', READ, PermissionScope.SELF),
    ...perm('leave', ['read', 'create'], PermissionScope.SELF),
    ...perm('attendance', ['read', 'create'], PermissionScope.SELF),
    ...perm('holidays', READ, PermissionScope.ORGANISATION),
    ...perm('blackout_periods', READ, PermissionScope.ORGANISATION),
    ...perm('documents', READ, PermissionScope.SELF),
  ],

  [SystemRole.AUDITOR]: [
    ...BUSINESS_RESOURCES.flatMap((r) => perm(r, READ, PermissionScope.ORGANISATION)),
    ...perm('audit_logs', ['read', 'export'], PermissionScope.ORGANISATION),
  ],

  [SystemRole.VIEWER]: [
    ...perm('organisations', READ, PermissionScope.ORGANISATION),
    ...perm('workers', READ, PermissionScope.ORGANISATION),
    ...perm('departments', READ, PermissionScope.ORGANISATION),
    ...perm('locations', READ, PermissionScope.ORGANISATION),
    ...perm('leave', READ, PermissionScope.ORGANISATION),
    ...perm('holidays', READ, PermissionScope.ORGANISATION),
    ...perm('blackout_periods', READ, PermissionScope.ORGANISATION),
    ...perm('payroll', READ, PermissionScope.ORGANISATION),
    ...perm('analytics', READ, PermissionScope.ORGANISATION),
  ],

  [SystemRole.SUPPORT_READ_ONLY]: [
    ...BUSINESS_RESOURCES.flatMap((r) => perm(r, READ, PermissionScope.ORGANISATION)),
    ...perm('audit_logs', READ, PermissionScope.ORGANISATION),
  ],
};

const SCOPE_RANK: Record<PermissionScope, number> = {
  [PermissionScope.SELF]: 1,
  [PermissionScope.TEAM]: 2,
  [PermissionScope.DEPARTMENT]: 3,
  [PermissionScope.LOCATION]: 4,
  [PermissionScope.ORGANISATION]: 5,
};

export function getPermissionsForRole(role: string): Permission[] {
  return PERMISSIONS_BY_ROLE[role as SystemRole] ?? [];
}

/** True when `granted` scope is at least as broad as `required`. */
export function scopeSatisfies(
  granted: PermissionScope,
  required: PermissionScope,
): boolean {
  return (SCOPE_RANK[granted] ?? 0) >= (SCOPE_RANK[required] ?? 6);
}

export function roleHasPermission(
  role: string,
  required: Permission,
): boolean {
  return getPermissionsForRole(role).some(
    (p) =>
      p.resource === required.resource &&
      p.action === required.action &&
      scopeSatisfies(p.scope, required.scope),
  );
}

/**
 * The broadest scope a role has been granted for a resource+action, or null
 * when the role has no such grant. Services use this to decide *how much* data
 * to return once the guard has admitted the caller.
 */
export function getEffectiveScope(
  role: string | undefined,
  resource: string,
  action: Action,
): PermissionScope | null {
  if (!role) return null;
  const matches = getPermissionsForRole(role).filter(
    (p) => p.resource === resource && p.action === action,
  );
  if (matches.length === 0) return null;
  return matches.reduce<PermissionScope>(
    (best, p) => (SCOPE_RANK[p.scope] > SCOPE_RANK[best] ? p.scope : best),
    matches[0]!.scope,
  );
}
