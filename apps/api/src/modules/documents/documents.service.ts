import {
  BadRequestException,
  Injectable,
  Logger,
  ConflictException,
  ServiceUnavailableException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@ascenda/db';
import {
  PermissionScope,
  type DocumentSummary,
  type PaginationMeta,
} from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { getRequestContext } from '../../common/context/request-context';
import { getEffectiveScope } from '../../common/rbac/permissions';
import { AuditService } from '../audit/audit.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents.dto';
import { UploadSafetyService } from '../../common/storage/upload-safety.service';

/** Upper bound on a single upload after base64 decoding. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

/** Sentinel id that can never match — the safe default for an empty scope. */
export const NO_ACCESS_DOCUMENT_WHERE = {
  id: '__ascenda_no_access__',
} as const;

/** Decode a base64 upload, rejecting empty or oversized payloads. */
export function decodeBase64Content(
  content: string,
  maxBytes: number = MAX_UPLOAD_BYTES,
): Buffer {
  const comma = content.indexOf(',');
  const cleaned = comma >= 0 ? content.slice(comma + 1) : content;
  if (cleaned.length > 4 * Math.ceil(maxBytes / 3)) {
    throw new BadRequestException(`Files must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`);
  }
  if (cleaned.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(cleaned)) {
    throw new BadRequestException('Invalid base64 file content');
  }
  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.toString('base64') !== cleaned) throw new BadRequestException('Invalid base64 file content');
  if (buffer.length === 0) {
    throw new BadRequestException('The uploaded file is empty');
  }
  if (buffer.length > maxBytes) {
    throw new BadRequestException(
      `Files must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller`,
    );
  }
  return buffer;
}

const DOCUMENT_INCLUDE = {
  worker: {
    select: { firstName: true, lastName: true, preferredName: true },
  },
  policyRecipients: { select: { userId: true, acknowledgedAt: true } },
} satisfies Prisma.DocumentInclude;

type DocumentRow = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_INCLUDE;
}>;

/** Metadata-only view — the raw storage key is never exposed. */
export function toDocumentSummary(row: DocumentRow): DocumentSummary {
  const worker = row.worker;
  const workerName = worker
    ? worker.preferredName?.trim() ||
      `${worker.firstName} ${worker.lastName}`.trim()
    : undefined;
  return {
    id: row.id,
    organisationId: row.organisationId,
    workerId: row.workerId ?? undefined,
    workerName: workerName || undefined,
    type: row.type as unknown as DocumentSummary['type'],
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    expiresAt: row.expiresAt?.toISOString(),
    policyPublishedAt: row.policyPublishedAt?.toISOString(),
    acknowledgementRequired: row.policyRecipients?.some((r) => r.userId === getRequestContext()?.userId),
    acknowledgedAt: row.policyRecipients?.find((r) => r.userId === getRequestContext()?.userId)?.acknowledgedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    downloadUrl: `/api/v1/documents/${row.id}/download`,
  };
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly safety: UploadSafetyService,
  ) {}

  async list(
    query: ListDocumentsQueryDto,
  ): Promise<{ data: DocumentSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    return this.prisma.withRequestContext(async (tx) => {
      const where: Prisma.DocumentWhereInput = { deletedAt: null };
      if (query.workerId) where.workerId = query.workerId;
      if (query.type) where.type = query.type;

      const scopeWhere = await this.resolveScopeWhere(tx);
      if (Object.keys(scopeWhere).length > 0) where.AND = [scopeWhere];

      const search = query.search?.trim();
      if (search) where.name = { contains: search, mode: 'insensitive' };

      const [total, rows] = await Promise.all([
        tx.document.count({ where }),
        tx.document.findMany({
          where,
          include: DOCUMENT_INCLUDE,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        data: rows.map(toDocumentSummary),
        meta: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    });
  }

  async get(id: string): Promise<DocumentSummary> {
    return this.prisma.withRequestContext(async (tx) => {
      const row = await this.findScoped(tx, id);
      return toDocumentSummary(row);
    });
  }

  async create(dto: CreateDocumentDto): Promise<DocumentSummary> {
    const { organisationId, userId } = this.requireContext();
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Enter a document name');
    this.assertCategoryWrite(dto.type);
    const prepared = await this.safety.prepare(decodeBase64Content(dto.content), dto.mimeType, name);
    const { buffer, mimeType } = prepared;
    if (buffer.length > MAX_UPLOAD_BYTES) throw new BadRequestException('Processed file must be 8 MB or smaller');
    let createdKey: string | undefined;

    const summary = await this.prisma.withRequestContext(async (tx) => {
      if (dto.workerId) await this.assertWorker(tx, dto.workerId);

      const { key } = await this.storage.put(buffer, organisationId);
      createdKey = key;
      try {
        const row = await tx.document.create({
          data: {
            organisationId,
            workerId: dto.workerId ?? null,
            type: dto.type,
            name,
            storageKey: key,
            mimeType,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
            sizeBytes: buffer.length,
            uploadedBy: userId,
          },
          include: DOCUMENT_INCLUDE,
        });
        return toDocumentSummary(row);
      } catch (error) {
        // Don't leave an orphaned blob behind if the metadata write fails.
        throw error;
      }
    }).catch(async (error) => {
      if (createdKey) await this.storage.delete(createdKey).catch(() => this.logger.error('Orphaned document upload requires storage cleanup'));
      throw error;
    });

    await this.audit.record({
      action: AuditAction.DOCUMENT_UPLOADED,
      targetType: 'document',
      targetId: summary.id,
      newValue: {
        name: summary.name,
        type: summary.type,
        sizeBytes: summary.sizeBytes,
        workerId: summary.workerId ?? null,
      },
    });
    return summary;
  }

  /** Resolve a scoped document plus its bytes for streaming. */
  async download(
    id: string,
  ): Promise<{ document: DocumentSummary; buffer?: Buffer; signedUrl?: string }> {
    const row = await this.prisma.withRequestContext((tx) =>
      this.findScoped(tx, id),
    );
    let signedUrl: string | undefined;
    let buffer: Buffer | undefined;
    try {
      signedUrl = await this.storage.signedDownload(row.storageKey, row.name, row.mimeType);
      buffer = signedUrl ? undefined : await this.storage.get(row.storageKey);
    } catch {
      this.logger.error(`Document ${id} storage read failed`);
      throw new ServiceUnavailableException('This document file is temporarily unavailable. Contact your administrator if the problem continues.');
    }

    await this.audit.record({
      action: AuditAction.DOCUMENT_ACCESSED,
      targetType: 'document',
      targetId: row.id,
      newValue: { name: row.name, workerId: row.workerId ?? null },
    });

    return { document: toDocumentSummary(row), buffer, signedUrl };
  }

  async remove(id: string): Promise<{ id: string }> {
    const storageKey = await this.prisma.withRequestContext(async (tx) => {
      const row = await this.findScoped(tx, id);
      if (row.policyPublishedAt) throw new BadRequestException('Published policies are retained for acknowledgement history. Upload a new version instead.');
      const used = await tx.expenseClaim.count({ where: { receiptDocumentId: id } });
      if (used) throw new BadRequestException('This receipt is linked to an expense claim and cannot be deleted.');
      const claimed = await tx.document.updateMany({ where: { id, deletedAt: null, policyPublishedAt: null }, data: { deletedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('This document changed. Refresh and try again.');
      return row.storageKey;
    });
    await this.audit.record({ action: AuditAction.DOCUMENT_DELETED, targetType: 'document', targetId: id });
    // A tombstone stays inaccessible until cleanup succeeds. The scheduler retries failures.
    try {
      await this.storage.delete(storageKey);
      await this.prisma.withRequestContext((tx) => tx.document.delete({ where: { id } }));
    } catch { this.logger.error(`Document ${id} file cleanup pending; scheduled retry required`); }
    return { id };
  }

  private async findScoped(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<DocumentRow> {
    const scopeWhere = await this.resolveScopeWhere(tx);
    const row = await tx.document.findFirst({
      where: { AND: [{ id, deletedAt: null }, scopeWhere] },
      include: DOCUMENT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  /**
   * Translate the caller's effective scope into a document `where` fragment.
   * ORGANISATION roles see the whole tenant; SELF roles see only documents
   * attached to their own worker record; everyone else sees nothing.
   */
  private async resolveScopeWhere(
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.DocumentWhereInput> {
    const ctx = getRequestContext();
    const scope = getEffectiveScope(ctx?.role, 'documents', 'read');

    if (scope === PermissionScope.ORGANISATION) {
      if (ctx?.role === 'HR_ADMINISTRATOR') return { type: { not: 'PAYSLIP' } };
      if (ctx?.role === 'AUDITOR' || ctx?.role === 'SUPPORT_READ_ONLY') {
        return { type: { notIn: ['ID_DOCUMENT', 'PAYSLIP', 'PERFORMANCE'] } };
      }
      return {};
    }
    if (scope === PermissionScope.SELF && ctx?.userId) {
      const worker = await tx.worker.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      return { OR: [
        worker ? { workerId: worker.id } : { ...NO_ACCESS_DOCUMENT_WHERE },
        { type: 'POLICY', policyPublishedAt: { not: null }, policyRecipients: { some: { userId: ctx.userId } } },
      ] };
    }
    return { ...NO_ACCESS_DOCUMENT_WHERE };
  }

  private async assertWorker(
    tx: Prisma.TransactionClient,
    workerId: string,
  ): Promise<void> {
    const found = await tx.worker.findFirst({
      where: { id: workerId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Worker not found');
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }

  private assertCategoryWrite(type: string): void {
    if (type === 'PAYSLIP' && getRequestContext()?.role !== 'OWNER') {
      throw new BadRequestException('Payslip documents are restricted to the owner. Use the payroll payslip workflow.');
    }
  }
}
