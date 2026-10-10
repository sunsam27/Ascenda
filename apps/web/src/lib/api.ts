import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

/**
 * Shared API client. The SPA calls the API same-origin through the Next.js
 * rewrites in next.config.ts (source `/api/:path*` → the API), so the browser
 * never makes cross-origin requests. `withCredentials` ensures the HttpOnly
 * auth cookies set by the API (SECURITY.md §2) are sent on every request.
 */
const baseURL = '/api/v1';

export const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// A bare client for the refresh call so it never re-enters our interceptor.
const refreshClient = axios.create({ baseURL, withCredentials: true });

const SESSION_COOKIE = 'ascenda_session';
const REFRESH_SKEW_MS = 60 * 1000; // refresh 60s before the access token expires

/** Access-token expiry (epoch ms) from the non-HttpOnly session marker, or null. */
export function getSessionExpiry(): number | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  );
  if (!match) return null;
  const raw = match[1];
  if (!raw) return null;
  const value = Number(decodeURIComponent(raw));
  return Number.isFinite(value) ? value : null;
}

export function hasSession(): boolean {
  return getSessionExpiry() !== null;
}

let refreshPromise: Promise<void> | null = null;

/**
 * Rotate the refresh token and refresh the access cookie. Concurrent callers
 * share a single in-flight request (single-flight).
 */
export function refreshSession(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post('/auth/refresh')
      .then(() => undefined)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/login') return;
  window.location.href = '/login';
}

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// On a 401, try exactly one silent refresh then replay the original request.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';
    const isAuthEndpoint =
      url.includes('/auth/refresh') || url.includes('/auth/login');

    if (status === 401 && original && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        redirectToLogin();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
