import { Request, Response } from "express";
import { prisma } from "./db";
import { XtreamConfig } from "./live-tv-parser";

export async function serveLiveTvStream(req: Request, res: Response): Promise<void> {
  const channel = await prisma.liveTvChannel.findUnique({
    where: { liveTvChannelId: req.params.id },
    include: { liveTvSource: true },
  });

  if (!channel || !channel.liveTvSource?.enabled) {
    res.status(404).end("Channel not found or source disabled");
    return;
  }

  const source = channel.liveTvSource;

  if (source.kind === "xtream") {
    const cfg = JSON.parse(source.config) as XtreamConfig;
    const base = cfg.baseUrl.replace(/\/$/, "");
    const output = cfg.output || "m3u8";
    const streamId = channel.epgId || channel.streamUrl.split("/").pop()?.replace(/\.\w+$/, "");
    if (streamId && cfg.username && cfg.password) {
      const url = `${base}/live/${cfg.username}/${cfg.password}/${streamId}.${output}`;
      res.redirect(url);
      return;
    }
  }

  res.redirect(channel.streamUrl);
}
