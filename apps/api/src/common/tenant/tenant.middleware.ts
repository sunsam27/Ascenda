// ─────────────────────────────────────────────────────────────────────────────
// TENANT MIDDLEWARE
// SECURITY.md §3: Sets `app.current_org` on the DB transaction so PostgreSQL
// RLS policies can filter by organisation_id. Every request goes through this.
// The app MUST NOT query without this being set first.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    // Organisation ID comes from the validated JWT (set by JwtStrategy)
    // Falls back to X-Organisation-Id header only for the login flow
    const rawHeader = req.headers['x-organisation-id'];
    const headerOrgId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const orgId =
      ((req as unknown as Record<string, unknown>)['organisationId'] as string | undefined) ||
      headerOrgId;

    // Nest mounts middleware under the global prefix, so req.path is
    // prefix-relative (e.g. `/auth/login`). Match against both the full
    // original URL and the prefix-relative path.
    const fullPath = req.originalUrl.split('?')[0] ?? '';
    if (!orgId && !this.isPublicRoute(fullPath, req.path)) {
      throw new UnauthorizedException('Organisation context required');
    }

    // Attach to request for downstream use
    (req as unknown as Record<string, unknown>)['tenantId'] = orgId;

    // Note: setting `app.current_org` on the Prisma connection happens in
    // the PrismaService.setOrgContext() method, called from each service
    // using the `tenantId` from the request context.

    next();
  }

  private isPublicRoute(fullPath: string, pathWithinPrefix: string): boolean {
    const publicPaths = [
      '/auth/login',
      '/auth/register',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/refresh',
      '/auth/health',
      '/health',
      '/docs',
    ];
    const candidates = [
      fullPath,
      pathWithinPrefix,
      // Also match when the global prefix is present in the path
      fullPath.replace(/^\/api\/v1/, ''),
    ];
    return publicPaths.some((p) =>
      candidates.some((c) => c === p || c.startsWith(`${p}/`)),
    );
  }
}
