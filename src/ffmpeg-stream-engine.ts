/**
 * UtahMeta - Phase 3: Media Sandbox Streaming Engine
 * ffmpeg Command Builder + Streaming Execution
 *
 * Takes a PlaybackDecision (from direct-play-engine.ts) + MediaProfile
 * (from ffprobe-integration.ts) and either:
 *   - streams the file directly (DIRECT_PLAY)
 *   - pipes it through ffmpeg for REMUX or TRANSCODE, streaming stdout
 *     straight to the HTTP response as it's produced (no waiting for
 *     the whole file to process first)
 *
 * npm install express
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { createReadStream, statSync } from "fs";
import type { Request, Response } from "express";
import type { PlaybackDecision } from "./direct-play-engine";
import type { MediaProfile } from "./direct-play-engine";
import { getSession, updateSessionState, removeSession } from "./session-store";
import { predictAndStage } from "./prediction-engine";

// ---------- 1. Build ffmpeg args from a decision ----------

export interface StreamOptions {
  audioTrackIndex?: number;   // ffprobe stream index for the desired audio track
  subtitleTrackIndex?: number | "off";  // ffprobe stream index, or "off" to burn none
}

export function buildFfmpegArgs(
  media: MediaProfile,
  decision: PlaybackDecision,
  output: string = "pipe:1",
  options?: StreamOptions
): string[] {
  if (decision.action === "DIRECT_PLAY") {
    throw new Error("DIRECT_PLAY should not go through ffmpeg — stream the file directly");
  }

  const args: string[] = ["-i", media.path];

  // Audio track selection: map only the requested stream.
  if (options?.audioTrackIndex !== undefined) {
    args.push("-map", "0:v:0", `-map`, `0:${options.audioTrackIndex}`);
  }

  if (decision.action === "REMUX") {
    // No re-encode — just repackage into the target container.
    // "-c copy" tells ffmpeg to stream-copy both video and audio.
    args.push(
      "-c", "copy",
      "-movflags", "frag_keyframe+empty_moov", // enables streaming mp4 output
      "-f", containerToFfmpegFormat(decision.targetContainer)
    );
  }

  if (decision.action === "TRANSCODE") {
    // Hardware-accelerated encode: try NVENC first, then QSV, then software.
    // The encoder choice depends on the target codec and available hardware.
    const hwEncoder = process.env.UTAHMETA_HWACCEL || "auto";
    const useNvenc = hwEncoder === "auto" || hwEncoder === "nvenc";
    const useQsv = hwEncoder === "qsv";

    if (decision.useHardwareAccel && useNvenc) {
      // NVENC: hevc_nvenc for HEVC, h264_nvenc for H.264
      const encoder = decision.targetVideoCodec === "hevc" ? "hevc_nvenc" : "h264_nvenc";
      args.push("-c:v", encoder, "-preset", "p4", "-rc", "vbr", "-cq", "23");
    } else if (useQsv) {
      // Intel Quick Sync Video
      const encoder = decision.targetVideoCodec === "hevc" ? "hevc_qsv" : "h264_qsv";
      args.push("-c:v", encoder, "-preset", "veryfast", "-look_ahead", "0");
    } else {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "21");
    }

    args.push("-c:a", decision.targetAudioCodec === "aac" ? "aac" : decision.targetAudioCodec);
    args.push(
      "-movflags", "frag_keyframe+empty_moov",
      "-f", "mp4"
    );
  }

  // Subtitle handling: burn in the selected subtitle track for transcode.
  // For remux, subtitles are passed through if the target container supports them.
  if (options?.subtitleTrackIndex && options.subtitleTrackIndex !== "off") {
    if (decision.action === "TRANSCODE") {
      args.push(`-filter:s:${options.subtitleTrackIndex}`, "scale=2.0");
    }
  } else if (options?.subtitleTrackIndex === "off") {
    args.push("-sn");
  }

  // Output to stdout for streaming, or to a file path for background prep.
  args.push(output);

  return args;
}

function containerToFfmpegFormat(container: string): string {
  const map: Record<string, string> = {
    mp4: "mp4",
    mkv: "matroska",
    webm: "webm",
  };
  return map[container] ?? container;
}

// ---------- 2. Track running ffmpeg processes per session ----------
// Lets you kill a transcode if the user stops/seeks, instead of letting
// it run to completion wastefully.

const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

export function killStreamProcess(sessionId: string): void {
  const proc = activeProcesses.get(sessionId);
  if (proc && !proc.killed) {
    proc.kill("SIGKILL");
  }
  activeProcesses.delete(sessionId);
}

// ---------- 3. Express handler that serves a stream for a session ----------

export function streamHandler(
  media: MediaProfile,
  decision: PlaybackDecision,
  sessionId: string,
  options?: StreamOptions
) {
  return (req: Request, res: Response) => {
    if (decision.action === "DIRECT_PLAY") {
      // No ffmpeg process involved — the file is served straight off
      // disk, so there's no "first chunk" event to hook. Mark it
      // playing immediately; req.on("close") below still handles
      // cleanup when the client disconnects.
      // These are fire-and-forget from an event handler's perspective,
      // so we .catch() rather than await to avoid unhandled rejections.
      updateSessionState(sessionId, { state: "playing" }).catch((err) =>
        console.error(`Failed to update session ${sessionId} to playing:`, err)
      );
      req.on("close", () => {
        getSession(sessionId)
          .then((session) => {
            if (session?.mediaItemId && session?.clientType) {
              predictAndStage(
                session.userId,
                session.mediaItemId,
                session.clientType
              ).catch((err) =>
                console.error(`[prediction] failed for session ${sessionId}:`, err)
              );
            }
          })
          .catch((err) =>
            console.error(`[prediction] getSession failed for session ${sessionId}:`, err)
          );
        removeSession(sessionId).catch((err) =>
          console.error(`Failed to remove session ${sessionId}:`, err)
        );
      });
      return streamDirectPlay(media.path, req, res);
    }

    const args = buildFfmpegArgs(media, decision, "pipe:1", options);
    const ffmpeg = spawn("ffmpeg", args);
    activeProcesses.set(sessionId, ffmpeg);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Transfer-Encoding", "chunked");

    // Session starts as "buffering" (set at creation in session-store).
    // Flip to "playing" the moment ffmpeg actually emits its first chunk
    // of output — that's the real signal that data is reaching the
    // client, not just that the process was spawned.
    let hasEmittedOutput = false;
    ffmpeg.stdout.once("data", () => {
      hasEmittedOutput = true;
      updateSessionState(sessionId, { state: "playing" }).catch((err) =>
        console.error(`Failed to update session ${sessionId} to playing:`, err)
      );
    });

    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on("data", (chunk) => {
      // ffmpeg logs progress/errors to stderr — useful for debugging,
      // wire this to your logging system rather than console in prod
      // console.debug(`[ffmpeg ${sessionId}]`, chunk.toString());
    });

    ffmpeg.on("error", (err) => {
      console.error(`ffmpeg failed for session ${sessionId}:`, err);
      removeSession(sessionId).catch((e) =>
        console.error(`Failed to remove session ${sessionId}:`, e)
      );
      if (!res.headersSent) res.status(500).end("Transcode failed to start");
    });

    ffmpeg.on("close", async (code) => {
      activeProcesses.delete(sessionId);
      if (code !== 0 && code !== null) {
        console.warn(`ffmpeg exited with code ${code} for session ${sessionId}`);
      }
      // Process exited (finished, killed, or crashed) — mark the
      // session stopped so nothing shows as "playing" indefinitely.
      // This is also the exact trigger point for Phase 6's predictive
      // cache: "this session just ended cleanly" -> pre-cache next episode.
      if (hasEmittedOutput || code === 0) {
        try {
          const session = await getSession(sessionId);
          if (session?.mediaItemId && session?.clientType) {
            await predictAndStage(
              session.userId,
              session.mediaItemId,
              session.clientType
            );
          }
        } catch (err) {
          console.error(`[prediction] failed for session ${sessionId}:`, err);
        }
        removeSession(sessionId).catch((e) =>
          console.error(`Failed to remove session ${sessionId}:`, e)
        );
      }
      res.end();
    });

    // Clean up if the client disconnects mid-stream (closed tab, seek, etc.)
    req.on("close", () => {
      killStreamProcess(sessionId);
      removeSession(sessionId).catch((e) =>
        console.error(`Failed to remove session ${sessionId}:`, e)
      );
    });
  };
}

// ---------- 4. Direct play: serve the file with HTTP range support ----------
// Range support is what makes seeking work without any server processing.

function streamDirectPlay(filePath: string, req: Request, res: Response) {
  const stat = statSync(filePath);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": "video/mp4",
    });
    return createReadStream(filePath).pipe(res);
  }

  const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
  const start = parseInt(startStr, 10);
  const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": "video/mp4",
  });

  createReadStream(filePath, { start, end }).pipe(res);
}

// See routes.ts for how streamHandler() is actually wired to
// GET /stream/:sessionId, and how killStreamProcess() is called
// alongside removeSession() on DELETE /sessions/:id.
