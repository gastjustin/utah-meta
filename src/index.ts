/**
 * UtahMeta - Phase 3/4: Media Sandbox + Core Platform Services
 * Entry point
 */

import express from "express";
import { createServer } from "http";
import { loadConfig } from "./config";
import { attachSessionWebSocket } from "./session-store";
import { router } from "./routes";
import { libraryRouter } from "./library-routes";

// Fail fast on misconfiguration rather than surfacing a cryptic
// connection error later inside a request handler.
const config = loadConfig();

const app = express();
app.use(express.json());
app.use(router);
app.use(libraryRouter);

const httpServer = createServer(app);
attachSessionWebSocket(httpServer);

httpServer.listen(config.port, () => {
  console.log(`UtahMeta listening on :${config.port} (${config.nodeEnv})`);
  console.log(`Health check: http://localhost:${config.port}/health`);
});
