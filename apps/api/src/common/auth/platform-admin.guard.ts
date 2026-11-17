// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM ADMIN GUARD
// Restricts platform-level endpoints (reviewing/approving access requests) to
// Ascenda staff. Runs after the global JwtAuthGuard, so `req.user` is present.
// SECURITY.md §8 — every platform action is audited.
// ─────────────────────────────────────────────────────────────────────────────
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { sub?: string; platformAdmin?: boolean } }>();

    if (req.user?.platformAdmin !== true || !req.user.sub) {
      throw new ForbiddenException('Platform administrator access required');
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { isActive: true, isPlatformAdmin: true },
    });
    if (!actor?.isActive || !actor.isPlatformAdmin)
      throw new ForbiddenException('Platform administrator access required');

    return true;
  }
}
