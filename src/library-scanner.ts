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
import { prisma } from "./db";
import { probeMediaFile } from "./ffprobe-integration";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"]);

export interface ScanResult {
  scanJobId: string;
  filesFound: number;
  added: number;
  skipped: number;
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

  return { kind: "movie", title: bareTitle };
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
  let skipped = 0;
  let failed = 0;
  let filesFound: string[] = [];

  try {
    filesFound = await findVideoFiles(rootPath);

    for (const filePath of filesFound) {
      try {
        const existing = await prisma.fileAsset.findUnique({
          where: { sourcePath: filePath },
        });
        if (existing) {
          skipped++;
          continue;
        }

        const [profile, stats] = await Promise.all([
          probeMediaFile(filePath),
          stat(filePath),
        ]);

        const detected = detectItem(rootPath, filePath);

        await prisma.$transaction(async (tx: typeof prisma) => {
          let seasonId: string | undefined;

          if (detected.kind === "episode" && detected.seriesName && detected.seasonNumber) {
            // Note: ensureSeries/ensureSeason use the module-level
            // `prisma` client rather than `tx` for simplicity — fine
            // for a single-threaded scan, but if you parallelize file
            // processing later, switch these to use `tx` too so
            // series/season creation is part of the same transaction.
            const series = await ensureSeries(library.libraryId, detected.seriesName);
            const season = await ensureSeason(series.seriesId, detected.seasonNumber);
            seasonId = season.seasonId;
          }

          const mediaItem = await tx.mediaItem.create({
            data: {
              libraryId: library.libraryId,
              seasonId,
              itemType: detected.kind === "episode" ? "episode" : "movie",
              title: detected.title,
              episodeNumber: detected.episodeNumber,
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
            },
          });
        });

        added++;
      } catch (err) {
        // One bad file (corrupt, unreadable, ffprobe failure) shouldn't
        // kill the whole scan — log it and keep going.
        console.error(`[library-scanner] failed to index "${filePath}":`, err);
        failed++;
      }
    }

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
    skipped,
    failed,
  };
}
