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

// The application runs against a remote (pooled) Postgres, so a request that
// performs many sequential queries inside one RLS transaction (e.g. creating a
// leave request with its approval workflow) can legitimately exceed Prisma's
// 5s interactive-transaction default. Keep a generous, configurable budget.
const TX_MAX_WAIT_MS = Number(process.env.PRISMA_TX_MAX_WAIT_MS ?? 10_000);
const TX_TIMEOUT_MS = Number(process.env.PRISMA_TX_TIMEOUT_MS ?? 60_000);

export interface TxOptions {
  /** Override the interactive-transaction timeout for this call (ms). */
  timeoutMs?: number;
  /** Override the pool wait budget for this call (ms). */
  maxWaitMs?: number;
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
    opts?: TxOptions,
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        if (ctx.organisationId) {
          await tx.$executeRaw`SELECT set_config('app.current_org', ${ctx.organisationId}, true)`;
        }
        if (ctx.userId) {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`;
        }
        return fn(tx);
      },
      {
        maxWait: opts?.maxWaitMs ?? TX_MAX_WAIT_MS,
        timeout: opts?.timeoutMs ?? TX_TIMEOUT_MS,
      },
    );
  }

  /**
   * Convenience wrapper that pulls the tenant/user ids from the current
   * request's AsyncLocalStorage context.
   */
  async withRequestContext<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    opts?: TxOptions,
  ): Promise<T> {
    const ctx = getRequestContext();
    return this.withContext(
      { organisationId: ctx?.organisationId, userId: ctx?.userId },
      fn,
      opts,
    );
  }

  /** @deprecated Prefer `withContext`. Kept for backwards compatibility. */
  async setOrgContext(organisationId: string): Promise<void> {
    await this.$executeRaw`SELECT set_config('app.current_org', ${organisationId}, true)`;
  }
}
