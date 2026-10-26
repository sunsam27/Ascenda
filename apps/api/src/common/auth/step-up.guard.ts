import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { stepUpSecret } from '../../modules/identity-access/identity-access.service';

export const STEP_UP_HEADER = 'x-step-up-token';

interface StepUpPayload {
  sub?: string;
  purpose?: string;
  organisationId?: string | null;
  exp?: number;
}

/**
 * SECURITY.md §2: sensitive payroll actions require a fresh re-authentication.
 * Clients obtain a 5-minute token from `POST /auth/step-up` and send it in
 * `x-step-up-token`. Step-up tokens are signed with a distinct secret so they
 * can never be replayed as access tokens.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      Request & {
        user?: { sub?: string; organisationId?: string };
        headers: Record<string, string | string[] | undefined>;
      }
    >();

    const raw = req.headers[STEP_UP_HEADER];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) {
      throw new ForbiddenException(
        'Re-authentication required: provide a step-up token',
      );
    }

    let payload: StepUpPayload;
    try {
      payload = this.jwt.verify<StepUpPayload>(token, {
        secret: stepUpSecret(this.config.get<string>('JWT_ACCESS_SECRET')),
      });
    } catch {
      throw new ForbiddenException('Step-up token is invalid or expired');
    }

    if (payload.purpose !== 'step_up') {
      throw new ForbiddenException('Step-up token has the wrong purpose');
    }
    if (!req.user?.sub || payload.sub !== req.user.sub) {
      throw new ForbiddenException('Step-up token does not belong to this user');
    }
    if (
      payload.organisationId &&
      req.user.organisationId &&
      payload.organisationId !== req.user.organisationId
    ) {
      throw new ForbiddenException('Step-up token is for another organisation');
    }

    return true;
  }
}
