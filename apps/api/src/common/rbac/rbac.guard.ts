// ─────────────────────────────────────────────────────────────────────────────
// RBAC GUARD (global)
// Evaluates the `@RequirePermission()` metadata against the caller's role using
// the permission matrix (SECURITY.md §4). Registered after JwtAuthGuard, so
// `req.user` is guaranteed to be present for protected routes.
//
// Routes without permission metadata are reachable by any authenticated user
// (e.g. `GET /auth/me`). Data-bearing endpoints MUST declare a permission; the
// matrix itself is default-deny.
// ─────────────────────────────────────────────────────────────────────────────
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '@ascenda/types';
import { PERMISSION_KEY } from './permission.decorator';
import { roleHasPermission } from './permissions';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    const role = req.user?.role;

    if (!role || !roleHasPermission(role, required)) {
      throw new ForbiddenException(
        `Missing permission: ${required.resource}:${required.action}:${required.scope}`,
      );
    }

    return true;
  }
}
