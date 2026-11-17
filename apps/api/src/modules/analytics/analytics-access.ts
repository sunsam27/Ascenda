import { PermissionScope } from '@ascenda/types';
import { roleHasPermission } from '../../common/rbac/permissions';

export function canReadAnalyticsPayroll(role: string): boolean {
  return (
    role !== 'SUPPORT_READ_ONLY' &&
    ['analytics', 'payroll', 'compensation', 'payslips'].every((resource) =>
      roleHasPermission(role, { resource, action: 'read', scope: PermissionScope.ORGANISATION }),
    )
  );
}

/** ANA-04 release decision: do not extend the existing export grants. */
export function canExportAnalytics(role: string): boolean {
  return (
    role === 'OWNER' &&
    roleHasPermission(role, {
      resource: 'analytics',
      action: 'export',
      scope: PermissionScope.ORGANISATION,
    })
  );
}
