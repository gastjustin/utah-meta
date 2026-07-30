/**
 * UtahMeta - Phase 3: Media Sandbox Streaming Engine
 * Direct Play Decision Logic + Client Capability Matrix
 *
 * Core idea: given a media file's technical profile and a client's
 * declared capabilities, decide whether to:
 *   - DIRECT_PLAY  (send file unmodified — cheapest, best quality)
 *   - REMUX        (repackage container only, no re-encode — cheap)
 *   - TRANSCODE    (re-encode video/audio — expensive, last resort)
 */

// ---------- 1. Client Capability Matrix ----------

export interface ClientCapability {
  clientId: string;
  containers: string[];       // containers the client can play natively
  videoCodecs: string[];
  audioCodecs: string[];
  maxVideoBitrateMbps: number;
  supportsHDR: boolean;
  supportsHevcHardware: boolean; // hardware decode for HEVC
  maxResolution: "1080p" | "4k";
}

export const CLIENT_CAPABILITIES: Record<string, ClientCapability> = {
  web_chrome: {
    clientId: "web_chrome",
    containers: ["mp4", "webm"],
    videoCodecs: ["h264", "vp9", "av1"],
    audioCodecs: ["aac", "opus"],
    maxVideoBitrateMbps: 20,
    supportsHDR: false,
    supportsHevcHardware: false,
    maxResolution: "1080p",
  },
  android_tv: {
    clientId: "android_tv",
    containers: ["mp4", "mkv"],
    videoCodecs: ["h264", "hevc", "vp9"],
    audioCodecs: ["aac", "ac3", "eac3", "dts"],
    maxVideoBitrateMbps: 40,
    supportsHDR: true,
    supportsHevcHardware: true,
    maxResolution: "4k",
  },
  ios: {
    clientId: "ios",
    containers: ["mp4"],
    videoCodecs: ["h264", "hevc"],
    audioCodecs: ["aac", "ac3"],
    maxVideoBitrateMbps: 30,
    supportsHDR: true,
    supportsHevcHardware: true,
    maxResolution: "4k",
  },
};

// ---------- 2. Media File Profile ----------

export interface MediaProfile {
  path: string;
  container: string;       // e.g. "mkv"
  videoCodec: string;      // e.g. "hevc"
  audioCodec: string;      // e.g. "dts"
  bitrateMbps: number;
  isHDR: boolean;
  resolution: "1080p" | "4k";
}

// ---------- 3. Decision Types ----------

export type PlaybackDecision =
  | { action: "DIRECT_PLAY" }
  | { action: "REMUX"; targetContainer: string }
  | {
      action: "TRANSCODE";
      targetVideoCodec: string;
      targetAudioCodec: string;
      useHardwareAccel: boolean;
      reason: string;
    };

// ---------- 4. Core Decision Logic ----------

export function decidePlaybackStrategy(
  media: MediaProfile,
  client: ClientCapability
): PlaybackDecision {
  const containerOk = client.containers.includes(media.container);
  const videoCodecOk = client.videoCodecs.includes(media.videoCodec);
  const audioCodecOk = client.audioCodecs.includes(media.audioCodec);
  const bitrateOk = media.bitrateMbps <= client.maxVideoBitrateMbps;
  const resolutionOk =
    media.resolution === "1080p" || client.maxResolution === "4k";
  const hdrOk = !media.isHDR || client.supportsHDR;

  // Best case: everything matches, send as-is
  if (
    containerOk &&
    videoCodecOk &&
    audioCodecOk &&
    bitrateOk &&
    resolutionOk &&
    hdrOk
  ) {
    return { action: "DIRECT_PLAY" };
  }

  // Video/audio codecs are fine, only the container wrapper is wrong —
  // remux is a fast repackage, no re-encode needed.
  if (
    !containerOk &&
    videoCodecOk &&
    audioCodecOk &&
    bitrateOk &&
    resolutionOk &&
    hdrOk
  ) {
    // Prefer mp4 as the universal fallback container
    const targetContainer = client.containers.includes("mp4")
      ? "mp4"
      : client.containers[0];
    return { action: "REMUX", targetContainer };
  }

  // Otherwise, something structural is incompatible — transcode.
  const reasons: string[] = [];
  if (!videoCodecOk) reasons.push(`video codec ${media.videoCodec} unsupported`);
  if (!audioCodecOk) reasons.push(`audio codec ${media.audioCodec} unsupported`);
  if (!bitrateOk) reasons.push(`bitrate ${media.bitrateMbps}Mbps exceeds client limit`);
  if (!resolutionOk) reasons.push(`resolution ${media.resolution} exceeds client limit`);
  if (!hdrOk) reasons.push(`HDR unsupported by client`);

  const targetVideoCodec =
    media.videoCodec === "hevc" && client.supportsHevcHardware
      ? "hevc"
      : client.videoCodecs.includes("h264")
      ? "h264"
      : client.videoCodecs[0];

  const targetAudioCodec = client.audioCodecs.includes("aac")
    ? "aac"
    : client.audioCodecs[0];

  return {
    action: "TRANSCODE",
    targetVideoCodec,
    targetAudioCodec,
    useHardwareAccel:
      targetVideoCodec === "hevc" && client.supportsHevcHardware,
    reason: reasons.join("; "),
  };
}

// ---------- 5. Example usage ----------

// const decision = decidePlaybackStrategy(
//   {
//     path: "D:/Media/Movies/Dune.mkv",
//     container: "mkv",
//     videoCodec: "hevc",
//     audioCodec: "dts",
//     bitrateMbps: 35,
//     isHDR: true,
//     resolution: "4k",
//   },
//   CLIENT_CAPABILITIES.web_chrome
// );
// -> TRANSCODE, because Chrome can't do hevc/dts/HDR natively
//
// Same file against CLIENT_CAPABILITIES.android_tv -> DIRECT_PLAY
