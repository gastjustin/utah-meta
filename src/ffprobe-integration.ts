/**
 * UtahMeta - Phase 3: Media Sandbox Streaming Engine
 * ffprobe Integration — populates MediaProfile from real files
 *
 * Requires ffprobe on PATH (ships with ffmpeg).
 * npm install execa   (or swap for child_process if you prefer no deps)
 */

import { execa } from "execa";
import type { MediaProfile } from "./direct-play-engine";

// ---------- 1. Raw ffprobe output shape (subset we care about) ----------

interface FfprobeStream {
  codec_type: "video" | "audio" | "subtitle" | "data";
  codec_name: string;
  width?: number;
  height?: number;
  color_transfer?: string; // e.g. "smpte2084" indicates HDR (PQ)
  color_primaries?: string; // e.g. "bt2020"
  bit_rate?: string;
}

interface FfprobeFormat {
  format_name: string; // e.g. "matroska,webm"
  bit_rate?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

// ---------- 2. Run ffprobe and parse ----------

export async function probeMediaFile(filePath: string): Promise<MediaProfile> {
  const { stdout } = await execa("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const data: FfprobeOutput = JSON.parse(stdout);

  const videoStream = data.streams.find((s) => s.codec_type === "video");
  const audioStream = data.streams.find((s) => s.codec_type === "audio");

  if (!videoStream) {
    throw new Error(`No video stream found in ${filePath}`);
  }

  const container = normalizeContainer(data.format.format_name);
  const videoCodec = normalizeCodec(videoStream.codec_name);
  const audioCodec = audioStream ? normalizeCodec(audioStream.codec_name) : "none";

  const bitrateBps = Number(
    data.format.bit_rate ?? videoStream.bit_rate ?? 0
  );
  const bitrateMbps = Math.round((bitrateBps / 1_000_000) * 10) / 10;

  const isHDR =
    videoStream.color_transfer === "smpte2084" || // HDR10 / PQ
    videoStream.color_transfer === "arib-std-b67"; // HLG

  const resolution: "1080p" | "4k" =
    (videoStream.width ?? 0) >= 3800 ? "4k" : "1080p";

  return {
    path: filePath,
    container,
    videoCodec,
    audioCodec,
    bitrateMbps,
    isHDR,
    resolution,
  };
}

// ---------- 3. Normalization helpers ----------
// ffprobe's naming doesn't always match the client capability matrix's
// naming (e.g. "matroska,webm" vs "mkv", "h265" vs "hevc"). Keep this
// mapping in one place so both sides of the system agree.

function normalizeContainer(formatName: string): string {
  const first = formatName.split(",")[0].toLowerCase();
  const map: Record<string, string> = {
    matroska: "mkv",
    mov: "mp4", // mp4/mov share a demuxer family
  };
  return map[first] ?? first;
}

function normalizeCodec(codecName: string): string {
  const map: Record<string, string> = {
    h265: "hevc",
    dts: "dts",
    truehd: "truehd",
  };
  return map[codecName.toLowerCase()] ?? codecName.toLowerCase();
}

// ---------- 4. Example usage ----------

// const profile = await probeMediaFile("D:/Media/Movies/Dune.mkv");
// const decision = decidePlaybackStrategy(profile, CLIENT_CAPABILITIES.web_chrome);
