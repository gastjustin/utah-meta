/**
 * UtahMeta - Metadata Provider (Phase 4: Search & metadata services)
 *
 * Enriches scanned MediaItems with real metadata + artwork from TMDB
 * (The Movie Database). This is the piece that turns filename-guessed
 * titles into canonical titles, release years, runtimes, and downloaded
 * poster/backdrop images.
 *
 * Design notes:
 *  - Degrades gracefully. If TMDB_API_KEY is not set, isEnabled() returns
 *    false and the scanner simply skips enrichment — the library still
 *    indexes fine off ffprobe + filename parsing, just without artwork.
 *  - Network + disk I/O only. All DB writes happen in the scanner, so this
 *    module stays a pure "given a title, return metadata" adapter and can
 *    be swapped for TVDB/MusicBrainz later without touching scan logic.
 *  - Uses Node 20's global fetch — no HTTP client dependency.
 *
 * Set TMDB_API_KEY (a v3 API key from https://www.themoviedb.org/settings/api)
 * and optionally ARTWORK_PATH (where posters/backdrops are written).
 */

import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";

function apiKey(): string | undefined {
  return process.env.TMDB_API_KEY || undefined;
}

function artworkDir(): string {
  return process.env.ARTWORK_PATH || "./artwork";
}

export function isEnabled(): boolean {
  return Boolean(apiKey());
}

// ---------- Result shapes ----------

export interface MovieMetadata {
  provider: "tmdb";
  externalKey: string; // TMDB id as string
  title: string;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  posterUrlPath: string | null; // TMDB relative path, e.g. "/abc.jpg"
  backdropUrlPath: string | null;
}

export interface SeriesMetadata {
  provider: "tmdb";
  externalKey: string;
  title: string;
  firstAirYear: number | null;
  posterUrlPath: string | null;
  backdropUrlPath: string | null;
}

export interface EpisodeMetadata {
  provider: "tmdb";
  externalKey: string; // `${tvId}:s{season}e{episode}`
  title: string;
  airYear: number | null;
  runtimeMinutes: number | null;
  stillUrlPath: string | null;
}

export interface DownloadedArtwork {
  kind: string; // "poster" | "backdrop" | "still"
  storageUri: string; // local filesystem path
}

// ---------- TMDB queries ----------

async function tmdbGet(path: string, params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) throw new Error("[metadata-provider] TMDB_API_KEY not set");

  const url = new URL(`${TMDB_API_BASE}${path}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`[metadata-provider] TMDB ${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function searchMovie(
  title: string,
  year?: number
): Promise<MovieMetadata | null> {
  const params: Record<string, string> = { query: title, include_adult: "false" };
  if (year) params.year = String(year);

  const search = await tmdbGet("/search/movie", params);
  let hit = search.results?.[0];
  if (!hit) return null;

  // Basic disambiguation: if we extracted a year, prefer the first result
  // whose release year matches. TMDB's search/year filter is permissive, so
  // this catches cases where the top hit is a similarly-named reboot/earlier
  // film from a different year.
  if (year) {
    const matchingYear = search.results.find((r: any) => parseYear(r.release_date) === year);
    if (matchingYear) hit = matchingYear;
  }

  // A second call gets runtime, which the search endpoint doesn’t return.
  let runtimeMinutes: number | null = null;
  try {
    const detail = await tmdbGet(`/movie/${hit.id}`, {});
    runtimeMinutes =
      typeof detail.runtime === "number" && detail.runtime > 0 ? detail.runtime : null;
  } catch {
    // Detail lookup is best-effort — search result is still useful without it.
  }

  return {
    provider: "tmdb",
    externalKey: String(hit.id),
    title: hit.title ?? title,
    releaseYear: parseYear(hit.release_date),
    runtimeMinutes,
    posterUrlPath: hit.poster_path ?? null,
    backdropUrlPath: hit.backdrop_path ?? null,
  };
}

export async function searchSeries(name: string): Promise<SeriesMetadata | null> {
  const search = await tmdbGet("/search/tv", { query: name, include_adult: "false" });
  const hit = search.results?.[0];
  if (!hit) return null;

  return {
    provider: "tmdb",
    externalKey: String(hit.id),
    title: hit.name ?? name,
    firstAirYear: parseYear(hit.first_air_date),
    posterUrlPath: hit.poster_path ?? null,
    backdropUrlPath: hit.backdrop_path ?? null,
  };
}

// Fetch per-episode metadata (title, air date, runtime, still image) for a
// TV series already resolved to a TMDB id. Best-effort: returns null on any
// failure so the episode still keeps its filename/ffprobe-derived data.
export async function getEpisode(
  tvId: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<EpisodeMetadata | null> {
  try {
    const d = await tmdbGet(
      `/tv/${tvId}/season/${seasonNumber}/episode/${episodeNumber}`,
      {}
    );
    return {
      provider: "tmdb",
      externalKey: `${tvId}:s${seasonNumber}e${episodeNumber}`,
      title: d.name ?? `Episode ${episodeNumber}`,
      airYear: parseYear(d.air_date),
      runtimeMinutes:
        typeof d.runtime === "number" && d.runtime > 0 ? d.runtime : null,
      stillUrlPath: d.still_path ?? null,
    };
  } catch {
    return null;
  }
}

// ---------- Artwork download ----------
// Writes the image to ARTWORK_PATH/<idPrefix>-<kind>.jpg and returns the
// local path to store as ArtworkAsset.storageUri (or Series.posterUri).

export async function downloadArtwork(
  idPrefix: string,
  kind: string,
  urlPath: string | null
): Promise<DownloadedArtwork | null> {
  if (!urlPath) return null;

  const dir = artworkDir();
  await mkdir(dir, { recursive: true });

  const res = await fetch(`${TMDB_IMAGE_BASE}${urlPath}`);
  if (!res.ok) {
    throw new Error(`[metadata-provider] artwork download ${urlPath} -> ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const filePath = join(dir, `${idPrefix}-${kind}.jpg`);
  await writeFile(filePath, buffer);

  return { kind, storageUri: filePath };
}

// ---------- Helpers ----------

function parseYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

// Strips common release-tag noise from a filename-derived title so TMDB
// search actually matches. E.g. "Dune.Part.Two.2024.2160p.BluRay.x265"
// -> "Dune Part Two". Returns { title, year } — year is pulled out if a
// 4-digit year (1900-2099) is present in the raw string.
const QUALITY_TAGS =
  /\b(1080p|720p|2160p|4k|480p|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|hdrip|dvdrip|x264|x265|h264|h265|hevc|aac|ac3|dts|ddp?5\.1|atmos|remux|proper|repack|hdr|dv|imax|extended|unrated|directors?\.?cut)\b/gi;

export function cleanTitle(raw: string): { title: string; year: number | null } {
  let s = raw.replace(/[._]/g, " ");

  const yearMatch = s.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  if (yearMatch) {
    // Drop everything from the year onward — release tags trail it.
    s = s.slice(0, yearMatch.index).trim();
  }

  s = s.replace(QUALITY_TAGS, " ");
  s = s.replace(/[\[\]()]/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim();

  return { title: s || raw, year };
}
