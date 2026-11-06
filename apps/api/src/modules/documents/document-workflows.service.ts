import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuditAction, NotificationType, Prisma } from '@ascenda/db';
import { getRequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DocumentAudienceDto, PublishAnnouncementDto, UpdateDocumentDto } from './dto/document-workflows.dto';

@Injectable()
export class DocumentWorkflowsService {
  private readonly logger = new Logger(DocumentWorkflowsService.name);
  private readonly delivering = new Set<string>();
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly notifications: NotificationsService, private readonly storage: StorageService) {}

  private context() {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) throw new UnauthorizedException('No active organisation');
    return { organisationId: ctx.organisationId, userId: ctx.userId, role: ctx.role };
  }

  private async audience(tx: Prisma.TransactionClient, input: DocumentAudienceDto): Promise<string[]> {
    const { organisationId } = this.context();
    if (input.departmentId && !await tx.department.findFirst({ where: { id: input.departmentId, organisationId }, select: { id: true } })) {
      throw new NotFoundException('Department not found');
    }
    if (input.locationId && !await tx.location.findFirst({ where: { id: input.locationId, organisationId }, select: { id: true } })) {
      throw new NotFoundException('Location not found');
    }
    let userIds: string[] | undefined;
    if (input.departmentId || input.locationId || input.category) {
      const workers = await tx.worker.findMany({ where: { organisationId, status: 'ACTIVE',
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.category ? { category: input.category } : {}), userId: { not: null } }, select: { userId: true } });
      userIds = workers.flatMap((w) => w.userId ? [w.userId] : []);
    }
    const members = await tx.membership.findMany({ where: { organisationId, isActive: true,
      user: { isActive: true }, ...(userIds ? { userId: { in: userIds } } : {}) }, select: { userId: true } });
    if (!members.length) throw new BadRequestException('No active users match this audience. Invite workers to the workspace first.');
    return [...new Set(members.map((m) => m.userId))];
  }

  async publishPolicy(id: string, input: DocumentAudienceDto) {
    const { organisationId } = this.context();
    const result = await this.prisma.withRequestContext(async (tx) => {
      const document = await tx.document.findFirst({ where: { id, organisationId, deletedAt: null, type: 'POLICY' } });
      if (!document) throw new NotFoundException('Policy document not found');
      if (document.workerId) throw new BadRequestException('Publish an unlinked policy document, not a private worker file.');
      if (document.expiresAt && document.expiresAt <= new Date()) throw new BadRequestException('An expired policy cannot be published.');
      const users = await this.audience(tx, input);
      const claimed = await tx.document.updateMany({ where: { id, policyPublishedAt: null, deletedAt: null }, data: { policyPublishedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('This policy has already been published. Upload a new version to publish changes.');
      await tx.policyRecipient.createMany({ data: users.map((userId) => ({ organisationId, documentId: id, userId })) });
      return { id, recipientCount: users.length };
    });
    await this.audit.record({ action: AuditAction.POLICY_PUBLISHED, targetType: 'document', targetId: id, newValue: { recipientCount: result.recipientCount } });
    // Delivery is handled by the durable recipient outbox, including on failures.
    await this.deliverPending().catch(() => this.logger.warn('Policy notifications queued for retry'));
    return result;
  }

  async acknowledge(id: string) {
    const { organisationId, userId } = this.context();
    const acknowledgedAt = await this.prisma.withRequestContext(async (tx) => {
      const record = await tx.policyRecipient.findFirst({ where: { organisationId, userId, documentId: id,
        document: { deletedAt: null, policyPublishedAt: { not: null } } } });
      if (!record) throw new NotFoundException('Policy not found or not assigned to you');
      if (record.acknowledgedAt) return record.acknowledgedAt;
      const now = new Date();
      await tx.policyRecipient.updateMany({ where: { id: record.id, acknowledgedAt: null }, data: { acknowledgedAt: now } });
      return now;
    });
    await this.audit.record({ action: AuditAction.POLICY_ACKNOWLEDGED, targetType: 'document', targetId: id });
    return { acknowledgedAt: acknowledgedAt.toISOString() };
  }

  async policyReport(id: string) {
    const { organisationId } = this.context();
    return this.prisma.withRequestContext(async (tx) => {
      if (!await tx.document.findFirst({ where: { id, organisationId, type: 'POLICY', deletedAt: null } })) throw new NotFoundException('Policy not found');
      const recipients = await tx.policyRecipient.findMany({ where: { documentId: id, organisationId }, orderBy: { createdAt: 'asc' } });
      const members = await tx.membership.findMany({ where: { organisationId, userId: { in: recipients.map((r) => r.userId) } },
        select: { userId: true, user: { select: { firstName: true, lastName: true } } } });
      const names = new Map(members.map((m) => [m.userId, `${m.user.firstName} ${m.user.lastName}`.trim()]));
      return recipients.map((r) => ({ userId: r.userId, name: names.get(r.userId) || 'Former member', acknowledgedAt: r.acknowledgedAt?.toISOString() }));
    });
  }

  async updateDocument(id: string, dto: UpdateDocumentDto) {
    const { organisationId, role } = this.context();
    await this.prisma.withRequestContext(async (tx) => {
      const row = await tx.document.findFirst({ where: { id, organisationId, deletedAt: null,
        ...(role === 'HR_ADMINISTRATOR' ? { type: { not: 'PAYSLIP' } } : {}) } });
      if (!row) throw new NotFoundException('Document not found');
      if (row.policyPublishedAt) throw new ConflictException('Published policies are immutable. Upload a new version instead.');
      if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('Enter a document name');
      const updated = await tx.document.updateMany({ where: { id, organisationId, deletedAt: null, policyPublishedAt: null }, data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null, expiryRemindedAt: null } : {}),
      } });
      if (updated.count !== 1) throw new ConflictException('This document changed. Refresh and try again.');
    });
    await this.audit.record({ action: AuditAction.DOCUMENT_UPDATED, targetType: 'document', targetId: id,
      newValue: { expiresAt: dto.expiresAt, renamed: dto.name !== undefined } });
    return { id };
  }

  async publishAnnouncement(dto: PublishAnnouncementDto) {
    const { organisationId, userId } = this.context();
    if (!dto.title.trim() || !dto.body.trim()) throw new BadRequestException('Enter an announcement title and message');
    const result = await this.prisma.withRequestContext(async (tx) => {
      const users = await this.audience(tx, dto);
      const audience = { departmentId: dto.departmentId, locationId: dto.locationId, category: dto.category };
      const row = await tx.announcement.create({ data: { organisationId, title: dto.title.trim(), body: dto.body.trim(),
        audience: audience as Prisma.InputJsonValue, createdBy: userId,
        recipients: { create: users.map((recipient) => ({ organisationId, userId: recipient })) } } });
      return { id: row.id, recipientCount: users.length };
    });
    await this.audit.record({ action: AuditAction.ANNOUNCEMENT_PUBLISHED, targetType: 'announcement', targetId: result.id,
      newValue: { recipientCount: result.recipientCount } });
    await this.deliverPending().catch(() => this.logger.warn('Announcement notifications queued for retry'));
    return result;
  }

  async announcements(page = 1) {
    const { organisationId, userId, role } = this.context();
    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.AnnouncementWhereInput = { organisationId,
        ...(['OWNER', 'HR_ADMINISTRATOR'].includes(role ?? '') ? {} : { recipients: { some: { userId } } }) };
      const [rows, total] = await Promise.all([
        tx.announcement.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 25, take: 25 }),
        tx.announcement.count({ where }),
      ]);
      return { data: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, createdAt: r.createdAt.toISOString() })),
        meta: { page, pageSize: 25, total, totalPages: Math.ceil(total / 25) } };
    });
  }

  /** Tenant-scoped durable notification outbox. At-least-once delivery. */
  async deliverPending() {
    const { organisationId, userId } = this.context();
    if (this.delivering.has(organisationId)) return;
    this.delivering.add(organisationId);
    try {
    const [policies, announcements] = await this.prisma.withRequestContext(async (tx) => Promise.all([
      tx.policyRecipient.findMany({ where: { organisationId, notifiedAt: null, document: { deletedAt: null } }, take: 100 }),
      tx.announcementRecipient.findMany({ where: { organisationId, notifiedAt: null }, include: { announcement: true }, take: 100 }),
    ]));
    for (const recipient of [...policies, ...announcements]) {
      const announcement = 'announcement' in recipient ? recipient.announcement : undefined;
      // Never notify inactive/removed members from a historical recipient snapshot.
      const active = await this.prisma.withRequestContext((tx) => tx.membership.findFirst({
        where: { organisationId, userId: recipient.userId, isActive: true, user: { isActive: true } }, select: { id: true } }));
      if (active) await this.notifications.emit({ organisationId, actorUserId: userId, intents: [{ recipientUserId: recipient.userId,
        type: announcement ? NotificationType.ANNOUNCEMENT_AVAILABLE : NotificationType.POLICY_AVAILABLE,
        title: announcement ? announcement.title : 'A policy needs your acknowledgement',
        body: announcement ? announcement.body : 'Open Documents to read and acknowledge your assigned policy.',
        link: '/documents', metadata: { sourceId: recipient.id },
      }] });
      await this.prisma.withRequestContext(async (tx) => {
        if (announcement) await tx.announcementRecipient.update({ where: { id: recipient.id }, data: { notifiedAt: new Date() } });
        else await tx.policyRecipient.update({ where: { id: recipient.id }, data: { notifiedAt: new Date() } });
      });
    }
    } finally { this.delivering.delete(organisationId); }
  }

  async maintenance() {
    const { organisationId, userId } = this.context();
    await this.deliverPending();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const soon = new Date(now.getTime() + 30 * 86_400_000);
    const [deleted, expiring, policies] = await this.prisma.withRequestContext(async (tx) => Promise.all([
      tx.document.findMany({ where: { organisationId, deletedAt: { not: null } }, take: 100 }),
      tx.document.findMany({ where: { organisationId, deletedAt: null, expiresAt: { lte: soon }, expiryRemindedAt: null }, take: 100 }),
      tx.policyRecipient.findMany({ where: { organisationId, acknowledgedAt: null, createdAt: { lte: sevenDaysAgo },
        OR: [{ remindedAt: null }, { remindedAt: { lte: sevenDaysAgo } }], document: { deletedAt: null } }, take: 100 }),
    ]));
    for (const row of deleted) {
      try {
        await this.storage.delete(row.storageKey);
        await this.prisma.withRequestContext((tx) => tx.document.delete({ where: { id: row.id } }));
      } catch { this.logger.error(`Document ${row.id} cleanup retry failed`); }
    }
    for (const row of expiring) {
      const members = await this.prisma.withRequestContext(async (tx) => {
        const worker = row.workerId ? await tx.worker.findFirst({ where: { id: row.workerId }, select: { userId: true } }) : null;
        return tx.membership.findMany({ where: { organisationId, isActive: true, user: { isActive: true },
          OR: [{ role: 'OWNER' }, ...(row.type === 'PAYSLIP' ? [] : [{ role: 'HR_ADMINISTRATOR' as const }]),
            ...(worker?.userId ? [{ userId: worker.userId }] : [])] }, select: { userId: true } });
      });
      await this.notifications.emit({ organisationId, actorUserId: userId, intents: members.map((m) => ({ recipientUserId: m.userId,
        type: NotificationType.DOCUMENT_EXPIRING, title: 'Document expiry review required',
        body: 'A document is expired or expires within 30 days. Review expiry dates in Documents.', link: '/documents' })) });
      await this.prisma.withRequestContext((tx) => tx.document.update({ where: { id: row.id }, data: { expiryRemindedAt: now } }));
    }
    for (const row of policies) {
      const member = await this.prisma.withRequestContext((tx) => tx.membership.findFirst({ where: { organisationId, userId: row.userId, isActive: true, user: { isActive: true } } }));
      if (member) await this.notifications.emit({ organisationId, actorUserId: userId, intents: [{ recipientUserId: row.userId,
        type: NotificationType.POLICY_REMINDER, title: 'Policy acknowledgement reminder',
        body: 'You have a policy awaiting acknowledgement. Please read it in Documents.', link: '/documents' }] });
      await this.prisma.withRequestContext((tx) => tx.policyRecipient.update({ where: { id: row.id }, data: { remindedAt: now } }));
    }
    return { cleanupChecked: deleted.length, expiryChecked: expiring.length, remindersChecked: policies.length };
  }
}
