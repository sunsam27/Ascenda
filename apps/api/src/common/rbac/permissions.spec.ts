import { PermissionScope, SystemRole } from '@ascenda/types';
import { getEffectiveScope, roleHasPermission } from './permissions';

describe('getEffectiveScope', () => {
  it('returns the broadest scope granted for a resource+action', () => {
    expect(
      getEffectiveScope(SystemRole.OWNER, 'workers', 'read'),
    ).toBe(PermissionScope.ORGANISATION);
    expect(
      getEffectiveScope(SystemRole.HR_ADMINISTRATOR, 'workers', 'read'),
    ).toBe(PermissionScope.ORGANISATION);
    expect(
      getEffectiveScope(SystemRole.VIEWER, 'workers', 'read'),
    ).toBe(PermissionScope.ORGANISATION);
    expect(
      getEffectiveScope(SystemRole.AUDITOR, 'workers', 'read'),
    ).toBe(PermissionScope.ORGANISATION);
    expect(
      getEffectiveScope(SystemRole.MANAGER, 'workers', 'read'),
    ).toBe(PermissionScope.TEAM);
    expect(
      getEffectiveScope(SystemRole.EMPLOYEE_SELF, 'workers', 'read'),
    ).toBe(PermissionScope.SELF);
  });

  it('returns null when the role has no matching grant', () => {
    expect(getEffectiveScope(SystemRole.MANAGER, 'workers', 'create')).toBeNull();
    expect(getEffectiveScope('UNKNOWN_ROLE', 'workers', 'read')).toBeNull();
    expect(getEffectiveScope(undefined, 'workers', 'read')).toBeNull();
  });

  it('lets a manager request their own leave without widening team scope', () => {
    // A manager files their own request (SELF) …
    expect(getEffectiveScope(SystemRole.MANAGER, 'leave', 'create')).toBe(
      PermissionScope.SELF,
    );
    // … while remaining able to approve their team (TEAM) and read it.
    expect(getEffectiveScope(SystemRole.MANAGER, 'leave', 'approve')).toBe(
      PermissionScope.TEAM,
    );
    expect(getEffectiveScope(SystemRole.MANAGER, 'leave', 'read')).toBe(
      PermissionScope.TEAM,
    );
  });

  it('lets a manager capture their team attendance (ATT-01)', () => {
    expect(getEffectiveScope(SystemRole.MANAGER, 'attendance', 'create')).toBe(
      PermissionScope.TEAM,
    );
    expect(getEffectiveScope(SystemRole.MANAGER, 'attendance', 'read')).toBe(
      PermissionScope.TEAM,
    );
  });
});

describe('getEffectiveScope agrees with the guard', () => {
  it('admits every role the TEAM threshold guard admits', () => {
    const required = {
      resource: 'workers',
      action: 'read' as const,
      scope: PermissionScope.TEAM,
    };
    for (const role of Object.values(SystemRole)) {
      if (roleHasPermission(role, required)) {
        expect(getEffectiveScope(role, 'workers', 'read')).not.toBeNull();
      }
    }
  });
});
