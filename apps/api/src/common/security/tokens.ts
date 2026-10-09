// ─────────────────────────────────────────────────────────────────────────────
// SECURITY TOKENS
// Opaque single-use tokens (invitations). The raw value is only ever sent to the
// recipient; the database stores its SHA-256 hash so a database leak cannot be
// replayed. SECURITY.md §2 / §8.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash, randomBytes } from 'crypto';

/** Generates a 256-bit URL-safe token. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/** Stable SHA-256 hex digest used for at-rest token lookups. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
