// ─────────────────────────────────────────────────────────────────────────────
// RBAC GUARD
// SECURITY.md §4: Default deny. Permissions model is resource:action:scope.
// Applied after JwtAuthGuard. Use @RequirePermission() on controllers.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './permission.decorator';
import { Permission } from '@ascenda/types';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<Permission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permission required, route is open post-auth (e.g. /me)
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const user = request['user'] as { permissions?: Permission[]; role?: string } | undefined;

    if (!user) {
      throw new ForbiddenException('Authenticated user required');
    }

    const hasPermission = (user.permissions ?? []).some(
      (p) =>
        p.resource === requiredPermission.resource &&
        p.action === requiredPermission.action &&
        this.scopeCoversRequired(p.scope, requiredPermission.scope),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `Permission denied: ${requiredPermission.resource}:${requiredPermission.action}`,
      );
    }

    return true;
  }

  /**
   * Higher scopes cover lower ones:
   * organisation > department > team > self
   */
  private scopeCoversRequired(
    granted: string,
    required: string,
  ): boolean {
    const hierarchy = ['self', 'team', 'department', 'location', 'organisation'];
    const grantedIdx = hierarchy.indexOf(granted);
    const requiredIdx = hierarchy.indexOf(required);
    if (grantedIdx === -1 || requiredIdx === -1) return false;
    return grantedIdx >= requiredIdx;
  }
}
