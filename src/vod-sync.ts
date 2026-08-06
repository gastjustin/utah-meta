/**
 * UtahMeta - IPTV VOD sync
 * Imports movies and series from M3U / Xtreme Codes sources into the
 * existing Library as MediaItem rows so they appear alongside local content.
 */

import { prisma } from "./db";
import { parseM3U, fetchM3UFromURL, fetchXtreamVodStreams, fetchXtreamSeries, ParsedVodMovie, XtreamSeries } from "./vod-parser";

function sourcePrefix(sourceId: string) {
  return `iptv_vod:${sourceId}`;
}

export interface SyncVodResult {
  movies: number;
  series: number;
  episodes: number;
}

export async function syncVodFromSource(
  sourceId: string,
  sourceConfig: { kind: string; config: string }
): Promise<SyncVodResult> {
  const library = await findOrCreateVodLibrary();
  const source = sourcePrefix(sourceId);

  let movies: ParsedVodMovie[] = [];
  let seriesList: XtreamSeries[] = [];

  if (sourceConfig.kind === "m3u_url") {
    const cfg = JSON.parse(sourceConfig.config) as { url: string };
    const channels = await fetchM3UFromURL(cfg.url);
    movies = channels.map((c) => ({
      id: c.streamUrl,
      title: c.name,
      logo: c.logoUrl,
      streamUrl: c.streamUrl,
      year: undefined,
      plot: undefined,
    }));
  } else if (sourceConfig.kind === "m3u_file") {
    const cfg = JSON.parse(sourceConfig.config) as { content: string };
    const channels = await parseM3U(cfg.content);
    movies = channels.map((c) => ({
      id: c.streamUrl,
      title: c.name,
      logo: c.logoUrl,
      streamUrl: c.streamUrl,
      year: undefined,
      plot: undefined,
    }));
  } else if (sourceConfig.kind === "xtream") {
    const cfg = JSON.parse(sourceConfig.config);
    movies = await fetchXtreamVodStreams(cfg);
    seriesList = await fetchXtreamSeries(cfg);
  }

  const result: SyncVodResult = { movies: 0, series: 0, episodes: 0 };
  const provider = `iptv_vod:${sourceId}`;

  for (const m of movies) {
    const existing = await prisma.externalIdMap.findFirst({
      where: { provider, externalKey: m.id },
      select: { mediaItemId: true },
    });

    if (existing) {
      await prisma.mediaItem.update({
        where: { mediaItemId: existing.mediaItemId },
        data: { streamUrl: m.streamUrl },
      });
      continue;
    }

    const mediaItem = await prisma.mediaItem.create({
      data: {
        libraryId: library.libraryId,
        itemType: "movie",
        title: m.title,
        releaseYear: m.year,
        overview: m.plot,
        streamUrl: m.streamUrl,
        source,
      },
    });

    if (m.logo) {
      await prisma.artworkAsset.create({
        data: {
          mediaItemId: mediaItem.mediaItemId,
          kind: "poster",
          storageUri: m.logo,
          checksum: "",
        },
      });
    }

    await prisma.externalIdMap.create({
      data: {
        mediaItemId: mediaItem.mediaItemId,
        provider,
        externalKey: m.id,
      },
    });
    result.movies++;
  }

  for (const s of seriesList) {
    const existingSeries = await prisma.series.findFirst({
      where: { libraryId: library.libraryId, title: s.title },
      select: { seriesId: true },
    });

    let seriesId = existingSeries?.seriesId;
    if (!seriesId) {
      const created = await prisma.series.create({
        data: {
          libraryId: library.libraryId,
          title: s.title,
          status: s.status,
          posterUri: s.poster,
          backdropUri: s.backdrop,
        },
      });
      seriesId = created.seriesId;
      result.series++;
    }

    const existingSeasons = await prisma.season.findMany({
      where: { seriesId },
      select: { seasonId: true, seasonNumber: true },
    });

    const seasonMap = new Map<number, string>();
    for (const season of existingSeasons) {
      seasonMap.set(season.seasonNumber, season.seasonId);
    }

    for (const ep of s.episodes) {
      let seasonId = seasonMap.get(ep.seasonNumber);
      if (!seasonId) {
        const created = await prisma.season.create({
          data: {
            seriesId,
            seasonNumber: ep.seasonNumber,
          },
        });
        seasonId = created.seasonId;
        seasonMap.set(ep.seasonNumber, seasonId);
      }

      const existingEpisode = await prisma.externalIdMap.findFirst({
        where: { provider, externalKey: ep.id },
        select: { mediaItemId: true },
      });

      if (existingEpisode) {
        continue;
      }

      const mediaItem = await prisma.mediaItem.create({
        data: {
          libraryId: library.libraryId,
          seasonId,
          itemType: "episode",
          title: ep.title,
          episodeNumber: ep.episodeNumber,
          runtimeMs: ep.runtimeMs,
          overview: ep.plot,
          streamUrl: ep.streamUrl,
          source,
        },
      });

      if (ep.thumbnail || s.poster) {
        await prisma.artworkAsset.create({
          data: {
            mediaItemId: mediaItem.mediaItemId,
            kind: "poster",
            storageUri: ep.thumbnail || s.poster || "",
            checksum: "",
          },
        });
      }

      await prisma.externalIdMap.create({
        data: {
          mediaItemId: mediaItem.mediaItemId,
          provider,
          externalKey: ep.id,
        },
      });
      result.episodes++;
    }
  }

  return result;
}

async function findOrCreateVodLibrary() {
  const existing = await prisma.library.findFirst({
    where: { kind: "vod" },
    orderBy: { libraryId: "asc" },
  });
  if (existing) return existing;
  return prisma.library.create({
    data: {
      name: "IPTV VOD",
      kind: "vod",
      rootPath: "/vod",
    },
  });
}
