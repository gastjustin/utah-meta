/**
 * UtahMeta - Library Scanner (Phase 4 preview)
 *
 * Walks a media root, finds video files, probes each one, and inserts
 * Library / StorageVolume / MediaItem / FileAsset rows — plus Series /
 * Season rows when a file's folder structure matches a TV layout
 * (Show/Season 01/file.mkv). Detection is convention-based, not a real
 * metadata lookup: it recognizes "Season 01", "S01", etc. as season
 * folders, and everything else falls back to being indexed as a movie.
 *
 * Still missing vs. a real Phase 4 scanner: metadata provider lookups
 * (TMDB/TVDB) for accurate titles/years/artwork instead of parsing
 * filenames, and incremental/file-watching rescans instead of a full
 * walk every time.
 */

import { readdir, stat } from "fs/promises";
import { join, extname, basename, sep, relative } from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { probeMediaFile } from "./ffprobe-integration";
import {
  isEnabled as metadataEnabled,
  searchMovie,
  searchSeries,
  getEpisode,
  downloadArtwork,
  cleanTitle,
} from "./metadata-provider";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"]);

export interface ScanResult {
  scanJobId: string;
  filesFound: number;
  added: number;
  updated: number; // existing file whose bytes changed on disk, re-probed
  skipped: number; // existing file, unchanged
  removed: number; // file gone from disk, pruned from the index
  failed: number;
}

// ---------- Directory walk ----------

async function findVideoFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findVideoFiles(fullPath)));
    } else if (VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results;
}

// ---------- TV vs. movie detection ----------
// Convention-based, not a real metadata lookup: if a file's immediate
// parent folder looks like a season folder ("Season 01", "S01", "s1"),
// treat it as a TV episode, with the grandparent folder as the series
// name. Everything else (flat file, or single folder-per-movie) is
// treated as a movie. This covers the common Sonarr/Radarr-style layout
// but won't handle every real-world naming scheme — a real Phase 4
// scanner would fall back to metadata-provider lookups instead of
// guessing from folder names alone.

interface DetectedItem {
  kind: "movie" | "episode";
  title: string;
  year?: number;
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

const SEASON_FOLDER_PATTERN = /^s(?:eason)?\s*0*(\d+)$/i;
const EPISODE_PATTERN = /s0*(\d+)e0*(\d+)/i;

function detectItem(rootPath: string, filePath: string): DetectedItem {
  const rel = relative(rootPath, filePath);
  const segments = rel.split(sep);
  const fileName = segments[segments.length - 1];
  const bareTitle = basename(fileName, extname(fileName));

  // segments.length > 1 means the file is nested at least one folder
  // deep; we need at least 2 folders deep (Show/Season) to detect TV.
  if (segments.length >= 3) {
    const seasonFolder = segments[segments.length - 2];
    const seasonMatch = seasonFolder.match(SEASON_FOLDER_PATTERN);

    if (seasonMatch) {
      const seriesName = segments[segments.length - 3];
      const seasonNumber = parseInt(seasonMatch[1], 10);
      const episodeMatch = bareTitle.match(EPISODE_PATTERN);
      const episodeNumber = episodeMatch ? parseInt(episodeMatch[2], 10) : undefined;

      // Strip a leading "ShowName - S01E02 - " style prefix if present,
      // otherwise just use the filename as the episode title.
      const title = episodeMatch
        ? bareTitle.slice(bareTitle.indexOf(episodeMatch[0]) + episodeMatch[0].length)
            .replace(/^[\s\-–_.]+/, "")
            .trim() || bareTitle
        : bareTitle;

      return { kind: "episode", title, seriesName, seasonNumber, episodeNumber };
    }
  }

  // Movie: strip release-tag noise and pull the year out of the filename
  // so the metadata provider can search on a clean title.
  const { title, year } = cleanTitle(bareTitle);
  return { kind: "movie", title, year: year ?? undefined };
}

// ---------- Ensure parent rows exist ----------

async function ensureLibrary(rootPath: string) {
  const existing = await prisma.library.findFirst({ where: { rootPath } });
  if (existing) return existing;

  return prisma.library.create({
    data: {
      name: basename(rootPath) || "Media Library",
      kind: "mixed", // may contain both movies and TV under the same root
      rootPath,
    },
  });
}

async function ensureStorageVolume(rootPath: string) {
  const existing = await prisma.storageVolume.findFirst({ where: { rootPath } });
  if (existing) return existing;

  return prisma.storageVolume.create({
    data: {
      name: basename(rootPath) || "Primary Volume",
      tier: "hot",
      rootPath,
      capacityBytes: BigInt(0), // unknown at scan time; populate from disk stats if needed
      rebuildable: false,
    },
  });
}

async function ensureSeries(libraryId: string, title: string) {
  return prisma.series.upsert({
    where: { libraryId_title: { libraryId, title } },
    update: {},
    create: { libraryId, title },
  });
}

async function ensureSeason(seriesId: string, seasonNumber: number) {
  return prisma.season.upsert({
    where: { seriesId_seasonNumber: { seriesId, seasonNumber } },
    update: {},
    create: { seriesId, seasonNumber, title: `Season ${seasonNumber}` },
  });
}

// ---------- Metadata enrichment (movies) ----------
// Best-effort TMDB lookup: replaces the filename-guessed title with the
// canonical one, fills in release year + runtime, records the external id,
// and downloads poster/backdrop artwork. Only runs when TMDB_API_KEY is set
// (checked by the caller via metadataEnabled()).

async function enrichMovie(
  mediaItemId: string,
  detected: DetectedItem,
  probedDurationSeconds: number
): Promise<void> {
  const meta = await searchMovie(detected.title, detected.year);
  if (!meta) {
    console.debug(`[library-scanner] no TMDB match for movie "${detected.title}"`);
    return;
  }

  // Prefer the real file's duration (ffprobe) over TMDB's advertised
  // runtime; fall back to TMDB only when ffprobe couldn't determine it.
  const runtimeMs =
    probedDurationSeconds > 0
      ? probedDurationSeconds * 1000
      : meta.runtimeMinutes
      ? meta.runtimeMinutes * 60 * 1000
      : null;

  await prisma.mediaItem.update({
    where: { mediaItemId },
    data: {
      title: meta.title,
      releaseYear: meta.releaseYear ?? undefined,
      runtimeMs: runtimeMs ?? undefined,
      canonicalMetadataId: `${meta.provider}:${meta.externalKey}`,
    },
  });

  // Record the external id, tolerant of re-scans (unique on provider+key).
  await prisma.externalIdMap.upsert({
    where: { provider_externalKey: { provider: meta.provider, externalKey: meta.externalKey } },
    update: { mediaItemId },
    create: { mediaItemId, provider: meta.provider, externalKey: meta.externalKey },
  });

  // Download artwork. Each is independent — a failed backdrop shouldn't
  // block the poster from being saved.
  for (const [kind, urlPath] of [
    ["poster", meta.posterUrlPath] as const,
    ["backdrop", meta.backdropUrlPath] as const,
  ]) {
    try {
      const art = await downloadArtwork(mediaItemId, kind, urlPath);
      if (art) {
        await prisma.artworkAsset.create({
          data: { mediaItemId, kind: art.kind, storageUri: art.storageUri },
        });
      }
    } catch (err) {
      console.error(`[library-scanner] ${kind} download failed for "${meta.title}":`, err);
    }
  }

  // Populate genres: clear old ones then insert fresh from TMDB.
  if (meta.genres.length > 0) {
    await prisma.mediaGenre.deleteMany({ where: { mediaItemId } });
    for (const genreName of meta.genres) {
      const genre = await prisma.genre.upsert({
        where: { name: genreName },
        update: {},
        create: { name: genreName },
        select: { genreId: true },
      });
      await prisma.mediaGenre.create({
        data: { mediaItemId, genreId: genre.genreId },
      });
    }
  }

  // Populate cast + directors: clear old credits then insert fresh.
  if (meta.cast.length > 0 || meta.directors.length > 0) {
    await prisma.mediaCredit.deleteMany({ where: { mediaItemId } });

    for (const member of meta.cast) {
      if (!member.name) continue;
      let person = await prisma.person.findFirst({
        where: { name: member.name },
        select: { personId: true },
      });
      if (!person) {
        person = await prisma.person.create({
          data: { name: member.name, personType: "actor" },
          select: { personId: true },
        });
      }
      await prisma.mediaCredit.create({
        data: {
          mediaItemId,
          personId: person.personId,
          creditRole: "actor",
          billingOrder: null,
        },
      });
    }

    for (const dirName of meta.directors) {
      let person = await prisma.person.findFirst({
        where: { name: dirName },
        select: { personId: true },
      });
      if (!person) {
        person = await prisma.person.create({
          data: { name: dirName, personType: "director" },
          select: { personId: true },
        });
      }
      await prisma.mediaCredit.create({
        data: {
          mediaItemId,
          personId: person.personId,
          creditRole: "director",
          billingOrder: null,
        },
      });
    }
  }
}

// ---------- Metadata enrichment (TV) ----------
// Series are enriched once (tmdbId acts as the "done" marker) — canonical
// title is intentionally NOT overwritten because Series is deduped by
// (libraryId, title); changing it would make the next scan create a
// duplicate. We store the TMDB id, first-air year, and poster/backdrop
// paths, and return the tmdbId so the episode lookup can reuse it.

async function enrichSeries(seriesId: string, seriesName: string): Promise<string | null> {
  const existing = await prisma.series.findUnique({
    where: { seriesId },
    select: { tmdbId: true },
  });
  if (existing?.tmdbId) return existing.tmdbId; // already enriched this scan/run

  const meta = await searchSeries(seriesName);
  if (!meta) {
    console.debug(`[library-scanner] no TMDB match for series "${seriesName}"`);
    return null;
  }

  let posterUri: string | undefined;
  let backdropUri: string | undefined;
  try {
    const poster = await downloadArtwork(`series-${seriesId}`, "poster", meta.posterUrlPath);
    posterUri = poster?.storageUri;
  } catch (err) {
    console.error(`[library-scanner] series poster download failed for "${meta.title}":`, err);
  }
  try {
    const backdrop = await downloadArtwork(`series-${seriesId}`, "backdrop", meta.backdropUrlPath);
    backdropUri = backdrop?.storageUri;
  } catch (err) {
    console.error(`[library-scanner] series backdrop download failed for "${meta.title}":`, err);
  }

  await prisma.series.update({
    where: { seriesId },
    data: {
      tmdbId: meta.externalKey,
      firstAirYear: meta.firstAirYear ?? undefined,
      posterUri,
      backdropUri,
    },
  });

  return meta.externalKey;
}

async function enrichEpisode(
  mediaItemId: string,
  seriesId: string,
  detected: DetectedItem,
  probedDurationSeconds: number
): Promise<void> {
  if (detected.seasonNumber == null || detected.episodeNumber == null) return;

  const tvId = await enrichSeries(seriesId, detected.seriesName ?? "");
  if (!tvId) return;

  const ep = await getEpisode(tvId, detected.seasonNumber, detected.episodeNumber);
  if (!ep) {
    console.debug(
      `[library-scanner] no TMDB episode for tv ${tvId} s${detected.seasonNumber}e${detected.episodeNumber}`
    );
    return;
  }

  // Prefer the real file's duration (ffprobe) over TMDB's advertised runtime.
  const runtimeMs =
    probedDurationSeconds > 0
      ? probedDurationSeconds * 1000
      : ep.runtimeMinutes
      ? ep.runtimeMinutes * 60 * 1000
      : null;

  await prisma.mediaItem.update({
    where: { mediaItemId },
    data: {
      title: ep.title,
      releaseYear: ep.airYear ?? undefined,
      runtimeMs: runtimeMs ?? undefined,
      canonicalMetadataId: `${ep.provider}:${ep.externalKey}`,
    },
  });

  await prisma.externalIdMap.upsert({
    where: { provider_externalKey: { provider: ep.provider, externalKey: ep.externalKey } },
    update: { mediaItemId },
    create: { mediaItemId, provider: ep.provider, externalKey: ep.externalKey },
  });

  try {
    const still = await downloadArtwork(mediaItemId, "still", ep.stillUrlPath);
    if (still) {
      await prisma.artworkAsset.create({
        data: { mediaItemId, kind: still.kind, storageUri: still.storageUri },
      });
    }
  } catch (err) {
    console.error(`[library-scanner] episode still download failed for "${ep.title}":`, err);
  }
}

// ---------- Prune files that disappeared from disk ----------
// Any FileAsset in this library whose sourcePath is no longer present in the
// current walk gets removed, along with its MediaItem and that item's
// dependent rows. Deletion order matters because the schema has no cascade
// rules — children must go before parents. Empty Series/Season shells are
// left behind (harmless, and cheap to leave).

async function pruneMissingFiles(
  libraryId: string,
  presentPaths: Set<string>
): Promise<number> {
  const indexed = await prisma.fileAsset.findMany({
    where: { mediaItem: { libraryId } },
    select: { fileAssetId: true, sourcePath: true, mediaItemId: true },
  });

  const missing = indexed.filter(
    (f: { sourcePath: string }) => !presentPaths.has(f.sourcePath)
  );
  let removed = 0;

  for (const file of missing) {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const mediaItemId = file.mediaItemId;
        // Dependent rows first (no ON DELETE cascade in the schema).
        await tx.artworkAsset.deleteMany({ where: { mediaItemId } });
        await tx.externalIdMap.deleteMany({ where: { mediaItemId } });
        await tx.mediaGenre.deleteMany({ where: { mediaItemId } });
        await tx.mediaCredit.deleteMany({ where: { mediaItemId } });
        await tx.collectionItem.deleteMany({ where: { mediaItemId } });
        await tx.watchState.deleteMany({ where: { mediaItemId } });
        await tx.preparationJob.deleteMany({ where: { mediaItemId } });
        await tx.versionVariant.deleteMany({ where: { mediaItemId } });
        await tx.fileAsset.deleteMany({ where: { mediaItemId } });
        await tx.mediaItem.delete({ where: { mediaItemId } });
      });
      removed++;
    } catch (err) {
      console.error(`[library-scanner] failed to prune "${file.sourcePath}":`, err);
    }
  }

  return removed;
}

// ---------- Core scan ----------

export async function scanLibrary(rootPath: string): Promise<ScanResult> {
  const library = await ensureLibrary(rootPath);
  const storageVolume = await ensureStorageVolume(rootPath);

  const scanJob = await prisma.scanJob.create({
    data: {
      library: { connect: { libraryId: library.libraryId } },
      scanType: "full",
      status: "running",
    },
  });

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let removed = 0;
  let failed = 0;
  let filesFound: string[] = [];

  try {
    filesFound = await findVideoFiles(rootPath);

    for (const filePath of filesFound) {
      try {
        const stats = await stat(filePath);
        // Postgres DateTime is millisecond-precision, so floor the fs
        // mtime to ms before storing/comparing or equality never holds.
        const fileMtime = new Date(Math.floor(stats.mtimeMs));

        const existing = await prisma.fileAsset.findUnique({
          where: { sourcePath: filePath },
          select: {
            fileAssetId: true,
            mediaItemId: true,
            sizeBytes: true,
            modifiedAt: true,
          },
        });

        if (existing) {
          const unchanged =
            existing.modifiedAt != null &&
            existing.modifiedAt.getTime() === fileMtime.getTime() &&
            existing.sizeBytes === BigInt(stats.size);
          if (unchanged) {
            skipped++;
            continue;
          }

          // File changed on disk (re-encoded, replaced in place). Re-probe
          // just the technical fields + runtime; it's still the same
          // logical item, so leave title/metadata/artwork alone.
          const changed = await probeMediaFile(filePath);
          await prisma.fileAsset.update({
            where: { fileAssetId: existing.fileAssetId },
            data: {
              container: changed.container,
              videoCodec: changed.videoCodec,
              audioCodec: changed.audioCodec,
              sizeBytes: BigInt(stats.size),
              modifiedAt: fileMtime,
            },
          });
          if (changed.durationSeconds > 0) {
            await prisma.mediaItem.update({
              where: { mediaItemId: existing.mediaItemId },
              data: { runtimeMs: changed.durationSeconds * 1000 },
            });
          }
          updated++;
          continue;
        }

        const profile = await probeMediaFile(filePath);
        const detected = detectItem(rootPath, filePath);

        const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          let seasonId: string | undefined;
          let seriesId: string | undefined;

          if (detected.kind === "episode" && detected.seriesName && detected.seasonNumber) {
            // Note: ensureSeries/ensureSeason use the module-level
            // `prisma` client rather than `tx` for simplicity — fine
            // for a single-threaded scan, but if you parallelize file
            // processing later, switch these to use `tx` too so
            // series/season creation is part of the same transaction.
            const series = await ensureSeries(library.libraryId, detected.seriesName);
            const season = await ensureSeason(series.seriesId, detected.seasonNumber);
            seasonId = season.seasonId;
            seriesId = series.seriesId;
          }

          const mediaItem = await tx.mediaItem.create({
            data: {
              libraryId: library.libraryId,
              seasonId,
              itemType: detected.kind === "episode" ? "episode" : "movie",
              title: detected.title,
              episodeNumber: detected.episodeNumber,
              runtimeMs: profile.durationSeconds > 0
                ? profile.durationSeconds * 1000
                : null,
            },
          });

          await tx.fileAsset.create({
            data: {
              mediaItemId: mediaItem.mediaItemId,
              storageVolumeId: storageVolume.storageVolumeId,
              sourcePath: filePath,
              container: profile.container,
              videoCodec: profile.videoCodec,
              audioCodec: profile.audioCodec,
              sizeBytes: BigInt(stats.size),
              modifiedAt: fileMtime,
            },
          });

          return { mediaItemId: mediaItem.mediaItemId, seriesId };
        });

        // Metadata enrichment happens AFTER the DB transaction commits —
        // it does network + disk I/O (TMDB lookup, artwork download), which
        // must never hold a Postgres transaction open. Best-effort: a
        // failed lookup leaves the ffprobe/filename-indexed row intact.
        if (metadataEnabled() && detected.kind === "movie") {
          try {
            await enrichMovie(created.mediaItemId, detected, profile.durationSeconds);
          } catch (err) {
            console.error(`[library-scanner] metadata enrichment failed for "${filePath}":`, err);
          }
        } else if (metadataEnabled() && detected.kind === "episode" && created.seriesId) {
          try {
            await enrichEpisode(created.mediaItemId, created.seriesId, detected, profile.durationSeconds);
          } catch (err) {
            console.error(`[library-scanner] episode enrichment failed for "${filePath}":`, err);
          }
        }

        added++;
      } catch (err) {
        // One bad file (corrupt, unreadable, ffprobe failure) shouldn't
        // kill the whole scan — log it and keep going.
        console.error(`[library-scanner] failed to index "${filePath}":`, err);
        failed++;
      }
    }

    // Prune anything that vanished from disk since the last scan. Done
    // after the walk so we have the full set of present paths to diff.
    removed = await pruneMissingFiles(library.libraryId, new Set(filesFound));

    await prisma.scanJob.update({
      where: { scanJobId: scanJob.scanJobId },
      data: { status: "done" },
    });
  } catch (err) {
    await prisma.scanJob.update({
      where: { scanJobId: scanJob.scanJobId },
      data: { status: "failed" },
    });
    throw err;
  }

  return {
    scanJobId: scanJob.scanJobId,
    filesFound: filesFound.length,
    added,
    updated,
    skipped,
    removed,
    failed,
  };
}
