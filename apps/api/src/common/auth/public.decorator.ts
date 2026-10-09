// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC DECORATOR
// Marks a route (or controller) as reachable without authentication. The global
// JwtAuthGuard skips auth for anything marked `@Public()`.
// ─────────────────────────────────────────────────────────────────────────────
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
