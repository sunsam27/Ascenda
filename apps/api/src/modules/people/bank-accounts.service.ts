import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, NotificationType, Prisma } from '@ascenda/db';
import { PermissionScope, SystemRole } from '@ascenda/types';
import type { BankAccount } from '@ascenda/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getRequestContext } from '../../common/context/request-context';
import { getEffectiveScope } from '../../common/rbac/permissions';
import { resolveReadScope } from '../../common/rbac/worker-scope';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from './dto/bank-account.dto';
import {
  decryptAccountNumber,
  encryptAccountNumber,
  maskAccountNumber,
} from './domain/bank-crypto';
import { detectBankFromAccountNumber } from './domain/bank-detect';

type BankAccountRow = Prisma.BankAccountGetPayload<Record<string, never>>;

/** Serialise a bank account row without ever exposing the encrypted number. */
export function toBankAccount(row: BankAccountRow): BankAccount {
  return {
    id: row.id,
    organisationId: row.organisationId,
    workerId: row.workerId,
    bankName: row.bankName,
    bankCode: row.bankCode,
    accountNumberMasked: row.accountNumberMasked,
    accountName: row.accountName,
    isVerified: row.isVerified,
    isPrimary: row.isPrimary,
    requiresPayrollReview: row.requiresPayrollReview,
    payrollReviewedAt: row.payrollReviewedAt?.toISOString(),
    payrollReviewedBy: row.payrollReviewedBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/**
 * Bank accounts for the employees-of-record. A worker's bank details are
 * entered either by the employee themselves (self-service) or by an org admin
 * correcting a problem before the next pay run.
 *
 * Access: the RBAC guard admits the caller for `bank_accounts:<action>`; this
 * service then narrows to the caller's own worker when the effective scope is
 * SELF, so an employee can only ever read or write their own account.
 */
@Injectable()
export class BankAccountsService {
  private readonly logger = new Logger(BankAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForWorker(workerId: string): Promise<BankAccount[]> {
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerAccess(tx, workerId);
      const rows = await tx.bankAccount.findMany({
        where: { workerId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      });
      return rows.map(toBankAccount);
    });
  }

  /** The worker's primary account (or most recent when none is flagged). */
  async getPrimary(workerId: string): Promise<BankAccount | null> {
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerAccess(tx, workerId);
      const row = await tx.bankAccount.findFirst({
        where: { workerId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      });
      return row ? toBankAccount(row) : null;
    });
  }

  async create(
    workerId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccount> {
    const { organisationId } = this.requireContext();
    const accountNumber = dto.accountNumber.replace(/\s+/g, '');
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerAccess(tx, workerId);

      const bank = this.resolveBank(accountNumber, dto.bankName, dto.bankCode);

      // First account for a worker becomes primary unless the caller says not.
      const existing = await tx.bankAccount.count({ where: { workerId } });
      const isPrimary = dto.isPrimary ?? existing === 0;
      if (isPrimary) {
        await tx.bankAccount.updateMany({
          where: { workerId },
          data: { isPrimary: false },
        });
      }

      const row = await tx.bankAccount.create({
        data: {
          organisationId,
          workerId,
          bankName: bank.bankName,
          bankCode: bank.bankCode,
          accountNumberEncrypted: encryptAccountNumber(accountNumber),
          accountNumberMasked: maskAccountNumber(accountNumber),
          accountName: dto.accountName.trim(),
          isPrimary,
          requiresPayrollReview: true,
          createdBy: this.actorId(),
        },
      });
      await this.auditBankChange('create', row);
      await this.notifyBankChange('created', row);
      return toBankAccount(row);
    });
  }

  async update(
    workerId: string,
    accountId: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccount> {
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerAccess(tx, workerId);
      const existing = await tx.bankAccount.findFirst({
        where: { id: accountId, workerId },
      });
      if (!existing) throw new NotFoundException('Bank account not found');

      const accountNumber = dto.accountNumber
        ? dto.accountNumber.replace(/\s+/g, '')
        : decryptAccountNumber(existing.accountNumberEncrypted);

      // Re-detect only when the account number changed and no bank was given.
      const accountNumberChanged =
        dto.accountNumber !== undefined &&
        accountNumber !== decryptAccountNumber(existing.accountNumberEncrypted);
      let bankName = dto.bankName ?? existing.bankName;
      let bankCode = dto.bankCode ?? existing.bankCode;
      if (accountNumberChanged && !dto.bankName && !dto.bankCode) {
        const detected = detectBankFromAccountNumber(accountNumber);
        if (detected) {
          bankName = detected.bankName;
          bankCode = detected.bankCode;
        } else {
          // The new number's bank cannot be inferred and the caller did not
          // supply one — refusing is safer than silently attaching the old
          // bank to a different account number.
          throw new BadRequestException(
            'Bank could not be detected from the account number; please select a bank',
          );
        }
      }

      if (dto.isPrimary) {
        await tx.bankAccount.updateMany({
          where: { workerId, id: { not: accountId } },
          data: { isPrimary: false },
        });
      }

      const accountNameChanged =
        dto.accountName !== undefined &&
        dto.accountName.trim() !== existing.accountName;
      const bankChanged =
        bankName !== existing.bankName || bankCode !== existing.bankCode;
      const requiresReview =
        accountNumberChanged || accountNameChanged || bankChanged;

      const row = await tx.bankAccount.update({
        where: { id: accountId },
        data: {
          bankName,
          bankCode,
          ...(dto.accountNumber !== undefined
            ? {
                accountNumberEncrypted: encryptAccountNumber(accountNumber),
                accountNumberMasked: maskAccountNumber(accountNumber),
              }
            : {}),
          ...(dto.accountName !== undefined
            ? { accountName: dto.accountName.trim() }
            : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          // Only org-scoped callers may self-attest verification.
          ...(dto.isVerified !== undefined && this.isOrganisationScope()
            ? { isVerified: dto.isVerified }
            : {}),
          ...(requiresReview
            ? {
                requiresPayrollReview: true,
                payrollReviewedAt: null,
                payrollReviewedBy: null,
              }
            : {}),
        },
      });
      await this.auditBankChange('update', row);
      if (requiresReview) await this.notifyBankChange('changed', row);
      return toBankAccount(row);
    });
  }

  /**
   * Payroll marks a changed bank account as reviewed. Only org-scoped callers
   * (payroll admins) may clear the review flag; employees cannot attest their
   * own details.
   */
  async review(workerId: string, accountId: string): Promise<BankAccount> {
    if (!this.isOrganisationScope()) {
      throw new ForbiddenException(
        'Only payroll administrators can review bank details',
      );
    }
    const { userId } = this.requireContext();
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerAccess(tx, workerId);
      const existing = await tx.bankAccount.findFirst({
        where: { id: accountId, workerId },
      });
      if (!existing) throw new NotFoundException('Bank account not found');
      const row = await tx.bankAccount.update({
        where: { id: accountId },
        data: {
          requiresPayrollReview: false,
          payrollReviewedAt: new Date(),
          payrollReviewedBy: userId,
        },
      });
      await this.audit.record({
        action: AuditAction.BANK_DETAILS_CHANGED,
        targetType: 'bank_account',
        targetId: row.id,
        newValue: { reviewed: true, workerId },
      });
      return toBankAccount(row);
    });
  }

  async remove(workerId: string, accountId: string): Promise<void> {
    return this.prisma.withRequestContext(async (tx) => {
      await this.assertWorkerAccess(tx, workerId);
      const existing = await tx.bankAccount.findFirst({
        where: { id: accountId, workerId },
        select: { id: true, isPrimary: true },
      });
      if (!existing) throw new NotFoundException('Bank account not found');
      await tx.bankAccount.delete({ where: { id: accountId } });
      // Promote another account to primary when the primary was removed.
      if (existing.isPrimary) {
        const next = await tx.bankAccount.findFirst({
          where: { workerId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (next) {
          await tx.bankAccount.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
        }
      }
      const ctx = getRequestContext();
      await this.audit.record({
        action: 'BANK_DETAILS_CHANGED',
        organisationId: ctx?.organisationId,
        actorId: this.actorId(),
        targetType: 'BankAccount',
        targetId: accountId,
        newValue: { workerId, change: 'delete' },
      });
    });
  }

  /**
   * Resolve the bank for a new/updated account. An explicit name+code wins;
   * otherwise we attempt NUBAN prefix detection. If neither yields a bank we
   * reject — the UI must then present the dropdown so the user picks one.
   */
  private resolveBank(
    accountNumber: string,
    bankName?: string,
    bankCode?: string,
  ): { bankName: string; bankCode: string } {
    if (bankName && bankCode) {
      return { bankName, bankCode };
    }
    const detected = detectBankFromAccountNumber(accountNumber);
    if (detected) {
      return {
        bankName: bankName ?? detected.bankName,
        bankCode: bankCode ?? detected.bankCode,
      };
    }
    if (bankName && !bankCode) {
      // Name given but no code and no detection — keep the name, blank code.
      return { bankName, bankCode: '' };
    }
    throw new BadRequestException(
      'Bank could not be detected from the account number; please select a bank',
    );
  }

  private async notifyBankChange(
    change: 'created' | 'changed',
    row: BankAccountRow,
  ): Promise<void> {
    try {
      const { organisationId, userId } = this.requireContext();
      const members = await this.prisma.withRequestContext((tx) =>
        tx.membership.findMany({
          where: {
            organisationId,
            isActive: true,
            role: {
              in: [SystemRole.PAYROLL_ADMINISTRATOR, SystemRole.FINANCE_APPROVER],
            },
          },
          select: { userId: true },
        }),
      );
      const recipients = members
        .map((m) => m.userId)
        .filter((id) => id !== userId);
      if (recipients.length === 0) return;
      await this.notifications.emit({
        organisationId,
        actorUserId: userId,
        intents: recipients.map((recipientUserId) => ({
          recipientUserId,
          type: NotificationType.BANK_DETAILS_CHANGED,
          title: 'Bank details changed',
          body: `A worker's bank account was ${change} and needs payroll review before the next run.`,
          link: '/payroll',
          metadata: { workerId: row.workerId, bankAccountId: row.id },
        })),
      });
    } catch (error) {
      this.logger.warn(
        `Bank-change notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async auditBankChange(
    change: 'create' | 'update',
    row: BankAccountRow,
  ): Promise<void> {
    const ctx = getRequestContext();
    await this.audit.record({
      action: 'BANK_DETAILS_CHANGED',
      organisationId: ctx?.organisationId,
      actorId: this.actorId(),
      targetType: 'BankAccount',
      targetId: row.id,
      // Never log the raw number — the masked form only.
      newValue: {
        workerId: row.workerId,
        change,
        bankName: row.bankName,
        bankCode: row.bankCode,
        accountNumberMasked: row.accountNumberMasked,
        isPrimary: row.isPrimary,
      },
    });
  }

  private isOrganisationScope(): boolean {
    return (
      getEffectiveScope(
        getRequestContext()?.role,
        'bank_accounts',
        'update',
      ) === PermissionScope.ORGANISATION
    );
  }

  /**
   * Confirm the caller may act on this worker's bank details. An org-scoped
   * caller (OWNER / PAYROLL_ADMINISTRATOR) may act on any worker; a self caller
   * only on their own worker record.
   */
  private async assertWorkerAccess(
    tx: Prisma.TransactionClient,
    workerId: string,
  ): Promise<void> {
    const scopeWhere = (await resolveReadScope(tx, 'bank_accounts', 'read'))
      .where;
    const worker = await tx.worker.findFirst({
      where: { AND: [{ id: workerId }, scopeWhere] },
      select: { id: true },
    });
    if (!worker) throw new NotFoundException('Worker not found');
  }

  private actorId(): string {
    return this.requireContext().userId;
  }

  private requireContext(): { organisationId: string; userId: string } {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) {
      throw new UnauthorizedException('No active organisation for this request');
    }
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }
}
