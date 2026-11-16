import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditAction, Prisma, PayrollWallet } from '@ascenda/db';
import type { EmployerWalletQuote, EmployerWalletSummary } from '@ascenda/types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { getRequestContext } from '../../../common/context/request-context';
import { decryptAccountNumber, encryptAccountNumber } from '../../people/domain/bank-crypto';
import { applyMovement, LedgerMovement, money, movement, payrollRequirement, payoutMovement } from './wallet-domain';
import { EmployerFundingRegistry, EmployerTransfer, FundingEvidence, PayoutEvidence } from './wallet-provider';
import { EmployerWalletSetupDto, WalletPageDto, WalletSubmissionDto } from './wallet.dto';

type Tx = Prisma.TransactionClient;
const UNAVAILABLE = 'Employer funding is awaiting payment-partner approval. No funding account or live payments are enabled. You do not need a separate provider login.';

@Injectable()
export class EmployerWalletService {
  constructor(private readonly prisma: PrismaService, private readonly registry: EmployerFundingRegistry) {}

  private context() {
    const ctx = getRequestContext();
    if (!ctx?.organisationId || !ctx.userId) throw new UnauthorizedException('No active organisation');
    return { organisationId: ctx.organisationId, userId: ctx.userId };
  }

  private assertEncryption() {
    // No fixed development key for company applications or payroll funding.
    if (!process.env.BANK_ENCRYPTION_KEY) throw new ConflictException('Secure payroll funding storage is not configured. Contact Ascenda support.');
  }

  async summary(): Promise<EmployerWalletSummary> {
    const { organisationId } = this.context();
    const wallet = await this.prisma.withRequestContext((tx) => tx.payrollWallet.findUnique({ where: { organisationId } }));
    const provider = this.registry.configured();
    const ready = Boolean(provider && (!wallet?.provider || (wallet.provider === provider.id && wallet.mode === provider.mode)));
    return {
      status: (wallet?.status ?? 'NOT_STARTED') as EmployerWalletSummary['status'], currency: 'NGN',
      mode: wallet?.mode as EmployerWalletSummary['mode'] ?? null, providerReady: ready,
      message: !ready ? UNAVAILABLE : wallet?.status === 'ACTIVE' ? 'Transfer from your company bank account. Funds become available only after partner confirmation.'
        : wallet?.status === 'REJECTED' ? 'Your setup was not approved. Review your company details and contact Ascenda support.'
          : 'Company verification and funding-account creation must finish before you transfer funds.',
      pendingMinorUnits: wallet?.pendingMinorUnits ?? 0, availableMinorUnits: wallet?.availableMinorUnits ?? 0,
      reservedMinorUnits: wallet?.reservedMinorUnits ?? 0, paidMinorUnits: wallet?.paidMinorUnits ?? 0,
      lastReconciledAt: wallet?.lastReconciledAt?.toISOString() ?? null,
      reconciliationRequired: wallet?.reconciliationRequired ?? false,
      fundingAccount: wallet?.status === 'ACTIVE' && ready && wallet.fundingAccountEncrypted && wallet.bankName && wallet.accountName
        ? { bankName: wallet.bankName, accountName: wallet.accountName, accountNumber: decryptAccountNumber(wallet.fundingAccountEncrypted) } : null,
    };
  }

  async setup(dto: EmployerWalletSetupDto) {
    const { organisationId, userId } = this.context();
    this.assertEncryption();
    const application = {
      legalName: dto.legalName.trim(), registrationNumber: dto.registrationNumber.trim(), companyAddress: dto.companyAddress.trim(),
      representativeName: dto.representativeName.trim(), representativeEmail: dto.representativeEmail.trim().toLowerCase(),
      representativePhone: dto.representativePhone.trim(), representativeRole: dto.representativeRole.trim(),
    };
    if (Object.values(application).some((value) => !value)) throw new BadRequestException('Complete the company and representative details');
    await this.prisma.withRequestContext(async (tx) => {
      const org = await tx.organisation.findFirst({ where: { id: organisationId } });
      if (!org) throw new NotFoundException('Organisation not found');
      if (org.country.toUpperCase() !== 'NG' || org.currency !== 'NGN') throw new BadRequestException('Employer funding currently supports Nigerian organisations paying in NGN');
      await tx.payrollWallet.upsert({ where: { organisationId }, create: {
        organisationId, setupReference: `EW-${randomUUID()}`, createdBy: userId,
      }, update: {} });
      const wallet = await this.lock(tx, organisationId);
      if (wallet.status === 'ACTIVE') throw new ConflictException('Company funding is already active');
      if (wallet.applicationEncrypted && wallet.status === 'PENDING_VERIFICATION') {
        throw new ConflictException('An application is already pending. Use Check setup status instead of creating another.');
      }
      await tx.payrollWallet.update({ where: { id: wallet.id }, data: {
        applicationEncrypted: encryptAccountNumber(JSON.stringify(application)), status: 'PENDING_VERIFICATION',
      } });
      await this.journal(tx, wallet, `setup:${randomUUID()}`, 'SETUP_SUBMITTED', 'PENDING', 0, movement({}), wallet.setupReference, userId);
    });
    return this.syncSetup();
  }

  async syncSetup() {
    const { organisationId } = this.context();
    const wallet = await this.prisma.withRequestContext((tx) => tx.payrollWallet.findUnique({ where: { organisationId } }));
    if (!wallet?.applicationEncrypted) throw new ConflictException('Complete company setup first');
    const provider = this.registry.configured();
    if (!provider) return this.summary(); // Application is saved; never fake a provider approval.
    if (wallet.provider && (wallet.provider !== provider.id || wallet.mode !== provider.mode)) throw new ConflictException('Funding provider changed. Contact support.');
    let result;
    try {
      result = await provider.createOrRetrieve(wallet.setupReference, JSON.parse(decryptAccountNumber(wallet.applicationEncrypted)));
    } catch {
      throw new ConflictException('The partner has not confirmed setup. Your application is saved; check setup status later.');
    }
    if (result.setupReference !== wallet.setupReference) throw new ConflictException('Setup response requires support review');
    const active = result.state === 'ACTIVE' && result.employerVerified && result.walletReference && result.fundingAccount;
    if (active && (!/^\d{10}$/.test(result.fundingAccount!.accountNumber) || !result.fundingAccount!.bankName.trim() || !result.fundingAccount!.accountName.trim())) {
      throw new ConflictException('The partner has not returned valid NGN funding-account details');
    }
    await this.prisma.withRequestContext(async (tx) => {
      const current = await this.lock(tx, organisationId);
      if (current.status === 'ACTIVE') return;
      const state = active ? 'ACTIVE' : result.state === 'REJECTED' ? 'REJECTED' : 'PENDING_VERIFICATION';
      await tx.payrollWallet.update({ where: { id: current.id }, data: {
        provider: provider.id, mode: provider.mode, status: state,
        providerWalletReference: result.walletReference ?? current.providerWalletReference,
        ...(active ? { bankName: result.fundingAccount!.bankName, accountName: result.fundingAccount!.accountName,
          fundingAccountEncrypted: encryptAccountNumber(result.fundingAccount!.accountNumber) } : {}),
      } });
      if (state !== current.status) await this.journal(tx, current, `setup-state:${state}`, 'SETUP_STATUS', state, 0, movement({}), current.setupReference, current.createdBy);
    });
    return this.summary();
  }

  async ledger(query: WalletPageDto) {
    this.context();
    return this.prisma.withRequestContext(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.payrollWalletLedger.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.payrollWalletLedger.count(),
      ]);
      return { data: rows.map((row) => ({ id: row.id, type: row.type, status: row.status, amountMinorUnits: row.amountMinorUnits,
        currency: row.currency, providerReference: row.providerReference, payrollRunId: row.payrollRunId, paymentBatchId: row.paymentBatchId,
        occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString() })),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
    });
  }

  async history(query: WalletPageDto) {
    this.context();
    return this.prisma.withRequestContext(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.payrollWalletAttempt.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.payrollWalletAttempt.count(),
      ]);
      const workers = await tx.worker.findMany({ where: { id: { in: rows.map((row) => row.workerId) } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true } });
      const names = new Map(workers.map((worker) => [worker.id, worker]));
      return { data: rows.map((row) => ({ reference: row.reference, paymentId: row.paymentId, paymentBatchId: row.paymentBatchId,
        payrollRunId: row.payrollRunId, workerName: names.has(row.workerId) ? `${names.get(row.workerId)!.firstName} ${names.get(row.workerId)!.lastName}` : 'Name unavailable',
        employeeNumber: names.get(row.workerId)?.employeeNumber ?? '', amountMinorUnits: row.amountMinorUnits,
        feeReservedMinorUnits: row.feeReservedMinorUnits, status: row.status, attemptNumber: row.attemptNumber,
        createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
    });
  }

  private async selection(tx: Tx, batchId: string, retry: boolean) {
    const batch = await tx.paymentBatch.findFirst({ where: { id: batchId }, include: { payrollRun: true, payments: true } });
    if (!batch) throw new NotFoundException('Payment batch not found');
    const run = batch.payrollRun;
    if (!run || !run.approvedAt || !run.approvedById || !['PROCESSED', 'LOCKED'].includes(run.status) || run.reversalOfRunId || run.reversedAt) {
      throw new ConflictException('Only an approved, processed, unreversed payroll can be paid');
    }
    if (batch.currency !== 'NGN' || batch.exportedAt || await tx.payout.count({ where: { paymentBatchId: batch.id } })) {
      throw new ConflictException('This batch uses another payment route or currency. Do not send a duplicate payroll.');
    }
    if ((!retry && batch.status !== 'APPROVED') || (retry && !['FAILED', 'PARTIALLY_PAID'].includes(batch.status))) {
      throw new ConflictException(retry ? 'Only confirmed failed wallet payouts can be retried' : 'Approve this payment batch first');
    }
    const attempts = await tx.payrollWalletAttempt.findMany({ where: { paymentBatchId: batch.id }, orderBy: { attemptNumber: 'desc' } });
    const latest = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) if (!latest.has(attempt.paymentId)) latest.set(attempt.paymentId, attempt);
    if (!retry && attempts.length) throw new ConflictException('Wallet payment has already been submitted');
    const payments = retry ? batch.payments.filter((payment) => latest.get(payment.id)?.status === 'FAILED' && payment.status === 'FAILED') : batch.payments;
    if (!payments.length || (!retry && payments.some((payment) => payment.status !== 'APPROVED'))) throw new ConflictException('No approved payments or confirmed failures are eligible');
    if (new Set(payments.map((payment) => payment.workerId)).size !== payments.length) throw new ConflictException('Duplicate employee payments require review');
    const payslips = await tx.payslip.findMany({ where: { payrollRunId: run.id, workerId: { in: payments.map((payment) => payment.workerId) } },
      select: { workerId: true, currency: true, netMinorUnits: true } });
    const frozenNet = new Map(payslips.map((slip) => [slip.workerId, slip]));
    if (payments.some((payment) => frozenNet.get(payment.workerId)?.netMinorUnits !== payment.amountMinorUnits || frozenNet.get(payment.workerId)?.currency !== payment.currency)) {
      throw new ConflictException('Payment amounts must match the approved payroll’s frozen net payslips');
    }
    if (batch.payments.reduce((sum, payment) => sum + payment.amountMinorUnits, 0) !== batch.totalMinorUnits || batch.payments.length !== batch.paymentCount) {
      throw new ConflictException('Payment batch totals require review');
    }
    const accounts = await tx.bankAccount.findMany({ where: { workerId: { in: payments.map((payment) => payment.workerId) } }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }] });
    const chosen = new Map<string, (typeof accounts)[number]>();
    for (const account of accounts) if (!chosen.has(account.workerId)) chosen.set(account.workerId, account);
    const transfers = payments.map((payment) => {
      money(payment.amountMinorUnits, true);
      if (payment.currency !== 'NGN') throw new ConflictException('All payroll payments must be NGN');
      const account = chosen.get(payment.workerId);
      if (!account || account.requiresPayrollReview) throw new ConflictException('Review every employee bank account before paying');
      const accountNumber = decryptAccountNumber(account.accountNumberEncrypted);
      const provider = this.registry.configured();
      const providerCode = provider?.id === 'PAYSTACK' ? account.paystackBankCode : provider?.id === 'FLUTTERWAVE' ? account.flutterwaveBankCode : null;
      const bankCode = providerCode?.trim() || account.bankCode.trim();
      if (!/^\d{10}$/.test(accountNumber) || !bankCode || !account.accountName.trim()) throw new ConflictException('Employee bank details are incomplete');
      return { paymentId: payment.id, workerId: payment.workerId, amountMinorUnits: payment.amountMinorUnits,
        attemptNumber: (latest.get(payment.id)?.attemptNumber ?? 0) + 1,
        // Stable quote reference; actual provider reference is persisted on reservation.
        reference: `${payment.reference}-EW${(latest.get(payment.id)?.attemptNumber ?? 0) + 1}`,
        accountNumber, accountName: account.accountName, bankCode };
    });
    const fingerprint = createHash('sha256').update(JSON.stringify({ batch: batch.id, status: batch.status, transfers })).digest('hex');
    return { batch, run, transfers, fingerprint };
  }

  private async quoteData(batchId: string, retry: boolean) {
    const { organisationId } = this.context();
    const snapshot = await this.prisma.withRequestContext(async (tx) => ({
      wallet: await tx.payrollWallet.findUnique({ where: { organisationId } }), selected: await this.selection(tx, batchId, retry),
    }));
    const base = payrollRequirement(snapshot.selected.transfers.map((transfer) => transfer.amountMinorUnits), snapshot.selected.transfers.map(() => 0));
    const provider = this.registry.configured();
    const wallet = snapshot.wallet;
    if (!provider || !wallet || wallet.status !== 'ACTIVE' || !wallet.providerWalletReference || wallet.provider !== provider.id || wallet.mode !== provider.mode || wallet.reconciliationRequired) {
      return { ...snapshot, fees: null, available: wallet?.availableMinorUnits ?? 0, totals: base, ready: false };
    }
    const requests: EmployerTransfer[] = snapshot.selected.transfers.map((transfer) => ({ ...transfer, walletReference: wallet.providerWalletReference!, currency: 'NGN' }));
    let quotes, balance;
    try { [quotes, balance] = await Promise.all([provider.quote(requests), provider.balance(wallet.providerWalletReference)]); }
    catch { throw new ConflictException('The payment partner could not confirm fees and balance. Nothing has been reserved.'); }
    if (balance.currency !== 'NGN' || money(balance.availableMinorUnits) < 0) throw new ConflictException('Provider balance requires review');
    if (quotes.length !== requests.length || new Set(quotes.map((quote) => quote.reference)).size !== requests.length) throw new ConflictException('Incomplete provider fee quote');
    const feeMap = new Map(quotes.map((quote) => [quote.reference, quote.feeMinorUnits]));
    const fees = requests.map((request) => {
      const fee = feeMap.get(request.reference);
      if (fee === undefined) throw new ConflictException('Missing provider fee quote');
      return fee;
    });
    return { ...snapshot, fees, available: Math.min(wallet.availableMinorUnits, balance.availableMinorUnits),
      totals: payrollRequirement(requests.map((request) => request.amountMinorUnits), fees), ready: true };
  }

  async quote(batchId: string, retry = false): Promise<EmployerWalletQuote> {
    const data = await this.quoteData(batchId, retry);
    const shortfall = data.ready ? Math.max(0, data.totals.required - data.available) : null;
    return { paymentBatchId: batchId, payrollRunId: data.selected.run.id, currency: 'NGN', paymentCount: data.selected.transfers.length,
      netMinorUnits: data.totals.net, feeMinorUnits: data.ready ? data.totals.fees : null, requiredMinorUnits: data.ready ? data.totals.required : null,
      availableMinorUnits: data.available, shortfallMinorUnits: shortfall, canSubmit: data.ready && shortfall === 0,
      message: !data.ready ? 'Activate employer funding and resolve any reconciliation hold before paying. Fees are not yet confirmed.'
        : shortfall ? 'Fund payroll from your company bank account before submitting.' : 'The approved net pay and confirmed fees can be reserved for this payroll.' };
  }

  async submit(batchId: string, dto: WalletSubmissionDto, retry = false) {
    const { organisationId, userId } = this.context();
    // A replay returns the persisted submission, never dispatches it again.
    const existing = await this.prisma.withRequestContext((tx) => tx.payrollWalletReservation.findFirst({ where: { requestKey: dto.requestKey } }));
    if (existing) {
      if (existing.paymentBatchId !== batchId || existing.retry !== retry) throw new ConflictException('Request key already used for another submission');
      return { reservationId: existing.id, replayed: true };
    }
    this.assertEncryption();
    this.registry.require();
    const data = await this.quoteData(batchId, retry);
    if (!data.ready || !data.wallet?.providerWalletReference || !data.fees) throw new ConflictException('Employer funding is not active');
    if (data.totals.required !== dto.expectedRequiredMinorUnits) throw new ConflictException('Payroll fees changed. Review a new quote before paying.');
    if (data.available < data.totals.required) throw new ConflictException('Insufficient available funds. Fund payroll first.');
    const reserved = await this.prisma.withRequestContext(async (tx) => {
      const wallet = await this.lock(tx, organisationId);
      const replay = await tx.payrollWalletReservation.findFirst({ where: { walletId: wallet.id, requestKey: dto.requestKey } });
      if (replay) {
        if (replay.paymentBatchId !== batchId || replay.retry !== retry) throw new ConflictException('Request key already used');
        return { reservationId: replay.id, dispatch: false };
      }
      await tx.$queryRaw`SELECT id FROM payment_batches WHERE id = ${batchId} AND "organisationId" = ${organisationId} FOR UPDATE`;
      const fresh = await this.selection(tx, batchId, retry);
      if (fresh.fingerprint !== data.selected.fingerprint || wallet.status !== 'ACTIVE' || wallet.reconciliationRequired || wallet.providerWalletReference !== data.wallet!.providerWalletReference) {
        throw new ConflictException('Payroll or funding details changed. Review again.');
      }
      const reservation = await tx.payrollWalletReservation.create({ data: {
        organisationId, walletId: wallet.id, paymentBatchId: batchId, payrollRunId: fresh.run.id,
        requestKey: dto.requestKey, retry, totalMinorUnits: data.totals.required, feeMinorUnits: data.totals.fees, createdBy: userId,
      } });
      await this.journal(tx, wallet, `reserve:${reservation.id}`, 'PAYROLL_RESERVATION', 'RESERVED', data.totals.required,
        movement({ availableDelta: -data.totals.required, reservedDelta: data.totals.required }), reservation.id, userId, fresh.run.id, batchId);
      for (const [index, transfer] of fresh.transfers.entries()) {
        await tx.payrollWalletAttempt.create({ data: {
          organisationId, walletId: wallet.id, reservationId: reservation.id, paymentBatchId: batchId, payrollRunId: fresh.run.id,
          paymentId: transfer.paymentId, workerId: transfer.workerId, reference: transfer.reference, attemptNumber: transfer.attemptNumber,
          amountMinorUnits: transfer.amountMinorUnits, feeReservedMinorUnits: data.fees![index]!,
          beneficiaryEncrypted: encryptAccountNumber(JSON.stringify({ accountNumber: transfer.accountNumber, accountName: transfer.accountName, bankCode: transfer.bankCode })),
        } });
        await tx.payment.update({ where: { id: transfer.paymentId }, data: { status: 'PROCESSING', processedAt: null } });
      }
      await tx.paymentBatch.update({ where: { id: batchId }, data: { status: 'PROCESSING', payoutStartedAt: new Date(), payoutCompletedAt: null, paidAt: null } });
      return { reservationId: reservation.id, dispatch: true };
    });
    if (reserved.dispatch) await this.dispatch(reserved.reservationId);
    return { reservationId: reserved.reservationId, replayed: !reserved.dispatch };
  }

  /** Safe crash recovery: unsubmitted rows may be claimed once; submitted rows are only looked up. */
  private async dispatch(reservationId: string) {
    const { organisationId } = this.context();
    const provider = this.registry.require();
    const rows = await this.prisma.withRequestContext((tx) => tx.payrollWalletAttempt.findMany({ where: { reservationId, submittedAt: null }, include: { wallet: true } }));
    for (const row of rows) {
      const claimed = await this.prisma.withRequestContext(async (tx) => {
        const wallet = await this.lock(tx, organisationId);
        if (wallet.reconciliationRequired || wallet.status !== 'ACTIVE' || wallet.provider !== provider.id || wallet.mode !== provider.mode) return { count: 0 };
        return tx.payrollWalletAttempt.updateMany({ where: { id: row.id, submittedAt: null, status: 'QUEUED' }, data: { submittedAt: new Date(), status: 'PROCESSING' } });
      });
      if (claimed.count !== 1) continue;
      try {
        await provider.submit({ ...JSON.parse(decryptAccountNumber(row.beneficiaryEncrypted)), walletReference: row.wallet.providerWalletReference!, reference: row.reference, amountMinorUnits: row.amountMinorUnits, currency: 'NGN' });
      } catch {
        // Never log raw provider errors or infer that money was not debited.
      }
      try { await this.applyPayout(organisationId, await provider.verifyPayout(row.wallet.providerWalletReference!, row.reference)); }
      catch { /* Reservation stays in place until verified reconciliation. */ }
    }
  }

  async reconcile() {
    const { organisationId } = this.context();
    const provider = this.registry.require();
    const wallet = await this.prisma.withRequestContext((tx) => tx.payrollWallet.findUnique({ where: { organisationId } }));
    if (!wallet?.providerWalletReference || wallet.status !== 'ACTIVE' || wallet.provider !== provider.id || wallet.mode !== provider.mode) throw new ConflictException('Employer funding is not active');
    let deposits;
    try { deposits = await provider.fundingTransactions(wallet.providerWalletReference); }
    catch { throw new ConflictException('Funding confirmation is delayed. Your balance has not been changed.'); }
    for (const deposit of deposits) await this.applyFunding(organisationId, deposit);
    const reservations = await this.prisma.withRequestContext((tx) => tx.payrollWalletReservation.findMany({ where: { walletId: wallet.id, attempts: { some: { submittedAt: null } } }, take: 50 }));
    for (const reservation of reservations) await this.dispatch(reservation.id);
    const attempts = await this.prisma.withRequestContext((tx) => tx.payrollWalletAttempt.findMany({ where: { walletId: wallet.id, status: { in: ['QUEUED', 'PROCESSING', 'PAID'] }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - 600_000) } }] }, take: 100, orderBy: { lastCheckedAt: 'asc' } }));
    for (const attempt of attempts) {
      try { await this.applyPayout(organisationId, await provider.verifyPayout(wallet.providerWalletReference, attempt.reference)); }
      catch { /* Unknown outcomes are not retryable. */ }
    }
    let balance;
    try { balance = await provider.balance(wallet.providerWalletReference); }
    catch { throw new ConflictException('Partner balance confirmation is delayed. Confirmed activity is saved; unresolved reservations remain in place.'); }
    if (balance.currency !== 'NGN' || money(balance.availableMinorUnits) < 0) throw new ConflictException('Provider balance requires review');
    await this.prisma.withRequestContext(async (tx) => {
      const current = await this.lock(tx, organisationId);
      // A provider snapshot is evidence for a hold, NEVER permission to mint
      // credits or replace the journal's balance. Pending debits may make a
      // provider balance lower than available + reserved, so compare available.
      await tx.payrollWallet.update({ where: { id: wallet.id }, data: { lastReconciledAt: new Date(),
        reconciliationRequired: current.reconciliationRequired || balance.availableMinorUnits < current.availableMinorUnits } });
    });
    return this.summary();
  }

  async webhook(organisationId: string, raw: Buffer, headers: Record<string, string | string[] | undefined>) {
    const provider = this.registry.require();
    const event = await provider.webhook(raw, headers);
    if (!event) return { received: true };
    const wallet = await this.prisma.withContext({ organisationId }, (tx) => tx.payrollWallet.findUnique({ where: { organisationId } }));
    if (!wallet || wallet.provider !== provider.id || wallet.mode !== provider.mode || wallet.providerWalletReference !== event.walletReference) throw new NotFoundException('Employer funding account not found');
    if (event.funding) await this.applyFunding(organisationId, event.funding);
    if (event.payout) await this.applyPayout(organisationId, event.payout);
    return { received: true };
  }

  private async applyFunding(organisationId: string, event: FundingEvidence) {
    this.validateEvidence(event);
    if (!Number.isFinite(event.occurredAt.getTime())) throw new BadRequestException('Invalid funding timestamp');
    await this.prisma.withContext({ organisationId }, async (tx) => {
      let wallet = await this.lock(tx, organisationId);
      this.matchWallet(wallet, event.walletReference);
      const old = await tx.payrollWalletDeposit.findUnique({ where: { walletId_providerReference: { walletId: wallet.id, providerReference: event.reference } } });
      if (old && (old.amountMinorUnits !== event.amountMinorUnits || old.feeMinorUnits !== event.feeMinorUnits)) throw new ConflictException('Funding evidence changed. Support review required.');
      if (old?.status === event.status || old?.status === 'REFUNDED' || (old && old.status !== 'PENDING' && !(old.status === 'CONFIRMED' && event.status === 'REFUNDED'))) return;
      const pendingDelta = (event.status === 'PENDING' ? event.amountMinorUnits : 0) - (old?.status === 'PENDING' ? event.amountMinorUnits : 0);
      const net = event.amountMinorUnits - event.feeMinorUnits;
      const availableDelta = event.status === 'CONFIRMED' ? net : event.status === 'REFUNDED' && old?.status === 'CONFIRMED' ? -net : 0;
      if (event.status === 'REFUNDED' && old?.status !== 'CONFIRMED') throw new ConflictException('Funding refund requires its confirmed deposit');
      if (availableDelta < 0 && wallet.availableMinorUnits < -availableDelta) {
        await tx.payrollWallet.update({ where: { id: wallet.id }, data: { reconciliationRequired: true } });
        return; // Freeze spending; do not erase history or manufacture a positive balance.
      }
      await tx.payrollWalletDeposit.upsert({ where: { walletId_providerReference: { walletId: wallet.id, providerReference: event.reference } },
        create: { organisationId, walletId: wallet.id, providerReference: event.reference, amountMinorUnits: event.amountMinorUnits, feeMinorUnits: event.feeMinorUnits, status: event.status }, update: { status: event.status } });
      wallet = await this.journal(tx, wallet, `funding:${event.reference}:${event.status}`, event.status === 'REFUNDED' ? 'REFUND' : 'DEPOSIT', event.status,
        event.status === 'CONFIRMED' ? event.amountMinorUnits : event.amountMinorUnits, movement({ pendingDelta, availableDelta: event.status === 'CONFIRMED' ? event.amountMinorUnits : availableDelta }), event.reference, wallet.createdBy, undefined, undefined, event.occurredAt);
      if (event.status === 'CONFIRMED' && event.feeMinorUnits) await this.journal(tx, wallet, `funding-fee:${event.reference}`, 'FEE', 'CONFIRMED', event.feeMinorUnits,
        movement({ availableDelta: -event.feeMinorUnits }), event.reference, wallet.createdBy, undefined, undefined, event.occurredAt);
    });
  }

  private async applyPayout(organisationId: string, event: PayoutEvidence) {
    this.validateEvidence(event);
    await this.prisma.withContext({ organisationId }, async (tx) => {
      let wallet = await this.lock(tx, organisationId);
      this.matchWallet(wallet, event.walletReference);
      const attempt = await tx.payrollWalletAttempt.findFirst({ where: { walletId: wallet.id, reference: event.reference } });
      if (!attempt) throw new NotFoundException('Payroll transfer not found');
      if (attempt.amountMinorUnits !== event.amountMinorUnits) throw new ConflictException('Payroll amount mismatch');
      const newer = await tx.payrollWalletAttempt.count({ where: { paymentId: attempt.paymentId, attemptNumber: { gt: attempt.attemptNumber } } });
      if ((newer && event.status !== attempt.status) || (attempt.status === 'FAILED' && ['PAID', 'REVERSED'].includes(event.status))) {
        await tx.payrollWallet.update({ where: { id: wallet.id }, data: { reconciliationRequired: true } });
        return; // Late contradictory evidence must not settle or fund a newer attempt.
      }
      await tx.payrollWalletAttempt.update({ where: { id: attempt.id }, data: { lastCheckedAt: new Date() } });
      let delta;
      try { delta = payoutMovement(attempt.status, event.status, attempt.amountMinorUnits, attempt.feeReservedMinorUnits, event.feeMinorUnits, event.fundsMovement); }
      catch {
        await tx.payrollWallet.update({ where: { id: wallet.id }, data: { reconciliationRequired: true } });
        return;
      }
      if (!delta) return;
      await tx.payrollWalletAttempt.update({ where: { id: attempt.id }, data: { status: event.status, actualFeeMinorUnits: event.feeMinorUnits, providerTransferId: event.providerTransferId, completedAt: new Date() } });
      wallet = await this.journal(tx, wallet, `payout:${attempt.id}:${event.status}`, event.status === 'REVERSED' ? 'REVERSAL' : 'SALARY_PAYOUT', event.status,
        attempt.amountMinorUnits, delta, attempt.reference, wallet.createdBy, attempt.payrollRunId, attempt.paymentBatchId);
      if (attempt.status !== 'PAID' && event.feeMinorUnits) await this.journal(tx, wallet, `payout-fee:${attempt.id}`, 'FEE', 'CONFIRMED', event.feeMinorUnits,
        movement({}), attempt.reference, wallet.createdBy, attempt.payrollRunId, attempt.paymentBatchId);
      await tx.payment.update({ where: { id: attempt.paymentId }, data: { status: event.status, processedAt: new Date() } });
      const payments = await tx.payment.findMany({ where: { paymentBatchId: attempt.paymentBatchId }, select: { status: true } });
      const status = payments.some((payment) => ['PENDING', 'APPROVED', 'PROCESSING'].includes(payment.status)) ? 'PROCESSING'
        : payments.every((payment) => payment.status === 'PAID') ? 'PAID' : payments.some((payment) => payment.status === 'PAID') ? 'PARTIALLY_PAID' : 'FAILED';
      await tx.paymentBatch.update({ where: { id: attempt.paymentBatchId }, data: { status, paidAt: status === 'PAID' ? new Date() : null, payoutCompletedAt: status !== 'PROCESSING' ? new Date() : null } });
    });
  }

  private validateEvidence(event: FundingEvidence | PayoutEvidence) {
    if (event.verified !== true || event.currency !== 'NGN' || !event.walletReference?.trim() || !event.reference?.trim() || event.reference.length > 200) throw new BadRequestException('Unverified or invalid payment evidence');
    money(event.amountMinorUnits, true); money(event.feeMinorUnits);
    if (event.feeMinorUnits < 0) throw new BadRequestException('Invalid confirmed fee');
    if ('occurredAt' in event && event.feeMinorUnits > event.amountMinorUnits) throw new BadRequestException('Invalid funding fee');
  }

  private matchWallet(wallet: PayrollWallet, reference: string) {
    const provider = this.registry.require();
    if (wallet.status !== 'ACTIVE' || wallet.providerWalletReference !== reference || wallet.provider !== provider.id || wallet.mode !== provider.mode) throw new NotFoundException('Employer funding account not found');
  }

  private async lock(tx: Tx, organisationId: string) {
    await tx.$queryRaw`SELECT id FROM payroll_wallets WHERE "organisationId" = ${organisationId} FOR UPDATE`;
    const wallet = await tx.payrollWallet.findUnique({ where: { organisationId } });
    if (!wallet) throw new NotFoundException('Employer funding setup not found');
    return wallet;
  }

  /** Every financial projection change and immutable journal entry share one transaction. */
  private async journal(tx: Tx, wallet: PayrollWallet, eventKey: string, type: string, status: string, amountMinorUnits: number,
    delta: LedgerMovement, providerReference: string, actorId: string, payrollRunId?: string, paymentBatchId?: string, occurredAt = new Date()) {
    const exists = await tx.payrollWalletLedger.findUnique({ where: { walletId_eventKey: { walletId: wallet.id, eventKey } } });
    if (exists) return wallet;
    let balances;
    try { balances = applyMovement(wallet, delta); }
    catch { throw new ConflictException('Insufficient or inconsistent employer funding balance'); }
    await tx.payrollWalletLedger.create({ data: { organisationId: wallet.organisationId, walletId: wallet.id, eventKey, type, status,
      amountMinorUnits, currency: 'NGN', ...delta, providerReference, actorId, payrollRunId, paymentBatchId, occurredAt } });
    const updated = await tx.payrollWallet.update({ where: { id: wallet.id }, data: balances });
    // A summary audit is transactional too; no raw KYB, credentials or account numbers.
    await tx.auditLog.create({ data: { organisationId: wallet.organisationId, actorId, actorEmail: '', action: AuditAction.PAYMENT_STATUS_CHANGED,
      targetType: 'employer_payroll_wallet', targetId: wallet.id, newValue: { type, status, reference: providerReference, payrollRunId: payrollRunId ?? null }, ipAddress: '', userAgent: '' } });
    return updated;
  }
}
