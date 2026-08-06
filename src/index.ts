/**
 * UtahMeta - Phase 3/4: Media Sandbox + Core Platform Services
 * Entry point
 */

// Prisma returns BigInt for BigInt columns (sizeBytes, capacityBytes).
// Express res.json() calls JSON.stringify which can't handle BigInt by
// default — add a toJSON shim so it serializes as a plain number.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

import express from "express";
import { createServer } from "http";
import { join } from "path";
import { createReadStream, existsSync } from "fs";
import { loadConfig } from "./config";
import { attachSessionWebSocket } from "./session-store";
import { router } from "./routes";
import { libraryRouter } from "./library-routes";
import { userRouter } from "./user-routes";
import { liveTvRouter } from "./live-tv-routes";
import { serveLiveTvStream } from "./live-tv-stream";
import { serveVodStream } from "./vod-stream";
import { startPrepWorker } from "./preparation-engine";
import { authRouter, requireAuth, requireAdmin } from "./auth";
import { prisma } from "./db";
import { getSession } from "./session-store";
import { probeMediaFile } from "./ffprobe-integration";
import { streamHandler } from "./ffmpeg-stream-engine";

// Fail fast on misconfiguration rather than surfacing a cryptic
// connection error later inside a request handler.
const config = loadConfig();

const app = express();
app.use(express.json());

// Public: UI (Vite build → public/dist, fallback to public/), login, health.
app.use(express.static(join(__dirname, "..", "public", "dist")));
app.use(express.static(join(__dirname, "..", "public")));
app.use("/auth", authRouter);
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Public artwork serving — must be before requireAuth so <img> tags work.
app.get("/artwork/:id", async (req, res) => {
  const artwork = await prisma.artworkAsset.findUnique({
    where: { artworkAssetId: req.params.id },
  });
  if (!artwork) return res.status(404).end();
  const path = artwork.storageUri;
  if (!path || !existsSync(path)) return res.status(404).end();
  const ext = path.split(".").pop()?.toLowerCase() || "jpg";
  res.setHeader("Content-Type", ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  createReadStream(path).pipe(res);
});

// Public person photo serving — must be before requireAuth so <img> tags work.
app.get("/person-photo/:id", async (req, res) => {
  const person = await prisma.person.findUnique({
    where: { personId: req.params.id },
  });
  if (!person?.photoPath || !existsSync(person.photoPath)) return res.status(404).end();
  const ext = person.photoPath.split(".").pop()?.toLowerCase() || "jpg";
  res.setHeader("Content-Type", ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=86400");
  createReadStream(person.photoPath).pipe(res);
});

// Public stream endpoint — must be before requireAuth so <video> tags work.
// The sessionId acts as a capability token.
app.get("/stream/:sessionId", async (req, res) => {
  const session = await getSession(req.params.sessionId);
  if (!session) return res.status(404).end();
  try {
    const media = await probeMediaFile(session.mediaPath);
    const handler = streamHandler(media, session.decision, session.sessionId, {
      audioTrackIndex: session.audioTrackIndex,
      subtitleTrackIndex: session.subtitleTrackIndex,
    });
    handler(req, res);
  } catch (err) {
    console.error(`Failed to stream session ${session.sessionId}:`, err);
    res.status(500).end("Stream failed");
  }
});

// Public live TV / VOD stream proxies — served here so upstream credentials stay hidden.
app.get("/live-tv/stream/:id", (req, res) => serveLiveTvStream(req, res).catch((err) => console.error(err)));
app.get("/vod/stream/:id", (req, res) => serveVodStream(req, res).catch((err) => console.error(err)));

// SPA fallback: any non-API GET returns index.html so React Router handles it.
app.get(/^(?!\/(auth|health|libraries|series|items|media|search|users|devices|sessions|stream|play|preparation|predictions|home-nodes|download|library|artwork|person-photo|continue-watching|audio-policies|health-snapshots|collections|scan-jobs|live-tv|vod)).*/, (_req, res) => {
  res.sendFile(join(__dirname, "..", "public", "dist", "index.html"), (err) => {
    if (err) res.sendFile(join(__dirname, "..", "public", "index.html"));
  });
});

// Everything below requires a valid bearer token.
app.use(requireAuth);

// Admin-only endpoints: library scan, preparation management, home nodes,
// predictions, and user CRUD. These are checked before the routers handle them.
app.use("/library/scan", requireAdmin);
app.use("/preparation", requireAdmin);
app.use("/home-nodes", requireAdmin);
app.use("/predictions", requireAdmin);
app.post("/users", requireAdmin);
app.delete("/users/:id", requireAdmin);
app.post("/audio-policies", requireAdmin);
app.patch("/audio-policies/:id", requireAdmin);
app.delete("/audio-policies/:id", requireAdmin);

app.use(router);
app.use(libraryRouter);
app.use(userRouter);
app.use(liveTvRouter);

const httpServer = createServer(app);
attachSessionWebSocket(httpServer);

httpServer.listen(config.port, () => {
  console.log(`UtahMeta listening on :${config.port} (${config.nodeEnv})`);
  console.log(`Health check: http://localhost:${config.port}/health`);
});

startPrepWorker();
