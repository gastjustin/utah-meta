/**
 * UtahMeta - Config & Orchestration Layer
 *
 * Single place that reads and validates environment config at boot.
 * Fails fast with a clear message rather than letting a missing env
 * var surface later as a cryptic Prisma/Redis connection error deep in
 * a request handler.
 */

export interface UtahMetaConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  mediaMountPath: string | null;
  nodeEnv: "development" | "production" | "test";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[config] Missing required environment variable: ${name}. ` +
        `Check your .env file against .env.example.`
    );
  }
  return value;
}

export function loadConfig(): UtahMetaConfig {
  const port = Number(process.env.PORT ?? 4100);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`[config] PORT must be a positive number, got "${process.env.PORT}"`);
  }

  const databaseUrl = requireEnv("DATABASE_URL");
  const redisUrl = requireEnv("REDIS_URL");

  // Not required — /library/scan and /play can both take an explicit
  // rootPath/mediaPath instead — but worth warning about since most
  // setups will want it.
  const mediaMountPath = process.env.MEDIA_MOUNT_PATH ?? null;
  if (!mediaMountPath) {
    console.warn(
      "[config] MEDIA_MOUNT_PATH is not set — /library/scan will require " +
        "an explicit rootPath in every request."
    );
  }

  const nodeEnv = (process.env.NODE_ENV as UtahMetaConfig["nodeEnv"]) ?? "development";

  return { port, databaseUrl, redisUrl, mediaMountPath, nodeEnv };
}
