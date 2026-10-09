// ─────────────────────────────────────────────────────────────────────────────
// PRISMA SERVICE
// Nest-managed Prisma client. Lifecycle hooks keep the connection healthy.
//
// Tenant isolation (SECURITY.md §3): the application connects as the
// non-superuser `ascenda_app` role with RLS enabled. Every query that touches
// tenant data MUST run inside `withContext()` / `withRequestContext()`, which
// opens a transaction and sets `app.current_org` (and optionally
// `app.current_user_id`) via `set_config(..., is_local => true)`. Because the
// setting is transaction-local, it is safe with connection pooling.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@ascenda/db';
import { getRequestContext } from '../context/request-context';

export interface TenantContext {
  organisationId?: string;
  userId?: string;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `fn` inside a transaction with the given RLS context applied.
   * All tenant queries MUST go through this (or `withRequestContext`).
   */
  async withContext<T>(
    ctx: TenantContext,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      if (ctx.organisationId) {
        await tx.$executeRaw`SELECT set_config('app.current_org', ${ctx.organisationId}, true)`;
      }
      if (ctx.userId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`;
      }
      return fn(tx);
    });
  }

  /**
   * Convenience wrapper that pulls the tenant/user ids from the current
   * request's AsyncLocalStorage context.
   */
  async withRequestContext<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const ctx = getRequestContext();
    return this.withContext(
      { organisationId: ctx?.organisationId, userId: ctx?.userId },
      fn,
    );
  }

  /** @deprecated Prefer `withContext`. Kept for backwards compatibility. */
  async setOrgContext(organisationId: string): Promise<void> {
    await this.$executeRaw`SELECT set_config('app.current_org', ${organisationId}, true)`;
  }
}
