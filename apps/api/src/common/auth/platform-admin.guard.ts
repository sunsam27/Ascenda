// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM ADMIN GUARD
// Restricts platform-level endpoints (reviewing/approving access requests) to
// Ascenda staff. Runs after the global JwtAuthGuard, so `req.user` is present.
// SECURITY.md §8 — every platform action is audited.
// ─────────────────────────────────────────────────────────────────────────────
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { platformAdmin?: boolean } }>();

    if (req.user?.platformAdmin !== true) {
      throw new ForbiddenException('Platform administrator access required');
    }

    return true;
  }
}
