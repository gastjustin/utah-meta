/**
 * UtahMeta - Redis client
 * Two connections: one for normal commands, one dedicated to pub/sub
 * (a Redis connection in subscribe mode can't run other commands, so
 * it needs its own connection — this is standard ioredis practice).
 */

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(REDIS_URL);
export const redisSub = new Redis(REDIS_URL);

redis.on("error", (err) => console.error("[redis] connection error:", err));
redisSub.on("error", (err) => console.error("[redis:sub] connection error:", err));
