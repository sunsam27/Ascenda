import type { NextConfig } from 'next';

// Next.js dev (webpack react-refresh) needs eval; production keeps a strict CSP.
const isDev = process.env.NODE_ENV !== 'production';

const apiUrl =
  process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';
const apiOrigin = new URL(apiUrl).origin;

const contentSecurityPolicy = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  // The SPA calls the API on a different origin (and uses HMR websockets in dev).
  `connect-src 'self' ${apiOrigin}${isDev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // Mobile-first — images should be optimised
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.amazonaws.com' },
      { protocol: 'https', hostname: '*.cloudflare.com' },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  // Type-safe env vars
  env: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1',
    NEXT_PUBLIC_APP_NAME: process.env['NEXT_PUBLIC_APP_NAME'] ?? 'Ascenda',
  },

  // Strict mode for better dev warnings
  reactStrictMode: true,

  // Security headers per SECURITY.md §9
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
