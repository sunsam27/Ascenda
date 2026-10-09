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
import { AuditAction } from '@ascenda/db';
import type { InvitationDetails } from '@ascenda/types';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashToken } from '../../common/security/tokens';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';

const MIN_PASSWORD_LENGTH = 12;
const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes

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
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

    return { ...tokens, user, redirectTo: '/dashboard' };
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
      redirectTo: '/dashboard',
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
      redirectTo: '/dashboard',
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
      redirectTo: '/dashboard',
    };
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
