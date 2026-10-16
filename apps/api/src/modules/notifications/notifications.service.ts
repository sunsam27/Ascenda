// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS SERVICE
// Per-recipient in-app notifications (the app-shell bell) plus best-effort email.
// Every write runs inside a tenant-scoped transaction (RLS on `organisationId`);
// reads are additionally filtered to the signed-in user by `recipientUserId`.
//
// `emit()` is the single write entry point, used by the leave-workflow domain
// and by the scheduler. Recipients are platform users, not workers.
// ─────────────────────────────────────────────────────────────────────────────
import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Prisma } from '@ascenda/db';
import type {
  Notification,
  NotificationListResponse,
  PaginationMeta,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { MailerService } from '../../common/mailer/mailer.service';
import { ListNotificationsQueryDto } from './dto/list-notifications.dto';

/** One intended notification before it is persisted. */
export interface NotificationIntent {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Relative in-app link (e.g. /time-leave). */
  link?: string;
  /** Small structured payload for future deep-linking (never secrets). */
  metadata?: Record<string, unknown>;
  /** Set false to skip the email for this recipient (in-app row is still written). */
  email?: boolean;
}

type NotificationRow = {
  id: string;
  organisationId: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  metadata: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
};

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    organisationId: row.organisationId,
    recipientUserId: row.recipientUserId,
    type: row.type as unknown as Notification['type'],
    title: row.title,
    body: row.body,
    link: row.link,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Persist and (optionally) email notifications for one organisation. Duplicate
   * recipients within a single call are collapsed to one notification.
   * Vanishes safely: a mail failure never throws back to the caller.
   */
  async emit(input: {
    organisationId: string;
    actorUserId?: string;
    intents: NotificationIntent[];
  }): Promise<number> {
    if (input.intents.length === 0) return 0;

    const byRecipient = new Map<string, NotificationIntent>();
    for (const intent of input.intents) {
      if (intent.recipientUserId) byRecipient.set(intent.recipientUserId, intent);
    }
    const intents = [...byRecipient.values()];
    if (intents.length === 0) return 0;

    const created = await this.prisma.withContext(
      { organisationId: input.organisationId, userId: input.actorUserId },
      (tx) =>
        tx.notification.createMany({
          data: intents.map((intent) => ({
            organisationId: input.organisationId,
            recipientUserId: intent.recipientUserId,
            type: intent.type,
            title: intent.title,
            body: intent.body,
            link: intent.link ?? null,
            metadata: (intent.metadata as Prisma.InputJsonValue) ?? undefined,
          })),
        }),
    );

    await this.sendEmails(input.organisationId, intents);
    return created.count;
  }

  private async sendEmails(
    organisationId: string,
    intents: NotificationIntent[],
  ): Promise<void> {
    const toEmail = intents.filter((i) => i.email !== false);
    if (toEmail.length === 0) return;

    try {
      const recipients = await this.prisma.withContext(
        { organisationId },
        (tx) =>
          tx.user.findMany({
            where: { id: { in: toEmail.map((i) => i.recipientUserId) } },
            select: { id: true, email: true, firstName: true, lastName: true },
          }),
      );
      const byId = new Map(recipients.map((u) => [u.id, u]));
      const appUrl = this.config.get<string>('WEB_APP_URL') ?? '';
      for (const intent of toEmail) {
        const user = byId.get(intent.recipientUserId);
        if (!user?.email) continue;
        await this.mailer.sendNotification({
          to: user.email,
          name: `${user.firstName} ${user.lastName}`.trim(),
          title: intent.title,
          body: intent.body,
          link: intent.link,
          appUrl,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to send notification email(s): ${(error as Error).message}`,
      );
    }
  }

  /** The signed-in user's notifications for the active organisation. */
  async list(query: ListNotificationsQueryDto): Promise<NotificationListResponse> {
    const { userId } = this.requireContext();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.NotificationWhereInput = { recipientUserId: userId };
      if (query.unreadOnly) where.readAt = null;

      const [rows, total, unread] = await Promise.all([
        tx.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.notification.count({ where }),
        tx.notification.count({ where: { recipientUserId: userId, readAt: null } }),
      ]);

      const meta: PaginationMeta = {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
      return { data: (rows as NotificationRow[]).map(toNotification), unread, meta };
    });
  }

  /** Count of unread notifications for the signed-in user. */
  async unreadCount(): Promise<{ unread: number }> {
    const { organisationId, userId } = this.requireContext();
    const unread = await this.prisma.withContext({ organisationId }, (tx) =>
      tx.notification.count({ where: { recipientUserId: userId, readAt: null } }),
    );
    return { unread };
  }

  /** Mark a single notification read (only if it belongs to the caller). */
  async markRead(id: string): Promise<Notification> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const row = await tx.notification.findFirst({
        where: { id, recipientUserId: userId },
      });
      if (!row) throw new NotFoundException('Notification not found');
      const updated = row.readAt
        ? row
        : await tx.notification.update({
            where: { id },
            data: { readAt: new Date() },
          });
      return toNotification(updated);
    });
  }

  /** Mark every unread notification read for the caller. */
  async markAllRead(): Promise<{ updated: number }> {
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      const result = await tx.notification.updateMany({
        where: { recipientUserId: userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    });
  }

  /** Mark a specific set of the caller's notifications read. */
  async markManyRead(ids: string[]): Promise<{ updated: number }> {
    const { userId } = this.requireContext();
    if (ids.length === 0) return { updated: 0 };
    return this.prisma.withRequestContext(async (tx) => {
      const result = await tx.notification.updateMany({
        where: { id: { in: ids }, recipientUserId: userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    });
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
