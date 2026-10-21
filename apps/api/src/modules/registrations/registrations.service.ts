// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATIONS SERVICE — self-serve workspace signup
//
// Replaces the admin-approved "request access" flow. A signup collects the
// organisation + owner details, emails a 6-digit verification code, and on
// verification provisions the workspace immediately (free plans) or hands off
// to a payment gateway (paid plans) before provisioning.
//
// Registrations are NOT tenant-scoped (they exist before an organisation does).
// Provisioning runs inside an RLS context keyed to the new organisation.
// ─────────────────────────────────────────────────────────────────────────────
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  PayFrequency,
  SystemRole,
  type Plan,
  type Registration,
} from '@ascenda/db';
import {
  PaymentProvider,
  SubscriptionStatus,
  type PlanSummary,
  type RegistrationSummary,
  type StartRegistrationResult,
} from '@ascenda/types';
import * as argon2 from 'argon2';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { parseTeamSize, describePlanBand } from './team-size.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailerService } from '../../common/mailer/mailer.service';
import { hashToken } from '../../common/security/tokens';
import { AuditService } from '../audit/audit.service';
import { toPlanSummary } from '../plans/plans.service';
import { StartRegistrationDto } from './dto/start-registration.dto';

const CODE_TTL_MINUTES = 15;
const MAX_VERIFY_ATTEMPTS = 5;

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ProvisionedWorkspace {
  organisationId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
  role: SystemRole;
  planName: string;
  planCode: string;
}

export interface VerifyOutcome {
  completed: boolean;
  requiresPayment: boolean;
  redirectTo?: string;
  plan: PlanSummary;
  workspace?: ProvisionedWorkspace;
}

const COUNTRY_DEFAULTS: Record<string, { currency: string; timezone: string }> =
  {
    NG: { currency: 'NGN', timezone: 'Africa/Lagos' },
    GH: { currency: 'GHS', timezone: 'Africa/Accra' },
    KE: { currency: 'KES', timezone: 'Africa/Nairobi' },
    ZA: { currency: 'ZAR', timezone: 'Africa/Johannesburg' },
    US: { currency: 'USD', timezone: 'America/New_York' },
    GB: { currency: 'GBP', timezone: 'Europe/London' },
  };

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'workspace';
}

function maskEmail(email: string): string {
  const [rawLocal, domain] = email.split('@');
  const local = rawLocal ?? '';
  if (!domain) return email;
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

function generateCode(): string {
  return randomInt(100000, 1000000).toString();
}

function periodEnd(from: Date, period: string): Date {
  const end = new Date(from);
  if (period === 'MONTHLY') end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return end;
}

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Payments are paused while the product body is built out. When disabled,
   * paid plans provision immediately like free plans; set PAYMENTS_ENABLED=true
   * to restore the checkout gate. The payment code stays intact either way.
   */
  private paymentsEnabled(): boolean {
    return (
      (this.config.get<string>('PAYMENTS_ENABLED') ?? 'false')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  /** Public: begin a signup and email a verification code. */
  async start(
    dto: StartRegistrationDto,
    meta: RequestMeta,
  ): Promise<StartRegistrationResult> {
    const email = dto.email.trim().toLowerCase();

    const plan = await this.prisma.plan.findUnique({
      where: { code: dto.planCode },
    });
    if (!plan || !plan.isActive) {
      throw new BadRequestException('The selected plan is not available');
    }

    // The chosen team size must fall inside the plan's headcount band.
    const team = parseTeamSize(dto.teamSize);
    const bandMin = plan.minHeadcount ?? 1;
    if (
      team.min < bandMin ||
      (plan.maxHeadcount != null && team.max > plan.maxHeadcount)
    ) {
      throw new BadRequestException(
        `The ${plan.name} plan is for teams of ${describePlanBand(
          plan,
        )}. Please adjust your team size or choose another plan.`,
      );
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException(
        'An account with this email already exists. Please sign in instead.',
      );
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const code = generateCode();
    const verificationExpiresAt = new Date(
      Date.now() + CODE_TTL_MINUTES * 60 * 1000,
    );

    const data = {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email,
      phone: dto.phone?.trim() || null,
      passwordHash,
      organisationName: dto.organisationName.trim(),
      organisationType: dto.organisationType,
      teamSize: dto.teamSize,
      country: (dto.country ?? 'NG').toUpperCase(),
      role: dto.role?.trim() || null,
      message: dto.message?.trim() || null,
      planId: plan.id,
      planCode: plan.code,
      verificationCodeHash: hashToken(code),
      verificationExpiresAt,
      verificationAttempts: 0,
      status: 'PENDING' as const,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    };

    // Reuse an in-flight (unverified) signup for the same email.
    const pending = await this.prisma.registration.findFirst({
      where: { email, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    const registration = pending
      ? await this.prisma.registration.update({
          where: { id: pending.id },
          data,
        })
      : await this.prisma.registration.create({ data });

    await this.mailer.sendWorkspaceVerificationCode({
      to: email,
      name: `${data.firstName} ${data.lastName}`,
      organisationName: data.organisationName,
      code,
      expiresInMinutes: CODE_TTL_MINUTES,
    });

    this.logger.log(`Registration started for ${email} (${plan.code})`);

    return {
      registrationId: registration.id,
      email,
      emailMasked: maskEmail(email),
      requiresPayment:
        this.paymentsEnabled() && !plan.isFree && plan.priceMinorUnits > 0,
      plan: toPlanSummary(plan),
      expiresIn: CODE_TTL_MINUTES * 60,
    };
  }

  /** Public: re-send the verification code for a pending signup. */
  async resend(registrationId: string): Promise<{ ok: true; expiresIn: number }> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });
    if (!registration) {
      throw new NotFoundException('Registration not found');
    }
    if (registration.status !== 'PENDING') {
      throw new BadRequestException('This registration can no longer be verified');
    }

    const code = generateCode();
    await this.prisma.registration.update({
      where: { id: registration.id },
      data: {
        verificationCodeHash: hashToken(code),
        verificationExpiresAt: new Date(
          Date.now() + CODE_TTL_MINUTES * 60 * 1000,
        ),
        verificationAttempts: 0,
      },
    });

    await this.mailer.sendWorkspaceVerificationCode({
      to: registration.email,
      name: `${registration.firstName} ${registration.lastName}`,
      organisationName: registration.organisationName,
      code,
      expiresInMinutes: CODE_TTL_MINUTES,
    });

    return { ok: true, expiresIn: CODE_TTL_MINUTES * 60 };
  }

  /** Public: verify the code. Free plans provision immediately. */
  async verify(registrationId: string, code: string): Promise<VerifyOutcome> {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });
    if (!registration) {
      throw new NotFoundException('Registration not found');
    }
    if (registration.status === 'COMPLETED') {
      throw new BadRequestException('This workspace has already been created');
    }
    if (
      !registration.verificationCodeHash ||
      !registration.verificationExpiresAt ||
      registration.verificationExpiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'Your verification code has expired. Request a new one.',
      );
    }
    if (registration.verificationAttempts >= MAX_VERIFY_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Request a new code.',
      );
    }
    if (hashToken(code) !== registration.verificationCodeHash) {
      await this.prisma.registration.update({
        where: { id: registration.id },
        data: { verificationAttempts: { increment: 1 } },
      });
      throw new BadRequestException('That code is incorrect. Please try again.');
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: registration.planId },
    });
    if (!plan || !plan.isActive) {
      throw new BadRequestException('The selected plan is no longer available');
    }

    await this.prisma.registration.update({
      where: { id: registration.id },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verificationAttempts: 0,
      },
    });

    const requiresPayment =
      this.paymentsEnabled() && !plan.isFree && plan.priceMinorUnits > 0;

    if (requiresPayment) {
      return {
        completed: false,
        requiresPayment: true,
        plan: toPlanSummary(plan),
      };
    }

    const workspace = await this.provision(registration, plan, {
      provider: PaymentProvider.NONE,
    });

    return {
      completed: true,
      requiresPayment: false,
      redirectTo: '/dashboard',
      plan: toPlanSummary(plan),
      workspace,
    };
  }

  /** Platform admin: list signups, newest first. */
  async list(): Promise<RegistrationSummary[]> {
    const rows = await this.prisma.registration.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      organisationName: r.organisationName,
      organisationType:
        r.organisationType as RegistrationSummary['organisationType'],
      teamSize: r.teamSize,
      planCode: r.planCode,
      status: r.status as RegistrationSummary['status'],
      organisationId: r.organisationId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Provision the organisation, owner user, membership and active subscription
   * for a verified registration. Idempotent and race-safe: the registration is
   * atomically claimed (PENDING/VERIFIED → COMPLETED) inside the same
   * transaction that creates the rows, so a browser-verify and a payment
   * webhook arriving together can never both provision a signup.
   */
  async provision(
    registration: Registration,
    plan: Plan,
    payment: {
      provider: PaymentProvider;
      reference?: string;
      providerTxnId?: string;
      amountMinorUnits?: number;
      subscriptionStatus?: SubscriptionStatus;
    },
  ): Promise<ProvisionedWorkspace> {
    // Fast path: already provisioned by a previous call.
    if (
      registration.status === 'COMPLETED' &&
      registration.organisationId &&
      registration.userId
    ) {
      const existing = await this.findExistingWorkspace(registration, plan);
      if (existing) return existing;
    }

    const organisationId = randomUUID();
    const userId = randomUUID();
    const slug = `${slugify(registration.organisationName)}-${randomBytes(3).toString('hex')}`;
    const defaults =
      COUNTRY_DEFAULTS[registration.country] ??
      COUNTRY_DEFAULTS['NG'] ?? { currency: 'NGN', timezone: 'Africa/Lagos' };
    const now = new Date();
    const periodEndDate =
      plan.billingPeriod === 'ANNUALLY' || plan.billingPeriod === 'MONTHLY'
        ? periodEnd(now, plan.billingPeriod)
        : null;
    const isFree = plan.isFree || plan.priceMinorUnits === 0;

    const outcome = await this.prisma.withContext(
      { organisationId, userId },
      async (
        tx,
      ): Promise<{ created: true } | { existing: ProvisionedWorkspace }> => {
        // Atomic claim: only one concurrent call can flip PENDING/VERIFIED →
        // COMPLETED. Any loser returns the winner's workspace instead.
        const claim = await tx.registration.updateMany({
          where: { id: registration.id, status: { not: 'COMPLETED' } },
          data: { status: 'COMPLETED' },
        });

        if (claim.count === 0) {
          const latest = await tx.registration.findUnique({
            where: { id: registration.id },
          });
          if (!latest?.userId || !latest.organisationId) {
            throw new ConflictException(
              'Workspace provisioning is already in progress',
            );
          }
          const owner = await tx.user.findUnique({
            where: { id: latest.userId },
          });
          if (!owner) {
            throw new ConflictException(
              'Workspace provisioning is already in progress',
            );
          }
          return {
            existing: {
              organisationId: latest.organisationId,
              userId: owner.id,
              email: owner.email,
              firstName: owner.firstName,
              lastName: owner.lastName,
              isPlatformAdmin: owner.isPlatformAdmin,
              role: SystemRole.OWNER,
              planName: plan.name,
              planCode: plan.code,
            } as ProvisionedWorkspace,
          };
        }

        await tx.organisation.create({
          data: {
            id: organisationId,
            name: registration.organisationName,
            slug,
            type: registration.organisationType,
            country: registration.country,
            currency: defaults.currency,
            timezone: defaults.timezone,
          },
        });

        await tx.user.create({
          data: {
            id: userId,
            email: registration.email,
            firstName: registration.firstName,
            lastName: registration.lastName,
            passwordHash: registration.passwordHash,
            isActive: true,
          },
        });

        await tx.membership.create({
          data: {
            organisationId,
            userId,
            role: SystemRole.OWNER,
            acceptedAt: now,
            createdBy: userId,
          },
        });

        // Phase 3 (PAY-04): provision a default monthly pay calendar so a new
        // workspace can create its first pay run without extra setup. Admins can
        // edit or add more calendars later. Mirrors the demo seed.
        await tx.payCalendar.create({
          data: {
            organisationId,
            createdBy: userId,
            name: 'Monthly',
            frequency: PayFrequency.MONTHLY,
            dayOfMonth: 28,
            cutOffDayOfMonth: 25,
            isActive: true,
          },
        });

        await tx.subscription.create({
          data: {
            organisationId,
            planId: plan.id,
            status: isFree
              ? SubscriptionStatus.ACTIVE
              : (payment.subscriptionStatus ?? SubscriptionStatus.ACTIVE),
            provider: payment.provider,
            providerRef: payment.reference ?? null,
            currentPeriodStart: now,
            currentPeriodEnd: periodEndDate,
          },
        });

        await tx.registration.update({
          where: { id: registration.id },
          data: {
            status: 'COMPLETED',
            organisationId,
            userId,
          },
        });

        return { created: true };
      },
    );

    if ('existing' in outcome) {
      return outcome.existing;
    }

    await this.audit.record({
      action: AuditAction.WORKSPACE_CREATED,
      organisationId,
      actorId: userId,
      actorEmail: registration.email,
      targetType: 'organisation',
      targetId: organisationId,
      newValue: { planCode: plan.code, provider: payment.provider },
    });

    await this.mailer.sendWorkspaceReady({
      to: registration.email,
      name: `${registration.firstName} ${registration.lastName}`,
      organisationName: registration.organisationName,
      planName: plan.name,
    });

    this.logger.log(
      `Workspace provisioned for ${registration.email} (org ${slug}, plan ${plan.code})`,
    );

    return {
      organisationId,
      userId,
      email: registration.email,
      firstName: registration.firstName,
      lastName: registration.lastName,
      isPlatformAdmin: false,
      role: SystemRole.OWNER,
      planName: plan.name,
      planCode: plan.code,
    };
  }

  /** Return the already-provisioned workspace for a completed signup, if any. */
  private async findExistingWorkspace(
    registration: Registration,
    plan: Plan,
  ): Promise<ProvisionedWorkspace | null> {
    if (!registration.organisationId || !registration.userId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: registration.userId },
    });
    if (!user) return null;
    return {
      organisationId: registration.organisationId,
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isPlatformAdmin: user.isPlatformAdmin,
      role: SystemRole.OWNER,
      planName: plan.name,
      planCode: plan.code,
    };
  }

  async findByReferenceEmail(email: string): Promise<Registration | null> {
    return this.prisma.registration.findFirst({
      where: { email: email.trim().toLowerCase(), status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  get webAppUrl(): string {
    return (
      this.config.get<string>('WEB_APP_URL') ??
      this.config.get<string>('NEXT_PUBLIC_APP_URL') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }
}
