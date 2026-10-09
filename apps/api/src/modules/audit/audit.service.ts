// ─────────────────────────────────────────────────────────────────────────────
// AUDIT SERVICE
// Append-only audit trail (SECURITY.md §8). Writes run inside a tenant-scoped
// transaction so the RLS WITH CHECK on `audit_log.organisationId` is satisfied.
// The app role has UPDATE/DELETE revoked on audit_log, so entries are immutable.
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditLog, Prisma } from '@ascenda/db';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';

export interface AuditEntry {
  action: AuditAction;
  organisationId?: string;
  actorId?: string;
  actorEmail?: string;
  targetType?: string;
  targetId?: string;
  /** Sensitive values MUST already be masked before they reach here. */
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
}

function toJson(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const ctx = getRequestContext();
    const organisationId = entry.organisationId ?? ctx?.organisationId;
    const actorId = entry.actorId ?? ctx?.userId;

    if (!organisationId || !actorId) {
      this.logger.warn(
        `Audit entry skipped (no tenant/actor context): ${entry.action}`,
      );
      return;
    }

    try {
      await this.prisma.withContext({ organisationId, userId: actorId }, (tx) =>
        tx.auditLog.create({
          data: {
            organisationId,
            actorId,
            actorEmail: entry.actorEmail ?? ctx?.userEmail ?? '',
            action: entry.action,
            targetType: entry.targetType ?? '',
            targetId: entry.targetId ?? '',
            previousValue: toJson(entry.previousValue),
            newValue: toJson(entry.newValue),
            ipAddress: entry.ipAddress ?? ctx?.ipAddress ?? '',
            userAgent: entry.userAgent ?? ctx?.userAgent ?? '',
          },
        }),
      );
    } catch (error) {
      // Audit failures must never break the request, but must be visible.
      this.logger.error(
        `Failed to write audit log for ${entry.action}: ${
          (error as Error).message
        }`,
      );
    }
  }

  /** Read the tenant's audit trail (RLS scopes this to the active org). */
  async findAll(limit = 50): Promise<AuditLog[]> {
    const take = Math.min(Math.max(limit, 1), 200);
    return this.prisma.withRequestContext((tx) =>
      tx.auditLog.findMany({
        orderBy: { timestamp: 'desc' },
        take,
      }),
    );
  }
}
