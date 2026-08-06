/**
 * UtahMeta - VOD stream proxy
 * Serves M3U / Xtreme VOD streams through the backend to avoid exposing
 * upstream URLs and credentials.
 */

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

async function proxyStreamUrl(upstreamUrl: string, res: Response) {
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
}

export async function serveVodStream(req: Request, res: Response): Promise<void> {
  const item = await prisma.mediaItem.findUnique({
    where: { mediaItemId: req.params.id },
  });

  if (!item || !item.streamUrl) {
    res.status(404).end("VOD item not found");
    return;
  }

  try {
    await proxyStreamUrl(item.streamUrl, res);
  } catch (err: any) {
    console.error(`[vod] proxy failed for ${req.params.id}:`, err);
    res.status(500).end("VOD proxy failed");
  }
}
