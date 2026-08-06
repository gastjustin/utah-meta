/**
 * UtahMeta - Live TV routes
 *
 * Admin endpoints to manage M3U/XtremeCodes sources and a read-only endpoint
 * to list channels. Streams are served through a proxy/redirect endpoint so
 * the player never needs to know the upstream credentials.
 */

import { Router, Request, Response } from "express";
import { prisma } from "./db";
import { parseM3U, fetchM3UFromURL, fetchXtreamChannels, XtreamConfig } from "./live-tv-parser";

export const liveTvRouter = Router();

// ---------- Sources ----------

liveTvRouter.get("/live-tv/sources", async (_req: Request, res: Response) => {
  const sources = await prisma.liveTvSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { channels: true } } },
  });
  res.json(sources);
});

liveTvRouter.post("/live-tv/sources", async (req: Request, res: Response) => {
  const { name, kind, config } = req.body as {
    name?: string;
    kind?: string;
    config?: Record<string, unknown>;
  };
  if (!name || !kind || !config) {
    return res.status(400).json({ error: "name, kind, and config are required" });
  }
  if (!["m3u_url", "m3u_file", "xtream"].includes(kind)) {
    return res.status(400).json({ error: "kind must be m3u_url, m3u_file, or xtream" });
  }

  const source = await prisma.liveTvSource.create({
    data: {
      name,
      kind,
      config: JSON.stringify(config),
    },
  });
  res.status(201).json(source);
});

liveTvRouter.delete("/live-tv/sources/:id", async (req: Request, res: Response) => {
  await prisma.liveTvSource.delete({
    where: { liveTvSourceId: req.params.id },
  });
  res.status(204).send();
});

liveTvRouter.patch("/live-tv/sources/:id", async (req: Request, res: Response) => {
  const { name, enabled } = req.body as { name?: string; enabled?: boolean };
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (enabled !== undefined) data.enabled = enabled;
  const source = await prisma.liveTvSource.update({
    where: { liveTvSourceId: req.params.id },
    data,
  });
  res.json(source);
});

// ---------- Sync channels from a source ----------

liveTvRouter.post("/live-tv/sources/:id/sync", async (req: Request, res: Response) => {
  const source = await prisma.liveTvSource.findUnique({
    where: { liveTvSourceId: req.params.id },
  });
  if (!source) return res.status(404).json({ error: "Source not found" });

  const config = JSON.parse(source.config);
  let parsed: { channelNumber?: number; name: string; logoUrl?: string; groupName?: string; streamUrl: string; epgId?: string }[] = [];

  try {
    if (source.kind === "m3u_url") {
      parsed = await fetchM3UFromURL(String(config.url));
    } else if (source.kind === "m3u_file") {
      parsed = await parseM3U(String(config.content ?? ""));
    } else if (source.kind === "xtream") {
      parsed = await fetchXtreamChannels(config as XtreamConfig);
    }
  } catch (err: any) {
    console.error(`[live-tv] sync failed for ${source.liveTvSourceId}:`, err);
    return res.status(500).json({ error: err.message || "Sync failed" });
  }

  // Clear and repopulate channels for the source.
  await prisma.$transaction(async (tx) => {
    await tx.liveTvChannel.deleteMany({
      where: { liveTvSourceId: source.liveTvSourceId },
    });
    if (parsed.length > 0) {
      await tx.liveTvChannel.createMany({
        data: parsed.map((ch) => ({
          liveTvSourceId: source.liveTvSourceId,
          channelNumber: ch.channelNumber ?? null,
          name: ch.name,
          logoUrl: ch.logoUrl ?? null,
          groupName: ch.groupName ?? null,
          streamUrl: ch.streamUrl,
          epgId: ch.epgId ?? null,
        })),
      });
    }
    await tx.liveTvSource.update({
      where: { liveTvSourceId: source.liveTvSourceId },
      data: { lastSyncedAt: new Date() },
    });
  });

  res.json({
    sourceId: source.liveTvSourceId,
    channelsAdded: parsed.length,
  });
});

// ---------- Channel listing ----------

liveTvRouter.get("/live-tv/channels", async (_req: Request, res: Response) => {
  const channels = await prisma.liveTvChannel.findMany({
    orderBy: [{ groupName: "asc" }, { channelNumber: "asc" }, { name: "asc" }],
    include: { liveTvSource: { select: { name: true, kind: true, enabled: true } } },
  });
  res.json(channels);
});

liveTvRouter.get("/live-tv/channels/:id", async (req: Request, res: Response) => {
  const channel = await prisma.liveTvChannel.findUnique({
    where: { liveTvChannelId: req.params.id },
    include: { liveTvSource: true },
  });
  if (!channel) return res.status(404).json({ error: "Channel not found" });
  res.json(channel);
});

liveTvRouter.post("/live-tv/sources/:id/sync-vod", async (req: Request, res: Response) => {
  const source = await prisma.liveTvSource.findUnique({
    where: { liveTvSourceId: req.params.id },
  });
  if (!source) return res.status(404).json({ error: "Source not found" });
  try {
    const { syncVodFromSource } = await import("./vod-sync");
    const result = await syncVodFromSource(source.liveTvSourceId, { kind: source.kind, config: source.config });
    res.json(result);
  } catch (err: any) {
    console.error("VOD sync failed for source", req.params.id, err);
    res.status(500).json({ error: err.message });
  }
});

// Stream endpoint is public and served from src/index.ts
