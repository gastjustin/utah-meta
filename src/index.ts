/**
 * UtahMeta - Phase 3/4: Media Sandbox + Core Platform Services
 * Entry point
 */

import express from "express";
import { createServer } from "http";
import { join } from "path";
import { loadConfig } from "./config";
import { attachSessionWebSocket } from "./session-store";
import { router } from "./routes";
import { libraryRouter } from "./library-routes";
import { userRouter } from "./user-routes";
import { startPrepWorker } from "./preparation-engine";
import { authRouter, requireAuth, requireAdmin } from "./auth";

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

// SPA fallback: any non-API GET returns index.html so React Router handles it.
app.get(/^(?!\/(auth|health|libraries|series|media|search|users|devices|sessions|stream|play|preparation|predictions|home-nodes|download|library)).*/, (_req, res) => {
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

app.use(router);
app.use(libraryRouter);
app.use(userRouter);

const httpServer = createServer(app);
attachSessionWebSocket(httpServer);

httpServer.listen(config.port, () => {
  console.log(`UtahMeta listening on :${config.port} (${config.nodeEnv})`);
  console.log(`Health check: http://localhost:${config.port}/health`);
});

startPrepWorker();
