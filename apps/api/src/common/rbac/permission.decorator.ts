import { SetMetadata } from '@nestjs/common';
import { Permission } from '@ascenda/types';

export const PERMISSION_KEY = 'required_permission';

/**
 * Decorator to declare the required permission for a route.
 * Used with RbacGuard.
 *
 * @example
 * @RequirePermission({ resource: 'workers', action: 'read', scope: PermissionScope.ORGANISATION })
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
