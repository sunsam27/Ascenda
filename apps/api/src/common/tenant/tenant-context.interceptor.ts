// ─────────────────────────────────────────────────────────────────────────────
// TENANT CONTEXT INTERCEPTOR
// Runs after guards and before the handler, once auth has populated req.user.
// Copies the acting user + organisation into the AsyncLocalStorage store so the
// Prisma layer can apply `app.current_org` / `app.current_user_id` for RLS.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { requestContext } from '../context/request-context';

interface JwtUser {
  sub?: string;
  email?: string;
  organisationId?: string;
  role?: string;
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      user?: JwtUser;
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
    }>();

    const store = requestContext.getStore();
    const user = req.user;

    if (store) {
      store.userId = user?.sub;
      store.userEmail = user?.email;
      store.role = user?.role;
      store.organisationId =
        user?.organisationId ??
        (typeof req.headers['x-organisation-id'] === 'string'
          ? (req.headers['x-organisation-id'] as string)
          : undefined);
      store.ipAddress = store.ipAddress ?? req.ip;
      store.userAgent = store.userAgent;
    }

    return next.handle();
  }
}
