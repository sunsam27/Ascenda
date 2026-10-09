// ─────────────────────────────────────────────────────────────────────────────
// AUDIT INTERCEPTOR
// SECURITY.md §8: sensitive state changes emit an audit event. Captures
// POST/PATCH/PUT/DELETE requests, masks sensitive fields, and delegates the
// write to AuditService. Auth events (login/logout/failures) are recorded
// explicitly by IdentityAccessService, so they are skipped here.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditAction } from '@ascenda/db';
import { AuditService } from '../../modules/audit/audit.service';

/** Fields that MUST NEVER appear in audit log values */
const MASKED_FIELDS = [
  'password',
  'passwordhash',
  'mfasecret',
  'accesstoken',
  'refreshtoken',
  'accountnumber',
  'nationalid',
  'taxid',
  'token',
  'secret',
];

function maskSensitiveFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = MASKED_FIELDS.some((f) =>
      key.toLowerCase().includes(f),
    );
    masked[key] = isSensitive ? '[REDACTED]' : value;
  }
  return masked;
}

/** Map a state-changing route to an AuditAction, or undefined to skip. */
function resolveAction(method: string, path: string): AuditAction | undefined {
  const segment = path.split('/').filter(Boolean)[1] ?? '';
  switch (segment) {
    case 'people':
    case 'workers':
      if (method === 'POST') return AuditAction.WORKER_CREATED;
      if (method === 'PATCH' || method === 'PUT') return AuditAction.WORKER_UPDATED;
      if (method === 'DELETE') return AuditAction.WORKER_DELETED;
      return undefined;
    case 'payroll':
      if (method === 'POST') return AuditAction.PAYROLL_RUN_CREATED;
      return undefined;
    default:
      return undefined;
  }
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      path: string;
      url: string;
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    }>();

    const method = request.method;
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const path = request.path ?? request.url ?? '';
    // Auth events are recorded by the service; public signup/billing routes have
    // no tenant context yet.
    if (
      path.includes('/auth/') ||
      path.includes('/signups') ||
      path.includes('/billing')
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          const action = resolveAction(method, path);
          if (!action) return;
          const segment = path.split('/').filter(Boolean)[1] ?? '';
          void this.audit.record({
            action,
            targetType: segment,
            targetId: request.params?.['id'] ?? '',
            newValue: request.body
              ? maskSensitiveFields(request.body)
              : undefined,
          });
        },
      }),
    );
  }
}
