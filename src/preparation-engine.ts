/**
 * UtahMeta - Phase 5: Smart Preparation Layer
 *
 * Background preparation of media variants that are guaranteed to be
 * direct-playable by a given client. When a playback request would need a
 * remux/transcode, this layer can queue a job to pre-build that copy so
 * subsequent requests (and predictive cache fills) hit the fast path.
 *
 * Flow:
 *   1. A client capability (e.g. "web_chrome") maps to a CompatibilityProfile.
 *   2. Playback sees a non-direct source and looks for a ready VersionVariant.
 *   3. If found, playback uses the prepared copy; if not, it starts a live
 *      transcode and queues a background prep job.
 *   4. The worker runs ffmpeg to create the prepared file and stores the
 *      output path in VersionVariant.storageUri.
 */

import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { prisma } from "./db";
import {
  CLIENT_CAPABILITIES,
  ClientCapability,
  decidePlaybackStrategy,
} from "./direct-play-engine";
import { buildFfmpegArgs } from "./ffmpeg-stream-engine";
import { probeMediaFile } from "./ffprobe-integration";

const PREPARED_MEDIA_PATH = process.env.PREPARED_MEDIA_PATH ?? "./prepared";

// ---------- Compatibility profile management ----------

function pickTargetContainer(client: ClientCapability): string {
  return client.containers.includes("mp4")
    ? "mp4"
    : client.containers[0];
}

function pickTargetVideoCodec(client: ClientCapability): string {
  // h264 is the universal safe choice for prepared copies.
  return client.videoCodecs.includes("h264")
    ? "h264"
    : client.videoCodecs[0];
}

function pickTargetAudioCodec(client: ClientCapability): string {
  return client.audioCodecs.includes("aac")
    ? "aac"
    : client.audioCodecs[0];
}

export async function getOrCreateCompatibilityProfile(
  client: ClientCapability
): Promise<string> {
  const container = pickTargetContainer(client);
  const videoCodec = pickTargetVideoCodec(client);
  const audioCodec = pickTargetAudioCodec(client);

  const existing = await prisma.compatibilityProfile.findUnique({
    where: { name: client.clientId },
  });

  if (existing) {
    // If the stored profile no longer matches the in-code capability matrix,
    // update it so future preps use the latest target.
    if (
      existing.container !== container ||
      existing.videoCodec !== videoCodec ||
      existing.audioCodec !== audioCodec ||
      existing.maxResolution !== client.maxResolution
    ) {
      await prisma.compatibilityProfile.update({
        where: { compatibilityProfileId: existing.compatibilityProfileId },
        data: { container, videoCodec, audioCodec, maxResolution: client.maxResolution },
      });
    }
    return existing.compatibilityProfileId;
  }

  const created = await prisma.compatibilityProfile.create({
    data: {
      name: client.clientId,
      container,
      videoCodec,
      audioCodec,
      maxResolution: client.maxResolution,
    },
  });
  return created.compatibilityProfileId;
}

// ---------- Variant discovery / queue ----------

export async function findReadyVariant(
  mediaItemId: string,
  compatibilityProfileId: string
) {
  return prisma.versionVariant.findFirst({
    where: {
      mediaItemId,
      compatibilityProfileId,
      prepState: "ready",
      directPlayReady: true,
      storageUri: { not: null },
    },
  });
}

export async function queuePrepJob(
  mediaItemId: string,
  sourceFileAssetId: string,
  compatibilityProfileId: string
): Promise<void> {
  // Only queue one pending/running job for this (media, profile) pair.
  const existing = await prisma.preparationJob.findFirst({
    where: {
      mediaItemId,
      compatibilityProfileId,
      status: { in: ["queued", "running"] },
    },
  });
  if (existing) return;

  await prisma.preparationJob.create({
    data: {
      mediaItemId,
      sourceFileAssetId,
      compatibilityProfileId,
      status: "queued",
    },
  });
}

// ---------- Worker: run one prep job ----------

function ensurePreparedDir(): void {
  mkdirSync(resolve(PREPARED_MEDIA_PATH), { recursive: true });
}

function variantOutputPath(
  mediaItemId: string,
  variantId: string,
  container: string
): string {
  ensurePreparedDir();
  const ext = container === "matroska" ? "mkv" : container;
  const dir = join(resolve(PREPARED_MEDIA_PATH), mediaItemId);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${variantId}.${ext}`);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

export async function runPrepJob(prepJobId: string): Promise<void> {
  const job = await prisma.preparationJob.update({
    where: { prepJobId },
    data: { status: "running" },
  });

  try {
    const source = await prisma.fileAsset.findUnique({
      where: { fileAssetId: job.sourceFileAssetId },
    });
    if (!source) throw new Error(`source FileAsset not found: ${job.sourceFileAssetId}`);

    const profile = await prisma.compatibilityProfile.findUnique({
      where: { compatibilityProfileId: job.compatibilityProfileId },
    });
    if (!profile) throw new Error(`CompatibilityProfile not found: ${job.compatibilityProfileId}`);

    const client = CLIENT_CAPABILITIES[profile.name];
    if (!client) throw new Error(`Unknown client capability: ${profile.name}`);

    const media = await probeMediaFile(source.sourcePath);
    const decision = decidePlaybackStrategy(media, client);

    // Source already matches the target profile — identity variant.
    if (decision.action === "DIRECT_PLAY") {
      const variant = await prisma.versionVariant.create({
        data: {
          mediaItemId: job.mediaItemId,
          sourceFileAssetId: job.sourceFileAssetId,
          compatibilityProfileId: job.compatibilityProfileId,
          storageUri: source.sourcePath,
          directPlayReady: true,
          prepState: "ready",
        },
      });
      await prisma.preparationJob.update({
        where: { prepJobId },
        data: { status: "done", outputVariantId: variant.variantId },
      });
      return;
    }

    const variant = await prisma.versionVariant.create({
      data: {
        mediaItemId: job.mediaItemId,
        sourceFileAssetId: job.sourceFileAssetId,
        compatibilityProfileId: job.compatibilityProfileId,
        prepState: "pending",
        directPlayReady: false,
      },
    });

    const outputPath = variantOutputPath(job.mediaItemId, variant.variantId, profile.container);

    let args = buildFfmpegArgs(media, decision, outputPath);
    // If audio is being re-encoded, apply EBU R128 loudness normalization.
    if (decision.action === "TRANSCODE" && decision.targetAudioCodec === "aac") {
      const output = args.pop();
      args.push("-af", "loudnorm=I=-23:LRA=7:TP=-2.0");
      if (output) args.push(output);
    }

    await runFfmpeg(args);

    const completed = await prisma.versionVariant.update({
      where: { variantId: variant.variantId },
      data: {
        storageUri: outputPath,
        storageVolumeId: await ensurePreparedVolume(),
        prepState: "ready",
        directPlayReady: true,
      },
    });

    await prisma.preparationJob.update({
      where: { prepJobId },
      data: { status: "done", outputVariantId: completed.variantId },
    });
  } catch (err) {
    await prisma.preparationJob.update({
      where: { prepJobId },
      data: { status: "failed" },
    });
    throw err;
  }
}

async function ensurePreparedVolume(): Promise<string | undefined> {
  const root = resolve(PREPARED_MEDIA_PATH);
  const existing = await prisma.storageVolume.findFirst({
    where: { rootPath: root },
  });
  if (existing) return existing.storageVolumeId;

  // We don't know the real capacity, so mark it as unknown (-1n) and
  // rebuildable = true so the system can recreate prepared copies if lost.
  const created = await prisma.storageVolume.create({
    data: {
      name: "prepared",
      tier: "hot",
      rootPath: root,
      capacityBytes: BigInt(-1),
      rebuildable: true,
    },
  });
  return created.storageVolumeId;
}

// ---------- Background worker loop ----------

const PREP_WORKER_INTERVAL_MS = 5000;
const PREP_MAX_CONCURRENT = 1;
let prepRunning = 0;

async function processOnePrepJob(): Promise<void> {
  const job = await prisma.preparationJob.findFirst({
    where: { status: "queued" },
    orderBy: { queuedAt: "asc" },
  });
  if (!job) return;

  prepRunning++;
  try {
    await runPrepJob(job.prepJobId);
  } catch (err) {
    console.error(`[prep-worker] job ${job.prepJobId} failed:`, err);
  } finally {
    prepRunning--;
  }
}

export function startPrepWorker(): void {
  setInterval(() => {
    if (prepRunning < PREP_MAX_CONCURRENT) {
      processOnePrepJob();
    }
  }, PREP_WORKER_INTERVAL_MS);
  console.log("[prep-worker] started");
}
