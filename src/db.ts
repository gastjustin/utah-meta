/**
 * UtahMeta - Prisma client singleton
 * Source of truth for durable relational data (Library, MediaItem,
 * Users, WatchState, etc.) per prisma/schema.prisma.
 *
 * Run `npm run prisma:generate` after any schema change, and
 * `npm run prisma:migrate` to apply migrations to Postgres.
 */

import { PrismaClient } from "@prisma/client";

// Reuse a single client across hot reloads in dev (tsx watch) to avoid
// exhausting Postgres connections.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
