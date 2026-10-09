// ─────────────────────────────────────────────────────────────────────────────
// AUTH COOKIES
// Shared cookie writer so both login/set-password and self-serve signup issue
// identical sessions. SECURITY.md §2: tokens live in HttpOnly cookies.
// ─────────────────────────────────────────────────────────────────────────────
import type { Response } from 'express';

export const ACCESS_COOKIE = 'ascenda_at';
export const REFRESH_COOKIE = 'ascenda_rt';
export const SESSION_COOKIE = 'ascenda_session';
export const REFRESH_PATH = '/api/v1/auth';
export const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
export const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

/** Set the access/refresh/session cookies for an authenticated user. */
export function writeAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
): void {
  const opts = baseCookieOptions();
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...opts,
    path: '/',
    maxAge: ACCESS_MAX_AGE_MS,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...opts,
    path: REFRESH_PATH,
    maxAge: REFRESH_MAX_AGE_MS,
  });
  res.cookie(SESSION_COOKIE, String(Date.now() + ACCESS_MAX_AGE_MS), {
    httpOnly: false, // readable by the client to schedule silent refresh
    sameSite: 'lax' as const,
    secure: opts.secure,
    path: '/',
    maxAge: REFRESH_MAX_AGE_MS,
  });
}

export function readCookie(
  req: { headers: { cookie?: string } },
  name: string,
): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}
