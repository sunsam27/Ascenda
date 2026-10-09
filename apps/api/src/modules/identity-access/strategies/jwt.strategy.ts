import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const ACCESS_COOKIE = 'ascenda_at';

/**
 * Read the access token from the HttpOnly cookie first (browser sessions),
 * falling back to a Bearer header (API clients). SECURITY.md §2.
 */
function cookieExtractor(req: Request): string | null {
  const header = req?.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === ACCESS_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET', 'fallback-secret'),
    });
  }

  validate(payload: Record<string, unknown>) {
    // Payload is the decoded JWT. Attached to the request as req.user.
    return payload;
  }
}
