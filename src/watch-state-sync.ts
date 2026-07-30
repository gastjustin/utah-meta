/**
 * UtahMeta - WatchState Sync
 *
 * The one place the two stores actually talk to each other. A
 * PlaybackSession in Redis is ephemeral and identified by raw values
 * (userId as an external auth subject, mediaPath as a filesystem path).
 * WatchState in Postgres is durable and identified by real foreign keys
 * (UserProfile.userId, MediaItem.mediaItemId).
 *
 * This module resolves the ephemeral -> durable identifiers and writes
 * the final resume point when a session ends.
 *
 * IMPORTANT: until Phase 4 builds the library scanner, FileAsset rows
 * won't exist for most files, so resolution will legitimately miss most
 * of the time right now. That's expected — this fails soft (logs and
 * skips) rather than throwing, since a missing library index isn't an
 * error condition at this phase.
 */

import { prisma } from "./db";
import type { PlaybackSession } from "./session-store";

// Treat playback as "completed" once past this fraction of runtime —
// avoids leaving something at 99% forever just because the user closed
// the tab a few seconds before the credits rolled.
const COMPLETED_THRESHOLD = 0.95;

// ---------- Identifier resolution ----------

async function resolveMediaItemId(mediaPath: string): Promise<string | null> {
  const fileAsset = await prisma.fileAsset.findUnique({
    where: { sourcePath: mediaPath },
    select: { mediaItemId: true },
  });
  return fileAsset?.mediaItemId ?? null;
}

// Sessions carry userId as an external identifier (e.g. from your auth
// system, or just a raw string for now). Map it to a durable
// UserProfile row, creating one on first sight. This makes the sync
// resilient to running before any real user-provisioning flow exists.
async function resolveUserId(externalUserId: string): Promise<string> {
  const user = await prisma.userProfile.upsert({
    where: { authSubject: externalUserId },
    update: {},
    create: {
      authSubject: externalUserId,
      displayName: externalUserId,
    },
    select: { userId: true },
  });
  return user.userId;
}

// ---------- Core sync ----------

export async function syncWatchState(session: PlaybackSession): Promise<void> {
  // Nothing meaningful to record if playback never actually progressed.
  if (session.positionSeconds <= 0) return;

  const mediaItemId = await resolveMediaItemId(session.mediaPath);
  if (!mediaItemId) {
    // Expected and common until Phase 4's library scanner populates
    // FileAsset rows. Not an error — just nothing to attach this to yet.
    console.debug(
      `[watch-state-sync] no FileAsset found for "${session.mediaPath}" — skipping WatchState write`
    );
    return;
  }

  const userId = await resolveUserId(session.userId);

  const completed =
    session.durationSeconds > 0 &&
    session.positionSeconds / session.durationSeconds >= COMPLETED_THRESHOLD;

  await prisma.watchState.upsert({
    where: {
      userId_mediaItemId: { userId, mediaItemId },
    },
    update: {
      positionMs: Math.round(session.positionSeconds * 1000),
      completed,
      lastWatchedAt: new Date(),
    },
    create: {
      userId,
      mediaItemId,
      positionMs: Math.round(session.positionSeconds * 1000),
      completed,
      lastWatchedAt: new Date(),
    },
  });
}
