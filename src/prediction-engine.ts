/**
 * UtahMeta - Phase 6: Predictive Edge Cache
 *
 * Lightweight prediction engine: when a user finishes an episode, figure
 * out what they're most likely to watch next and pre-stage a prepared
 * direct-play variant for that item on their active client profile.
 *
 * For now the "cache" is a pre-transcoded/remuxed file in
 * PREPARED_MEDIA_PATH; the home-node copy-out is a future step once a
 * UtahMeta node agent exists. PredictionEvent rows provide the audit trail.
 */

import { prisma } from "./db";
import { CLIENT_CAPABILITIES } from "./direct-play-engine";
import {
  getOrCreateCompatibilityProfile,
  findReadyVariant,
  queuePrepJob,
} from "./preparation-engine";

async function getNextEpisode(mediaItemId: string): Promise<string | null> {
  const current = await prisma.mediaItem.findUnique({
    where: { mediaItemId },
    include: { season: true },
  });

  if (!current?.season || current.episodeNumber == null) return null;

  // Next episode in the same season.
  const nextInSeason = await prisma.mediaItem.findFirst({
    where: {
      seasonId: current.seasonId!,
      episodeNumber: { gt: current.episodeNumber },
    },
    orderBy: { episodeNumber: "asc" },
  });
  if (nextInSeason) return nextInSeason.mediaItemId;

  // Otherwise the first episode of the next season in the same series.
  const nextSeason = await prisma.season.findFirst({
    where: {
      seriesId: current.season.seriesId,
      seasonNumber: { gt: current.season.seasonNumber },
    },
    orderBy: { seasonNumber: "asc" },
  });
  if (!nextSeason) return null;

  const firstEpisode = await prisma.mediaItem.findFirst({
    where: { seasonId: nextSeason.seasonId },
    orderBy: { episodeNumber: "asc" },
  });
  return firstEpisode?.mediaItemId ?? null;
}

export async function predictAndStage(
  userId: string,
  currentMediaItemId: string,
  clientType: string
): Promise<void> {
  const nextMediaItemId = await getNextEpisode(currentMediaItemId);
  if (!nextMediaItemId) {
    console.debug(`[prediction] no next episode after ${currentMediaItemId}`);
    return;
  }

  const client = CLIENT_CAPABILITIES[clientType];
  if (!client) {
    console.debug(`[prediction] unknown clientType "${clientType}"`);
    return;
  }

  const fileAsset = await prisma.fileAsset.findFirst({
    where: { mediaItemId: nextMediaItemId },
    orderBy: { sourcePath: "asc" },
    select: { fileAssetId: true, mediaItemId: true },
  });
  if (!fileAsset) {
    console.debug(`[prediction] no FileAsset for predicted ${nextMediaItemId}`);
    return;
  }

  const compatProfileId = await getOrCreateCompatibilityProfile(client);
  const ready = await findReadyVariant(fileAsset.mediaItemId, compatProfileId);
  if (ready) {
    console.debug(`[prediction] variant already ready for ${nextMediaItemId}`);
    return;
  }

  // Don't queue more than one pending/running job for this (item, profile).
  const alreadyQueued = await prisma.preparationJob.findFirst({
    where: {
      mediaItemId: fileAsset.mediaItemId,
      compatibilityProfileId: compatProfileId,
      status: { in: ["queued", "running"] },
    },
  });
  if (alreadyQueued) {
    console.debug(`[prediction] prep job already queued for ${nextMediaItemId}`);
    return;
  }

  await queuePrepJob(fileAsset.mediaItemId, fileAsset.fileAssetId, compatProfileId);

  await prisma.predictionEvent.create({
    data: {
      userId,
      currentMediaItemId,
      predictedMediaItemId: nextMediaItemId,
      confidence: 1.0,
    },
  });

  console.log(`[prediction] staged next episode ${nextMediaItemId} for ${clientType}`);
}
