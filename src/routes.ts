/**
 * UtahMeta - Express router
 * All HTTP endpoints in one place: probe+decide+play, session CRUD,
 * and the actual stream endpoint. Mounted into index.ts.
 */

import { Router, Request, Response } from "express";
import { resolve, sep } from "path";
import { prisma } from "./db";
import { probeMediaFile } from "./ffprobe-integration";
import { decidePlaybackStrategy, CLIENT_CAPABILITIES } from "./direct-play-engine";
import { streamHandler, killStreamProcess } from "./ffmpeg-stream-engine";
import { scanLibrary } from "./library-scanner";
import {
  getOrCreateCompatibilityProfile,
  findReadyVariant,
  queuePrepJob,
  runPrepJob,
} from "./preparation-engine";
import { generateEncryptionKey } from "./encryption";
import {
  getSession,
  sessionExists,
  listSessions,
  createSession,
  updateSessionState,
  removeSession,
} from "./session-store";

// ---------- mediaPath allow-list ----------
// A mediaPath may only point at files under a configured library root,
// the MEDIA_MOUNT_PATH env var, or the PREPARED_MEDIA_PATH where pre-
// transcoded variants live. This prevents a crafted request from asking
// the server to ffprobe/stream arbitrary files outside these roots.
// Paths must be absolute; relative paths are rejected.

async function getAllowedMediaRoots(): Promise<string[]> {
  const roots = new Set<string>();
  if (process.env.MEDIA_MOUNT_PATH) roots.add(process.env.MEDIA_MOUNT_PATH);
  if (process.env.PREPARED_MEDIA_PATH) roots.add(process.env.PREPARED_MEDIA_PATH);

  const libraries = await prisma.library.findMany({
    select: { rootPath: true },
  });
  for (const lib of libraries) roots.add(lib.rootPath);

  return Array.from(roots).map((r) => resolve(r));
}

async function isWithinAllowedMediaRoot(mediaPath: string): Promise<boolean> {
  const resolved = resolve(mediaPath);
  const target = resolved.toLowerCase();

  const roots = await getAllowedMediaRoots();
  if (roots.length === 0) return false;

  for (const root of roots) {
    const normalizedRoot = resolve(root).toLowerCase() + sep;
    if (target === resolve(root).toLowerCase() || target.startsWith(normalizedRoot)) {
      return true;
    }
  }
  return false;
}

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

// ---------- Scan job history ----------

router.get("/scan-jobs", async (_req: Request, res: Response) => {
  const jobs = await prisma.scanJob.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    include: { library: { select: { name: true } } },
  });
  res.json(jobs);
});

// ---------- Start playback: probe file, decide strategy, create session ----------
// Body: { deviceId, mediaPath, clientId }
// The user is taken from the bearer token (req.user).
// clientId must match a key in CLIENT_CAPABILITIES (direct-play-engine.ts)
router.post("/play", async (req: Request, res: Response) => {
  const userId = req.user!.authSubject;
  const { deviceId, mediaPath, clientId, audioTrackIndex, subtitleTrackIndex } = req.body as {
    deviceId: string;
    mediaPath: string;
    clientId: string;
    audioTrackIndex?: number;
    subtitleTrackIndex?: number | "off";
  };

  if (!deviceId || !mediaPath || !clientId) {
    return res.status(400).json({
      error: "deviceId, mediaPath, and clientId are required",
    });
  }

  const client = CLIENT_CAPABILITIES[clientId];
  if (!client) {
    return res.status(400).json({
      error: `Unknown clientId "${clientId}". Known clients: ${Object.keys(CLIENT_CAPABILITIES).join(", ")}`,
    });
  }

  if (!(await isWithinAllowedMediaRoot(mediaPath))) {
    return res.status(400).json({
      error:
        "mediaPath must be an absolute path under a configured library root " +
        "or MEDIA_MOUNT_PATH",
    });
  }

  try {
    const fileAsset = await prisma.fileAsset.findUnique({
      where: { sourcePath: mediaPath },
      select: { fileAssetId: true, mediaItemId: true },
    });

    const originalMedia = await probeMediaFile(mediaPath);
    let playMedia = originalMedia;
    let playPath = mediaPath;
    let decision = decidePlaybackStrategy(originalMedia, client);

    // If the source isn't direct-playable for this client, look for an
    // already-prepared VersionVariant and/or queue a background prep job.
    if (decision.action !== "DIRECT_PLAY" && fileAsset?.mediaItemId) {
      const compatProfileId = await getOrCreateCompatibilityProfile(client);
      const ready = await findReadyVariant(fileAsset.mediaItemId, compatProfileId);

      if (ready?.storageUri) {
        const variantMedia = await probeMediaFile(ready.storageUri);
        const variantDecision = decidePlaybackStrategy(variantMedia, client);
        if (variantDecision.action === "DIRECT_PLAY") {
          playMedia = variantMedia;
          playPath = ready.storageUri;
          decision = variantDecision;
        }
      }

      // If we still aren't using a ready variant, queue a prep for next time.
      if (playPath === mediaPath) {
        queuePrepJob(fileAsset.mediaItemId, fileAsset.fileAssetId, compatProfileId).catch(
          (err) => console.error("[preparation] queue prep failed:", err)
        );
      }
    }

    if (!(await isWithinAllowedMediaRoot(playPath))) {
      return res.status(400).json({
        error: "Resolved playback path is outside allowed media roots",
      });
    }

    const session = await createSession({
      userId,
      deviceId,
      mediaItemId: fileAsset?.mediaItemId,
      clientType: clientId,
      mediaPath: playPath,
      decision,
      durationSeconds: playMedia.durationSeconds,
      audioTrackIndex,
      subtitleTrackIndex,
    });

    res.status(201).json({
      session,
      streamUrl: `/stream/${session.sessionId}`,
      audioTracks: playMedia.audioTracks,
      subtitleTracks: playMedia.subtitleTracks,
    });
  } catch (err) {
    console.error("Failed to start playback:", err);
    res.status(500).json({ error: "Failed to probe or start stream", detail: String(err) });
  }
});

// ---------- Actual media stream ----------
// Served from index.ts (before requireAuth) so <video> tags can access it.
// The sessionId acts as a capability token.

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

// ---------- Preparation layer management ----------

router.get("/preparation/jobs", async (_req: Request, res: Response) => {
  const jobs = await prisma.preparationJob.findMany({
    orderBy: { queuedAt: "desc" },
    take: 100,
  });
  res.json(jobs);
});

// Queue a prep job for a specific media item + client profile.
// Body: { mediaItemId, sourceFileAssetId, clientId }
router.post("/preparation/queue", async (req: Request, res: Response) => {
  const { mediaItemId, sourceFileAssetId, clientId } = req.body as {
    mediaItemId: string;
    sourceFileAssetId: string;
    clientId: string;
  };

  if (!mediaItemId || !sourceFileAssetId || !clientId) {
    return res.status(400).json({
      error: "mediaItemId, sourceFileAssetId, and clientId are required",
    });
  }

  const client = CLIENT_CAPABILITIES[clientId];
  if (!client) {
    return res.status(400).json({
      error: `Unknown clientId "${clientId}"`,
    });
  }

  try {
    const compatProfileId = await getOrCreateCompatibilityProfile(client);
    await queuePrepJob(mediaItemId, sourceFileAssetId, compatProfileId);
    res.status(202).json({ status: "queued" });
  } catch (err) {
    console.error("[preparation] queue failed:", err);
    res.status(500).json({ error: "Failed to queue preparation job", detail: String(err) });
  }
});

// Kick the next queued prep job in the background. Returns 202 immediately;
// the job itself runs async and updates status in the database.
router.post("/preparation/dequeue", async (_req: Request, res: Response) => {
  const job = await prisma.preparationJob.findFirst({
    where: { status: "queued" },
    orderBy: { queuedAt: "asc" },
  });

  if (!job) {
    return res.status(404).json({ error: "No queued preparation jobs" });
  }

  runPrepJob(job.prepJobId).catch((err) =>
    console.error(`[preparation] job ${job.prepJobId} failed:`, err)
  );

  res.status(202).json({ prepJobId: job.prepJobId, status: "running" });
});

// ---------- Predictions and home nodes ----------

router.get("/predictions", async (_req: Request, res: Response) => {
  const predictions = await prisma.predictionEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(predictions);
});

router.get("/home-nodes", async (_req: Request, res: Response) => {
  const nodes = await prisma.homeNode.findMany({
    orderBy: { lastHeartbeatAt: "desc" },
  });
  res.json(nodes);
});

router.post("/home-nodes", async (req: Request, res: Response) => {
  const { name, hardwareClass, cachePath } = req.body as {
    name: string;
    hardwareClass: string;
    cachePath: string;
  };
  if (!name || !hardwareClass || !cachePath) {
    return res.status(400).json({
      error: "name, hardwareClass, and cachePath are required",
    });
  }
  const node = await prisma.homeNode.create({
    data: { name, hardwareClass, cachePath, encryptionKeyHex: generateEncryptionKey() },
  });
  res.status(201).json(node);
});

router.get("/home-nodes/:id", async (req: Request, res: Response) => {
  const node = await prisma.homeNode.findUnique({
    where: { homeNodeId: req.params.id },
  });
  if (!node) return res.status(404).json({ error: "Home node not found" });
  res.json(node);
});

router.patch("/home-nodes/:id/heartbeat", async (req: Request, res: Response) => {
  const node = await prisma.homeNode.update({
    where: { homeNodeId: req.params.id },
    data: { lastHeartbeatAt: new Date() },
  });
  res.json(node);
});

router.delete("/home-nodes/:id", async (req: Request, res: Response) => {
  await prisma.homeNode.delete({
    where: { homeNodeId: req.params.id },
  });
  res.status(204).send();
});

// Provision or rotate the encryption key for a home node.
// The key is used by the edge node agent to encrypt cached variants at rest.
router.post("/home-nodes/:id/rotate-key", async (req: Request, res: Response) => {
  const newKey = generateEncryptionKey();
  const node = await prisma.homeNode.update({
    where: { homeNodeId: req.params.id },
    data: { encryptionKeyHex: newKey },
  });
  res.json({ homeNodeId: node.homeNodeId, encryptionKeyHex: newKey });
});

// Retrieve the encryption key for a home node (used by edge node agent).
router.get("/home-nodes/:id/key", async (req: Request, res: Response) => {
  const node = await prisma.homeNode.findUnique({
    where: { homeNodeId: req.params.id },
    select: { encryptionKeyHex: true },
  });
  if (!node) return res.status(404).json({ error: "Home node not found" });
  if (!node.encryptionKeyHex) return res.status(404).json({ error: "No encryption key set" });
  res.json({ encryptionKeyHex: node.encryptionKeyHex });
});

// Desired pull manifest for a home node: ready variants for items that
// have been predicted for users assigned to this node.
router.get("/home-nodes/:id/manifest", async (req: Request, res: Response) => {
  const homeNode = await prisma.homeNode.findUnique({
    where: { homeNodeId: req.params.id },
  });
  if (!homeNode) return res.status(404).json({ error: "Home node not found" });

  const users = await prisma.userProfile.findMany({
    where: { homeNodeId: homeNode.homeNodeId },
    select: { userId: true },
  });
  if (users.length === 0) return res.json([]);

  const userIds = users.map((u: { userId: string }) => u.userId);
  const predictions = await prisma.predictionEvent.findMany({
    where: { userId: { in: userIds } },
    orderBy: { createdAt: "desc" },
    distinct: ["predictedMediaItemId"],
    select: { predictedMediaItemId: true },
    take: 50,
  });

  const mediaItemIds = predictions.map(
    (p: { predictedMediaItemId: string }) => p.predictedMediaItemId
  );
  if (mediaItemIds.length === 0) return res.json([]);

  const variants = await prisma.versionVariant.findMany({
    where: {
      mediaItemId: { in: mediaItemIds },
      prepState: "ready",
      directPlayReady: true,
      storageUri: { not: null },
    },
    include: {
      compatibilityProfile: true,
      mediaItem: { select: { title: true } },
      outputStorageVolume: { select: { rootPath: true } },
    },
  });

  res.json(variants);
});

// Download a prepared variant. Validates the resolved storageUri is under
// an allowed root (prepared media path, library roots, or media mount).
router.get("/download/variant/:variantId", async (req: Request, res: Response) => {
  const variant = await prisma.versionVariant.findUnique({
    where: { variantId: req.params.variantId },
    include: { compatibilityProfile: true },
  });

  if (!variant?.storageUri) {
    return res
      .status(404)
      .json({ error: "Variant not found or not ready" });
  }

  if (!(await isWithinAllowedMediaRoot(variant.storageUri))) {
    return res.status(403).json({
      error: "Variant storage path is outside allowed media roots",
    });
  }

  res.setHeader("Content-Type", "video/mp4");
  res.sendFile(variant.storageUri, (err) => {
    if (err) {
      console.error(`[download] failed for variant ${req.params.variantId}:`, err);
      if (!res.headersSent) res.status(500).end();
    }
  });
});

// ---------- Audio Policies ----------
// GET /audio-policies — list all audio policies

router.get("/audio-policies", async (_req: Request, res: Response) => {
  const policies = await prisma.audioPolicy.findMany({
    orderBy: { name: "asc" },
  });
  res.json(policies);
});

// POST /audio-policies — create a new audio policy

router.post("/audio-policies", async (req: Request, res: Response) => {
  const { name, englishOnly, normalizeAudio } = req.body as {
    name: string;
    englishOnly?: boolean;
    normalizeAudio?: boolean;
  };
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }
  const policy = await prisma.audioPolicy.create({
    data: {
      name,
      englishOnly: englishOnly ?? false,
      normalizeAudio: normalizeAudio ?? true,
    },
  });
  res.status(201).json(policy);
});

// PATCH /audio-policies/:id — update an audio policy

router.patch("/audio-policies/:id", async (req: Request, res: Response) => {
  const { name, englishOnly, normalizeAudio } = req.body as {
    name?: string;
    englishOnly?: boolean;
    normalizeAudio?: boolean;
  };
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (englishOnly !== undefined) data.englishOnly = englishOnly;
  if (normalizeAudio !== undefined) data.normalizeAudio = normalizeAudio;

  const policy = await prisma.audioPolicy.update({
    where: { audioPolicyId: req.params.id },
    data,
  });
  res.json(policy);
});

// DELETE /audio-policies/:id — delete an audio policy

router.delete("/audio-policies/:id", async (req: Request, res: Response) => {
  await prisma.audioPolicy.delete({
    where: { audioPolicyId: req.params.id },
  });
  res.status(204).send();
});

// ---------- Health Snapshots ----------
// GET /health-snapshots — recent health check results

router.get("/health-snapshots", async (_req: Request, res: Response) => {
  const snapshots = await prisma.healthSnapshot.findMany({
    orderBy: { measuredAt: "desc" },
    take: 50,
  });
  res.json(snapshots);
});

// POST /health-snapshots — record a health check result

router.post("/health-snapshots", async (req: Request, res: Response) => {
  const { serviceName, nodeRef, status } = req.body as {
    serviceName: string;
    nodeRef?: string;
    status: string;
  };
  if (!serviceName || !status) {
    return res.status(400).json({ error: "serviceName and status are required" });
  }
  const snapshot = await prisma.healthSnapshot.create({
    data: { serviceName, nodeRef, status },
  });
  res.status(201).json(snapshot);
});
