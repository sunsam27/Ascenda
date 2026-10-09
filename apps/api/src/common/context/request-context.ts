// ─────────────────────────────────────────────────────────────────────────────
// REQUEST CONTEXT
// Per-request, async-safe storage carried through the whole call stack via
// AsyncLocalStorage. This is how downstream services (and PrismaService) learn
// *who* is acting and *which organisation* they are acting in, without threading
// it through every function signature.
//
// SECURITY.md §3: the organisation id set here is what ultimately drives
// PostgreSQL RLS via `set_config('app.current_org', …)`.
// ─────────────────────────────────────────────────────────────────────────────
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId?: string;
  userId?: string;
  userEmail?: string;
  organisationId?: string;
  role?: string;
  ipAddress?: string;
  userAgent?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}
