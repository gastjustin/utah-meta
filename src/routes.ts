/**
 * UtahMeta - Express router
 * All HTTP endpoints in one place: probe+decide+play, session CRUD,
 * and the actual stream endpoint. Mounted into index.ts.
 */

import { Router, Request, Response } from "express";
import { probeMediaFile } from "./ffprobe-integration";
import { decidePlaybackStrategy, CLIENT_CAPABILITIES } from "./direct-play-engine";
import { streamHandler, killStreamProcess } from "./ffmpeg-stream-engine";
import { scanLibrary } from "./library-scanner";
import {
  getSession,
  sessionExists,
  listSessions,
  createSession,
  updateSessionState,
  removeSession,
} from "./session-store";

export const router = Router();

// ---------- Trigger a library scan ----------
// Body: { rootPath? } — defaults to MEDIA_MOUNT_PATH env var (set in
// docker-compose.yml to match the container's mounted media volume).
// Minimal scanner: flat movie indexing only, no Series/Season grouping
// or metadata provider lookups yet — see library-scanner.ts for scope.
router.post("/library/scan", async (req: Request, res: Response) => {
  const rootPath = (req.body?.rootPath as string) ?? process.env.MEDIA_MOUNT_PATH;

  if (!rootPath) {
    return res.status(400).json({
      error: "rootPath is required (or set MEDIA_MOUNT_PATH env var)",
    });
  }

  try {
    const result = await scanLibrary(rootPath);
    res.status(200).json(result);
  } catch (err) {
    console.error("Library scan failed:", err);
    res.status(500).json({ error: "Scan failed", detail: String(err) });
  }
});

// ---------- Start playback: probe file, decide strategy, create session ----------
// Body: { userId, deviceId, mediaPath, clientId }
// clientId must match a key in CLIENT_CAPABILITIES (direct-play-engine.ts)
router.post("/play", async (req: Request, res: Response) => {
  const { userId, deviceId, mediaPath, clientId } = req.body as {
    userId: string;
    deviceId: string;
    mediaPath: string;
    clientId: string;
  };

  if (!userId || !deviceId || !mediaPath || !clientId) {
    return res.status(400).json({
      error: "userId, deviceId, mediaPath, and clientId are required",
    });
  }

  const client = CLIENT_CAPABILITIES[clientId];
  if (!client) {
    return res.status(400).json({
      error: `Unknown clientId "${clientId}". Known clients: ${Object.keys(CLIENT_CAPABILITIES).join(", ")}`,
    });
  }

  try {
    const media = await probeMediaFile(mediaPath);
    const decision = decidePlaybackStrategy(media, client);

    const session = await createSession({
      userId,
      deviceId,
      mediaPath,
      decision,
      durationSeconds: 0, // populate from ffprobe format.duration if you extend MediaProfile
    });

    res.status(201).json({
      session,
      streamUrl: `/stream/${session.sessionId}`,
    });
  } catch (err) {
    console.error("Failed to start playback:", err);
    res.status(500).json({ error: "Failed to probe or start stream", detail: String(err) });
  }
});

// ---------- Actual media stream ----------
router.get("/stream/:sessionId", async (req: Request, res: Response) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found" });

  try {
    const media = await probeMediaFile(session.mediaPath);
    const handler = streamHandler(media, session.decision, session.sessionId);
    handler(req, res);
  } catch (err) {
    console.error(`Failed to stream session ${session.sessionId}:`, err);
    res.status(500).end("Stream failed");
  }
});

// ---------- Session control (pause/resume/seek) ----------
router.patch("/sessions/:id", async (req: Request, res: Response) => {
  const { state, positionSeconds } = req.body as {
    state?: "playing" | "paused" | "buffering" | "stopped";
    positionSeconds?: number;
  };
  const session = await updateSessionState(req.params.id, { state, positionSeconds });
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

// ---------- Stop a session ----------
router.delete("/sessions/:id", async (req: Request, res: Response) => {
  if (!(await sessionExists(req.params.id))) {
    return res.status(404).json({ error: "Session not found" });
  }
  killStreamProcess(req.params.id);
  await removeSession(req.params.id);
  res.status(204).send();
});

router.get("/sessions/:id", async (req: Request, res: Response) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

router.get("/sessions", async (_req: Request, res: Response) => {
  res.json(await listSessions());
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});
