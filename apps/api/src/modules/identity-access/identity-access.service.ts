// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY ACCESS SERVICE
// Handles login, registration, token refresh and MFA stub.
// SECURITY.md §2: Argon2id, breached-password check, MFA for admin roles,
// short-lived access tokens with rotating refresh tokens.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuditAction, SystemRole } from '@ascenda/db';
import type { InvitationDetails } from '@ascenda/types';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateOpaqueToken, hashToken } from '../../common/security/tokens';
import { MailerService } from '../../common/mailer/mailer.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';

const MIN_PASSWORD_LENGTH = 12;
const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const STEP_UP_TTL_SECONDS = 5 * 60; // 5 minutes
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Step-up tokens are signed with a distinct secret so they cannot be used as access tokens. */
export function stepUpSecret(base: string | undefined): string {
  return `${base ?? 'fallback-secret'}:step-up`;
}

/**
 * Where a signed-in member lands after auth. Self-service roles get their own
 * dashboard (`/me`) rather than the organisation view, so employees never see
 * other workers' data.
 */
export function homePathForRole(role: string | undefined | null): string {
  return role === SystemRole.EMPLOYEE_SELF || role === SystemRole.VOLUNTEER_SELF
    ? '/me'
    : '/dashboard';
}

// TODO: Integrate with Have I Been Pwned API or local breached-password list
async function isBreachedPassword(_password: string): Promise<boolean> {
  return false;
}

export interface SafeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  isMfaEnabled: boolean;
  isPlatformAdmin: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResult extends AuthTokens {
  user: SafeUser;
  redirectTo: string;
}

@Injectable()
export class IdentityAccessService {
  private readonly logger = new Logger(IdentityAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Validate credentials for Passport LocalStrategy.
   * Returns a safe user (no password hash) or null.
   */
  async validateUser(
    email: string,
    password: string,
  ): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user || !user.isActive) {
      return null;
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      return null;
    }

    return this.toSafeUser(user);
  }

  /** PRD: AUTH-01 — Login with email and password */
  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.validateUser(dto.email, dto.password);
    if (!user) {
      // Deliberately generic — no account enumeration
      await this.recordLoginFailure(dto.email);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Pick the tenant context: explicit org, else the user's first active one.
    // Memberships are RLS-protected; the self-read policy needs the user id.
    const membership = await this.prisma.withContext({ userId: user.id }, (tx) =>
      tx.membership.findFirst({
        where: {
          userId: user.id,
          isActive: true,
          ...(dto.organisationId
            ? { organisationId: dto.organisationId }
            : {}),
        },
        orderBy: { createdAt: 'asc' },
      }),
    );

    const tokens = this.generateTokens({
      sub: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformAdmin: user.isPlatformAdmin,
      ...(membership
        ? { organisationId: membership.organisationId, role: membership.role }
        : {}),
    });

    await this.audit.record({
      action: AuditAction.LOGIN,
      organisationId: membership?.organisationId,
      actorId: user.id,
      actorEmail: user.email,
      targetType: 'session',
      targetId: user.id,
    });

    this.logger.log(`User ${user.email} signed in`);

    return {
      ...tokens,
      user,
      redirectTo: homePathForRole(membership?.role),
    };
  }

  /**
   * Best-effort audit for failed logins (SECURITY.md §8). Needs a tenant to
   * satisfy the audit_log FK/RLS, so it is skipped when the email is unknown or
   * the user has no active membership. Never affects the response.
   */
  private async recordLoginFailure(email: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
      });
      if (!user) return;

      const membership = await this.prisma.withContext(
        { userId: user.id },
        (tx) =>
          tx.membership.findFirst({
            where: { userId: user.id, isActive: true },
            orderBy: { createdAt: 'asc' },
          }),
      );
      if (!membership) return;

      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        organisationId: membership.organisationId,
        actorId: user.id,
        actorEmail: user.email,
        targetType: 'session',
        targetId: user.id,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record login failure: ${(error as Error).message}`,
      );
    }
  }

  /** PRD: AUTH-03 — Rotate refresh token and issue a new access token */
  async refresh(refreshToken: string): Promise<LoginResult> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        refreshToken,
        { secret: this.config.get<string>('JWT_REFRESH_SECRET') },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const userId = payload['sub'] as string | undefined;
    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : null;

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = this.generateTokens(payload);

    return {
      ...tokens,
      user: this.toSafeUser(user),
      redirectTo: homePathForRole(payload['role'] as string | undefined),
    };
  }

  /** Public: fetch the safe details of a pending invitation for the UI. */
  async getInvitation(rawToken: string): Promise<InvitationDetails> {
    const invitation = await this.findValidInvitation(rawToken);
    const organisation = await this.prisma.withContext(
      { organisationId: invitation.organisationId },
      (tx) =>
        tx.organisation.findUnique({
          where: { id: invitation.organisationId },
          select: { name: true },
        }),
    );

    return {
      email: invitation.email,
      organisationName: organisation?.name ?? 'your organisation',
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Public: set the password for an invited user, activate their membership and
   * return a signed-in session (auto-login). The invitation is single-use.
   */
  async setPassword(rawToken: string, password: string): Promise<LoginResult> {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    if (await isBreachedPassword(password)) {
      throw new BadRequestException(
        'This password has appeared in a data breach. Please choose a different password.',
      );
    }

    const invitation = await this.findValidInvitation(rawToken);

    const user = await this.prisma.user.findUnique({
      where: { email: invitation.email },
    });
    if (!user || !user.isActive) {
      throw new BadRequestException('This invitation is no longer valid.');
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // Tenant context is required to update the membership and write the
    // (RLS-protected) audit entry. The invitation itself is not tenant-scoped.
    const membership = await this.prisma.withContext(
      { organisationId: invitation.organisationId, userId: user.id },
      async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });
        return tx.membership.findFirst({
          where: { organisationId: invitation.organisationId, userId: user.id },
          orderBy: { createdAt: 'asc' },
        });
      },
    );

    if (membership) {
      await this.prisma.withContext(
        { organisationId: invitation.organisationId, userId: user.id },
        (tx) =>
          tx.membership.update({
            where: { id: membership.id },
            data: { acceptedAt: new Date(), isActive: true },
          }),
      );
    }

    await this.audit.record({
      action: AuditAction.PASSWORD_SET,
      organisationId: invitation.organisationId,
      actorId: user.id,
      actorEmail: user.email,
      targetType: 'user',
      targetId: user.id,
    });

    const fresh = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!fresh) {
      throw new BadRequestException('This invitation is no longer valid.');
    }

    const tokens = this.generateTokens({
      sub: fresh.id,
      email: fresh.email,
      firstName: fresh.firstName,
      lastName: fresh.lastName,
      platformAdmin: fresh.isPlatformAdmin,
      organisationId: invitation.organisationId,
      role: membership?.role,
    });

    this.logger.log(`User ${fresh.email} activated their account`);

    return {
      ...tokens,
      user: this.toSafeUser(fresh),
      redirectTo: homePathForRole(membership?.role),
    };
  }

  private async findValidInvitation(rawToken: string) {
    const token = rawToken?.trim();
    if (!token) {
      throw new BadRequestException('Missing invitation token.');
    }

    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'This invitation is invalid or has expired.',
      );
    }

    return invitation;
  }

  /**
   * Invite a person to the workspace (PRD PPL onboarding / AUTH-02). Creates or
   * reuses their platform user, ensures an organisation membership, issues a
   * single-use invitation and emails the set-password link. Any outstanding
   * invitation for the same address is superseded. The caller is responsible
   * for linking the invitation to a domain record (e.g. a worker).
   */
  async inviteToWorkspace(params: {
    organisationId: string;
    actorId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  }): Promise<{ userId: string; email: string; emailSent: boolean }> {
    const email = params.email.trim().toLowerCase();
    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    // Unguessable placeholder so the account is unusable until the invitee
    // chooses their own password through the set-password link.
    const placeholderHash = await argon2.hash(generateOpaqueToken());

    const { userId, organisationName } = await this.prisma.withContext(
      { organisationId: params.organisationId, userId: params.actorId },
      async (tx) => {
        const organisation = await tx.organisation.findFirst({
          select: { name: true },
        });

        let user = await tx.user.findUnique({ where: { email } });
        if (!user) {
          user = await tx.user.create({
            data: {
              email,
              firstName: params.firstName || email,
              lastName: params.lastName,
              passwordHash: placeholderHash,
              isActive: true,
            },
          });
        } else if (!user.isActive) {
          throw new BadRequestException(
            'An account with this email already exists but is deactivated.',
          );
        }

        const membership = await tx.membership.findFirst({
          where: { organisationId: params.organisationId, userId: user.id },
        });
        if (!membership) {
          await tx.membership.create({
            data: {
              organisationId: params.organisationId,
              userId: user.id,
              role: params.role as SystemRole,
              createdBy: params.actorId,
            },
          });
        }

        await tx.invitation.deleteMany({
          where: {
            organisationId: params.organisationId,
            email,
            acceptedAt: null,
          },
        });

        await tx.invitation.create({
          data: {
            organisationId: params.organisationId,
            email,
            role: params.role as SystemRole,
            tokenHash,
            expiresAt,
            createdBy: params.actorId,
          },
        });

        return {
          userId: user.id,
          organisationName: organisation?.name ?? 'your organisation',
        };
      },
    );

    const inviteUrl = `${this.webAppUrl()}/set-password?token=${rawToken}`;
    const emailSent = await this.mailer.sendInvitation({
      to: email,
      organisationName,
      inviteUrl,
      expiresAt,
    });

    await this.audit.record({
      action: AuditAction.INVITATION_SENT,
      organisationId: params.organisationId,
      actorId: params.actorId,
      targetType: 'user',
      targetId: userId,
      newValue: { email, role: params.role, emailSent },
    });

    return { userId, email, emailSent };
  }

  private webAppUrl(): string {
    return (
      this.config.get<string>('WEB_APP_URL') ??
      this.config.get<string>('NEXT_PUBLIC_APP_URL') ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  /**
   * Issue a signed-in session for a freshly provisioned workspace owner
   * (self-serve signup). The caller is responsible for writing the cookies.
   */
  issueSessionForOwner(input: {
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
      isMfaEnabled: boolean;
      isPlatformAdmin: boolean;
    };
    organisationId: string;
    role: string;
  }): LoginResult {
    const tokens = this.generateTokens({
      sub: input.user.id,
      email: input.user.email,
      firstName: input.user.firstName,
      lastName: input.user.lastName,
      platformAdmin: input.user.isPlatformAdmin,
      organisationId: input.organisationId,
      role: input.role,
    });

    return {
      ...tokens,
      user: this.toSafeUser(input.user),
      redirectTo: homePathForRole(input.role),
    };
  }

  /**
   * SECURITY.md §2: re-authenticate before changing bank details, approving
   * payroll/payments or exporting payroll data. Returns a short-lived,
   * purpose-scoped token the caller must send in `x-step-up-token`.
   */
  async stepUp(input: {
    userId: string;
    organisationId?: string;
    password: string;
    mfaCode?: string;
  }): Promise<{ token: string; expiresIn: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Unable to re-authenticate');
    }

    const validPassword = await argon2.verify(user.passwordHash, input.password);
    if (!validPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isMfaEnabled) {
      if (!input.mfaCode || !user.mfaSecret) {
        throw new BadRequestException('MFA code is required');
      }
      const validMfa = authenticator.check(input.mfaCode, user.mfaSecret);
      if (!validMfa) {
        throw new UnauthorizedException('Invalid MFA code');
      }
    }

    const token = this.jwt.sign(
      {
        sub: user.id,
        purpose: 'step_up',
        organisationId: input.organisationId ?? null,
      },
      {
        secret: stepUpSecret(this.config.get<string>('JWT_ACCESS_SECRET')),
        expiresIn: STEP_UP_TTL_SECONDS,
      },
    );

    await this.audit.record({
      action: AuditAction.STEP_UP_AUTHENTICATED,
      organisationId: input.organisationId,
      actorId: user.id,
      targetType: 'user',
      targetId: user.id,
      newValue: { mfa: user.isMfaEnabled },
    });

    return { token, expiresIn: STEP_UP_TTL_SECONDS };
  }

  private toSafeUser(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    isMfaEnabled: boolean;
    isPlatformAdmin: boolean;
  }): SafeUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      isMfaEnabled: user.isMfaEnabled,
      isPlatformAdmin: user.isPlatformAdmin,
    };
  }

  private generateTokens(payload: Record<string, unknown>): AuthTokens {
    const { passwordHash, mfaSecret, iat, exp, ...safePayload } = payload;
    void passwordHash;
    void mfaSecret;
    void iat;
    void exp;

    const accessToken = this.jwt.sign(safePayload, {
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    const refreshToken = this.jwt.sign(safePayload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }
}
