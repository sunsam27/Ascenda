import { NextResponse, type NextRequest } from 'next/server';

// SECURITY.md §2: session tokens live in HttpOnly cookies. The middleware only
// checks for their presence to gate client-side routing; the API remains the
// source of truth for authentication and authorisation.
const ACCESS_COOKIE = 'ascenda_at';
// Non-HttpOnly marker set alongside the tokens — present for the lifetime of the
// refresh token, so we can let an expired-access request through to be refreshed.
const SESSION_COOKIE = 'ascenda_session';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/me',
  '/people',
  '/time-leave',
  '/payroll',
  '/payments',
  '/documents',
  '/analytics',
  '/settings',
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(
    request.cookies.get(ACCESS_COOKIE) ?? request.cookies.get(SESSION_COOKIE),
  );

  if (isProtected(pathname) && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/me/:path*',
    '/people/:path*',
    '/time-leave/:path*',
    '/payroll/:path*',
    '/payments/:path*',
    '/documents/:path*',
    '/analytics/:path*',
    '/settings/:path*',
  ],
};
