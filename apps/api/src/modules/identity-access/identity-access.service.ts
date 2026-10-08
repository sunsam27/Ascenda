// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY ACCESS SERVICE
// Handles login, registration, token refresh, MFA stub, password rules.
// SECURITY.md §2: Argon2id, breached-password check, MFA for admin roles.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { LoginDto, AuthTokens } from '@ascenda/types';

const MIN_PASSWORD_LENGTH = 12;

// TODO: Integrate with Have I Been Pwned API or local breached-password list
async function isBreachedPassword(_password: string): Promise<boolean> {
  return false;
}

@Injectable()
export class IdentityAccessService {
  private readonly logger = new Logger(IdentityAccessService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Validate credentials for Passport LocalStrategy.
   * Returns user payload without password hash.
   */
  async validateUser(email: string, password: string) {
    // TODO: Query User from DB via PrismaService
    // const user = await this.prisma.user.findUnique({ where: { email } });
    // if (!user || !user.isActive) return null;
    // const valid = await argon2.verify(user.passwordHash, password);
    // if (!valid) return null;
    // return { id: user.id, email: user.email, ... };

    this.logger.warn(`validateUser called for ${email} — DB not connected yet`);
    return null;
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.validateUser(dto.email, dto.password);
    if (!user) {
      // SECURITY.md §2: Generic error — no account enumeration
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.generateTokens(user as Record<string, unknown>);
  }

  async refreshToken(token: string): Promise<AuthTokens> {
    try {
      const payload = this.jwt.verify<Record<string, unknown>>(token, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
      return this.generateTokens(payload);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) {
    if (data.password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }

    if (await isBreachedPassword(data.password)) {
      throw new BadRequestException(
        'This password has appeared in a data breach. Please choose a different password.',
      );
    }

    const hash = await argon2.hash(data.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    // TODO: Create user in DB
    // const user = await this.prisma.user.create({ data: { email, passwordHash: hash, ... } });
    this.logger.log(`Register called for ${data.email} — hash generated but DB not connected`);

    return { message: 'Account created. Please verify your email.' };
  }

  private generateTokens(payload: Record<string, unknown>): AuthTokens {
    const { passwordHash, mfaSecret, ...safePayload } = payload;
    void passwordHash; void mfaSecret;

    const accessToken = this.jwt.sign(safePayload, {
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    const refreshToken = this.jwt.sign(safePayload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    return { accessToken, refreshToken, expiresIn: 900 };
  }
}
