import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@ascenda/db';

/**
 * Privileged Prisma client bound to `DIRECT_URL` (the database owner role).
 *
 * The owner role bypasses row-level security, so this client is the only way the
 * process can enumerate tenants outside a request context — which the scheduler
 * needs in order to discover which organisations to process. The request-scoped
 * `PrismaService` (role `ascenda_app`) deliberately cannot do this.
 *
 * Scope: use ONLY for cross-tenant orchestration (listing org ids / picking an
 * actor). Never read tenant row data through this client and never hand its
 * results to a user; per-tenant work then runs through the normal services so
 * RLS, auditing and notifications all apply.
 */
@Injectable()
export class SystemPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SystemPrismaService.name);

  constructor() {
    super({
      datasources: {
        db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('System Prisma connected (privileged)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
