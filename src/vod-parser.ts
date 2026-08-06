/**
 * UtahMeta - IPTV VOD parser
 * Parses M3U VOD playlists and fetches Xtreme Codes VOD/series streams.
 */

import { parseM3U, fetchM3UFromURL, fetchWithTimeout, XtreamConfig } from "./live-tv-parser";

export interface ParsedVodMovie {
  id: string;
  title: string;
  logo?: string;
  streamUrl: string;
  year?: number;
  plot?: string;
  container?: string;
}

export interface XtreamEpisode {
  id: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  streamUrl: string;
  thumbnail?: string;
  runtimeMs?: number;
  plot?: string;
  container?: string;
}

export interface XtreamSeries {
  id: string;
  title: string;
  status?: string;
  poster?: string;
  backdrop?: string;
  episodes: XtreamEpisode[];
}

interface XtreamVodStream {
  stream_id: string;
  name: string;
  stream_icon?: string;
  container_extension?: string;
  added?: string;
  category_id?: string;
  direct_source?: string;
  info?: {
    year?: string;
    plot?: string;
    duration?: string;
    movie_image?: string;
  };
}

interface XtreamSeriesInfoResponse {
  episodes?: Record<string, any[]>;
  info?: any;
}

export { parseM3U, fetchM3UFromURL, XtreamConfig };

export async function fetchXtreamVodStreams(cfg: XtreamConfig): Promise<ParsedVodMovie[]> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const apiPath = cfg.apiPath?.replace(/^\//, "") || "player_api.php";

  const url = `${base}/${apiPath}?${new URLSearchParams({
    username: cfg.username,
    password: cfg.password,
    action: "get_vod_streams",
  }).toString()}`;

  console.log(`[vod] fetching Xtream VOD streams from ${url}`);
  let res;
  try {
    res = await fetchWithTimeout(url, { redirect: "follow" }, 60000);
  } catch (err: any) {
    const cause = err.cause ? ` (${err.cause.message || err.cause})` : "";
    throw new Error(`VOD fetch failed for ${url}: ${err.message}${cause}`);
  }
  if (!res.ok) {
    throw new Error(`Xtream VOD request failed: ${res.status} ${res.statusText} at ${url}`);
  }
  const data = (await res.json()) as XtreamVodStream[];

  return data.map((stream) => {
    const streamId = String(stream.stream_id);
    const ext = stream.container_extension || "mp4";
    const movieUrl = `${base}/movie/${cfg.username}/${cfg.password}/${streamId}.${ext}`;
    const title = String(stream.name || `Movie ${streamId}`);
    const info = stream.info || {};
    const year = info.year ? parseInt(info.year, 10) || undefined : undefined;
    const plot = info.plot ? String(info.plot) : undefined;
    const logo = stream.stream_icon || info.movie_image;

    return {
      id: streamId,
      title,
      logo,
      streamUrl: movieUrl,
      year,
      plot,
      container: ext,
    };
  });
}

export async function fetchXtreamSeries(cfg: XtreamConfig): Promise<XtreamSeries[]> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const apiPath = cfg.apiPath?.replace(/^\//, "") || "player_api.php";

  const url = `${base}/${apiPath}?${new URLSearchParams({
    username: cfg.username,
    password: cfg.password,
    action: "get_series",
  }).toString()}`;

  console.log(`[vod] fetching Xtream series list from ${url}`);
  const res = await fetchWithTimeout(url, { redirect: "follow" }, 60000);
  if (!res.ok) {
    throw new Error(`Xtream series request failed: ${res.status} ${res.statusText} at ${url}`);
  }
  const list = (await res.json()) as any[];

  const result: XtreamSeries[] = [];
  for (const s of list) {
    const seriesId = String(s.series_id);
    const infoUrl = `${base}/${apiPath}?${new URLSearchParams({
      username: cfg.username,
      password: cfg.password,
      action: "get_series_info",
      series_id: seriesId,
    }).toString()}`;
    let infoRes;
    try {
      infoRes = await fetchWithTimeout(infoUrl, { redirect: "follow" }, 30000);
    } catch {
      continue;
    }
    if (!infoRes.ok) continue;

    const info = (await infoRes.json()) as XtreamSeriesInfoResponse;
    const episodes: XtreamEpisode[] = [];
    const rawEpisodes = info.episodes || {};

    for (const [seasonKey, eps] of Object.entries(rawEpisodes)) {
      const seasonNumber = parseInt(seasonKey, 10) || 1;
      for (const [index, ep] of (eps as any[]).entries()) {
        const episodeId = String(ep.id);
        const title = String(ep.title || `Episode ${index + 1}`);
        const container = ep.container_extension || s.container_extension || "mp4";
        const streamUrl = `${base}/series/${cfg.username}/${cfg.password}/${episodeId}.${container}`;

        episodes.push({
          id: episodeId,
          title,
          seasonNumber,
          episodeNumber: ep.episode_num ? parseInt(ep.episode_num, 10) || index + 1 : index + 1,
          streamUrl,
          thumbnail: ep.info?.movie_image || ep.stream_icon,
          runtimeMs: ep.info?.duration_secs
            ? parseInt(ep.info.duration_secs, 10) * 1000
            : undefined,
          plot: ep.info?.plot ? String(ep.info.plot) : undefined,
          container,
        });
      }
    }

    if (episodes.length === 0) continue;

    result.push({
      id: seriesId,
      title: String(s.name || `Series ${seriesId}`),
      status: s.status ? String(s.status) : undefined,
      poster: s.cover ? String(s.cover) : undefined,
      backdrop: s.backdrop ? String(s.backdrop) : s.cover ? String(s.cover) : undefined,
      episodes,
    });
  }

  return result;
}
