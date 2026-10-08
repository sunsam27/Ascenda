// ─────────────────────────────────────────────────────────────────────────────
// AUDIT INTERCEPTOR
// SECURITY.md §8: Every sensitive state change emits an audit event.
// This interceptor captures POST/PATCH/DELETE requests and records them.
// Sensitive values are masked before storage — passwords, tokens, etc.
// are never logged (enforced via MASKED_FIELDS list).
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditAction } from '@ascenda/types';

/** Fields that MUST NEVER appear in audit log values */
const MASKED_FIELDS = [
  'password',
  'passwordHash',
  'mfaSecret',
  'accessToken',
  'refreshToken',
  'accountNumber',
  'nationalId',
  'taxId',
  'token',
  'secret',
];

function maskSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = MASKED_FIELDS.some((f) =>
      key.toLowerCase().includes(f.toLowerCase()),
    );
    masked[key] = isSensitive ? '[REDACTED]' : value;
  }
  return masked;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const method = request['method'] as string;

    // Only audit state-changing requests
    const stateMutatingMethods = ['POST', 'PATCH', 'PUT', 'DELETE'];
    if (!stateMutatingMethods.includes(method)) {
      return next.handle();
    }

    const user = request['user'] as { id?: string; email?: string } | undefined;
    const orgId = request['tenantId'] as string | undefined;
    const path = request['path'] as string;
    const body = (request['body'] as Record<string, unknown> | undefined) ?? {};
    const ip = (request['ip'] as string) ?? 'unknown';
    const rawHeaders = request['headers'] as Record<string, unknown> | undefined;
    const rawUserAgent = rawHeaders?.['user-agent'];
    const userAgent = typeof rawUserAgent === 'string' ? rawUserAgent : '';

    const maskedBody = maskSensitiveFields(body);

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          if (!user?.id || !orgId) return;

          // Determine action from path + method
          const action = this.inferAction(method, path);

          this.logger.log(
            JSON.stringify({
              auditEvent: true,
              actorId: user.id,
              actorEmail: user.email ?? '',
              organisationId: orgId,
              action,
              path,
              method,
              requestBody: maskedBody,
              ipAddress: ip,
              userAgent,
              timestamp: new Date().toISOString(),
            }),
          );

          // TODO: Persist to audit_log table via AuditService
          // AuditService.record({ actorId: user.id, ... });
        },
        error: (err: unknown) => {
          this.logger.warn(
            `Audit: failed request from ${user?.email ?? 'unknown'} to ${path}: ${String(err)}`,
          );
        },
      }),
    );
  }

  private inferAction(method: string, path: string): AuditAction {
    if (path.includes('bank')) return AuditAction.BANK_DETAILS_CHANGED;
    if (path.includes('compensation')) return AuditAction.COMPENSATION_CHANGED;
    if (path.includes('payroll') && method === 'POST') return AuditAction.PAYROLL_RUN_CREATED;
    if (path.includes('export')) return AuditAction.EXPORT_CREATED;
    if (method === 'DELETE') return AuditAction.WORKER_DELETED;
    if (method === 'PATCH') return AuditAction.WORKER_UPDATED;
    return AuditAction.WORKER_CREATED;
  }
}
