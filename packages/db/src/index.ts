// ─────────────────────────────────────────────────────────────────────────────
// ASCENDA — Database Package
// Re-exports the generated Prisma client and exposes a shared singleton.
// The API uses its own Nest-managed PrismaService; this singleton is for
// scripts, seeds and other non-Nest consumers.
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
