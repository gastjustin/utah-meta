/**
 * UtahMeta - Phase 3/hybrid: Redis-backed Session Store
 *
 * Replaces the earlier in-memory Map. Sessions are stored as Redis
 * hashes with a safety-net TTL (so a crashed process can't leave a
 * "ghost" session stuck forever), and every change is published to a
 * pub/sub channel that the WebSocket layer relays to connected clients.
 *
 * Using pub/sub (rather than broadcasting directly from process memory)
 * means this also works correctly if you ever run more than one
 * UtahMeta instance behind a load balancer — a session started on node A
 * shows up in real time on a client connected to node B. That wasn't
 * possible with the in-memory Map.
 */

import { randomUUID } from "crypto";
import { redis, redisSub } from "./redis";
import { syncWatchState } from "./watch-state-sync";
import type { PlaybackDecision } from "./direct-play-engine";

export type PlaybackState = "playing" | "paused" | "buffering" | "stopped";

export interface PlaybackSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  mediaItemId?: string;
  clientType?: string;
  mediaPath: string;
  decision: PlaybackDecision;
  state: PlaybackState;
  positionSeconds: number;
  durationSeconds: number;
  startedAt: string;
  updatedAt: string;
  audioTrackIndex?: number;
  subtitleTrackIndex?: number | "off";
}

const SESSION_KEY_PREFIX = "session:";
const ACTIVE_SESSIONS_SET = "sessions:active";
const SESSION_EVENTS_CHANNEL = "session-events";

// Safety-net TTL: if a session isn't touched (state update, or the
// stream engine's periodic heartbeat) for this long, Redis expires it
// automatically. Prevents orphaned "playing forever" sessions if a
// server process dies mid-stream without a clean shutdown.
const SESSION_TTL_SECONDS = 60 * 60 * 6; // 6 hours

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

async function publish(event: string, session: PlaybackSession) {
  await redis.publish(SESSION_EVENTS_CHANNEL, JSON.stringify({ event, session }));
}

// ---------- CRUD ----------

export async function createSession(
  input: Omit<
    PlaybackSession,
    "sessionId" | "state" | "positionSeconds" | "startedAt" | "updatedAt"
  >,
  sessionId: string = randomUUID()
): Promise<PlaybackSession> {
  const now = new Date().toISOString();
  const session: PlaybackSession = {
    ...input,
    sessionId,
    state: "buffering",
    positionSeconds: 0,
    startedAt: now,
    updatedAt: now,
  };

  await redis
    .multi()
    .set(sessionKey(sessionId), JSON.stringify(session), "EX", SESSION_TTL_SECONDS)
    .sadd(ACTIVE_SESSIONS_SET, sessionId)
    .exec();

  await publish("SESSION_STARTED", session);
  return session;
}

export async function getSession(sessionId: string): Promise<PlaybackSession | null> {
  const raw = await redis.get(sessionKey(sessionId));
  return raw ? (JSON.parse(raw) as PlaybackSession) : null;
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  return (await redis.exists(sessionKey(sessionId))) === 1;
}

export async function listSessions(): Promise<PlaybackSession[]> {
  const ids = await redis.smembers(ACTIVE_SESSIONS_SET);
  if (ids.length === 0) return [];

  const raws = await redis.mget(ids.map(sessionKey));
  const results: PlaybackSession[] = [];
  const staleIds: string[] = [];

  raws.forEach((raw, i) => {
    if (raw) {
      results.push(JSON.parse(raw));
    } else {
      // Key expired via TTL but the set entry lingered — clean it up.
      staleIds.push(ids[i]);
    }
  });

  if (staleIds.length > 0) {
    await redis.srem(ACTIVE_SESSIONS_SET, ...staleIds);
  }

  return results;
}

export async function updateSessionState(
  sessionId: string,
  patch: Partial<Pick<PlaybackSession, "state" | "positionSeconds">>,
  event: string = "SESSION_UPDATED"
): Promise<PlaybackSession | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  if (patch.state) session.state = patch.state;
  if (typeof patch.positionSeconds === "number") {
    session.positionSeconds = patch.positionSeconds;
  }
  session.updatedAt = new Date().toISOString();

  // Refresh TTL on every touch — an actively-updating session should
  // never expire mid-stream; only a genuinely abandoned one should.
  await redis.set(sessionKey(sessionId), JSON.stringify(session), "EX", SESSION_TTL_SECONDS);

  // Sync on pause too, not just full stop — this way a resume point
  // exists even if the session later expires via TTL without a clean
  // DELETE (e.g. client crashed, network dropped). Best-effort, never
  // blocks the Redis update above.
  if (patch.state === "paused") {
    try {
      await syncWatchState(session);
    } catch (err) {
      console.error(`[session-store] failed to sync WatchState for session ${sessionId}:`, err);
    }
  }

  await publish(event, session);
  return session;
}

export async function removeSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;

  session.state = "stopped";
  session.updatedAt = new Date().toISOString();

  // Best-effort durable write. This must never block or fail the Redis
  // cleanup below — if Postgres is down, the session still needs to be
  // removed from the live/active set. Errors are logged, not thrown.
  try {
    await syncWatchState(session);
  } catch (err) {
    console.error(`[session-store] failed to sync WatchState for session ${sessionId}:`, err);
  }

  await redis
    .multi()
    .del(sessionKey(sessionId))
    .srem(ACTIVE_SESSIONS_SET, sessionId)
    .exec();

  await publish("SESSION_STOPPED", session);
}

// ---------- WebSocket relay ----------
// Subscribes once to the Redis pub/sub channel and fans out to every
// connected WebSocket client. Call attachSessionWebSocket(httpServer)
// once at boot.

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

export function attachSessionWebSocket(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer });

  redisSub.subscribe(SESSION_EVENTS_CHANNEL, (err) => {
    if (err) console.error("[redis] failed to subscribe to session events:", err);
  });

  redisSub.on("message", (_channel, message) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  wss.on("connection", async (ws) => {
    const sessions = await listSessions();
    ws.send(JSON.stringify({ event: "SNAPSHOT", sessions }));
  });

  return wss;
}
