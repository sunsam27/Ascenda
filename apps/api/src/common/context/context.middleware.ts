// ─────────────────────────────────────────────────────────────────────────────
// REQUEST CONTEXT MIDDLEWARE
// Opens an AsyncLocalStorage scope for every request. Runs first, so guards,
// interceptors and handlers all see the same mutable store. Later stages
// (TenantContextInterceptor) fill in identity/tenant once auth has run.
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { requestContext } from './request-context';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const store = {
      requestId: randomUUID(),
      ipAddress: req.ip ?? undefined,
      userAgent: req.headers['user-agent'] ?? undefined,
    };
    requestContext.run(store, () => next());
  }
}
