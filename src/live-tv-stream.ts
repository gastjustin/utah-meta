import { Request, Response } from "express";
import { Readable } from "stream";
import { prisma } from "./db";

const HLS_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "audio/mpegurl",
  "application/x-mpegurl",
  "audio/x-mpegurl",
];

function looksLikeHls(url: string, contentType?: string | null): boolean {
  const lower = (contentType || "").toLowerCase();
  if (HLS_CONTENT_TYPES.includes(lower)) return true;
  return /\.m3u8(?:\?|$)/i.test(url);
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).toString();
  } catch {
    return relative;
  }
}

function rewriteHlsManifest(manifest: string, baseUrl: string): string {
  const lines = manifest.split(/\r?\n/);
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) {
      // Rewrite URI="..." attributes in HLS tags like #EXT-X-KEY and #EXT-X-MEDIA
      result.push(
        line.replace(
          /URI="([^"]+)"/g,
          (_match, uri: string) => `URI="${resolveUrl(baseUrl, uri)}"`
        )
      );
    } else if (line.trim() === "") {
      result.push(line);
    } else {
      result.push(resolveUrl(baseUrl, line));
    }
  }
  return result.join("\n");
}

export async function serveLiveTvStream(req: Request, res: Response): Promise<void> {
  const channel = await prisma.liveTvChannel.findUnique({
    where: { liveTvChannelId: req.params.id },
    include: { liveTvSource: true },
  });

  if (!channel || !channel.liveTvSource?.enabled) {
    res.status(404).end("Channel not found or source disabled");
    return;
  }

  const upstreamUrl = channel.streamUrl;
  try {
    const upstream = await fetch(upstreamUrl, { redirect: "follow" });
    if (!upstream.ok) {
      res.status(upstream.status).end(`Upstream error: ${upstream.statusText}`);
      return;
    }

    const contentType = upstream.headers.get("content-type");
    const hls = looksLikeHls(upstreamUrl, contentType);

    if (hls) {
      const text = await upstream.text();
      const rewritten = rewriteHlsManifest(text, upstreamUrl);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-cache");
      res.send(rewritten);
      return;
    }

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-cache");

    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body as any);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err: any) {
    console.error(`[live-tv] proxy failed for ${req.params.id}:`, err);
    res.status(500).end("Stream proxy failed");
  }
}
