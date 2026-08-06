/**
 * UtahMeta - Live TV source parser
 * Handles M3U playlists (URL or raw text) and Xtreme Codes (player_api.php)
 * authentication and channel lists.
 */

export interface ParsedChannel {
  channelNumber?: number;
  name: string;
  logoUrl?: string;
  groupName?: string;
  streamUrl: string;
  epgId?: string;
}

export interface XtreamConfig {
  baseUrl: string;
  username: string;
  password: string;
  apiPath?: string;
  output?: string;
}

interface M3UAttributes {
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  tvgId?: string;
  channelNumber?: number;
}

function parseExtinfAttrs(line: string): M3UAttributes {
  const attrs: M3UAttributes = {};
  const quoteRe = /(\w+(-\w+)*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(line)) !== null) {
    const key = m[1];
    const value = m[3];
    switch (key) {
      case "tvg-name":
        attrs.tvgName = value;
        break;
      case "tvg-logo":
        attrs.tvgLogo = value;
        break;
      case "group-title":
        attrs.groupTitle = value;
        break;
      case "tvg-id":
        attrs.tvgId = value;
        break;
      case "tvg-chno":
      case "channel-number":
        attrs.channelNumber = parseInt(value, 10) || undefined;
        break;
    }
  }
  return attrs;
}

export async function parseM3U(content: string): Promise<ParsedChannel[]> {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const channels: ParsedChannel[] = [];
  let pending: M3UAttributes & { name?: string } | null = null;

  for (const line of lines) {
    if (line.toUpperCase().startsWith("#EXTINF")) {
      const commaIndex = line.indexOf(",");
      const headerPart = commaIndex >= 0 ? line.slice(0, commaIndex) : line;
      const namePart = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";
      const attrs = parseExtinfAttrs(headerPart);
      pending = { ...attrs, name: namePart || attrs.tvgName || undefined };
    } else if (line.startsWith("#")) {
      continue;
    } else if (pending) {
      channels.push({
        channelNumber: pending.channelNumber,
        name: pending.name || "Unknown Channel",
        logoUrl: pending.tvgLogo,
        groupName: pending.groupTitle,
        streamUrl: line,
        epgId: pending.tvgId,
      });
      pending = null;
    } else if (line.match(/^https?:\/\//)) {
      // Allow loose M3U without #EXTINF
      channels.push({
        name: `Channel ${channels.length + 1}`,
        streamUrl: line,
      });
    }
  }

  return channels;
}

export async function fetchM3UFromURL(url: string): Promise<ParsedChannel[]> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch M3U: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parseM3U(text);
}

export async function fetchXtreamChannels(cfg: XtreamConfig): Promise<ParsedChannel[]> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const apiPath = cfg.apiPath?.replace(/^\//, "") || "player_api.php";
  const output = cfg.output || "m3u8";

  const authQs = new URLSearchParams({
    username: cfg.username,
    password: cfg.password,
    action: "get_live_streams",
  });

  const url = `${base}/${apiPath}?${authQs.toString()}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Xtream streams request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as any[];

  const categoriesRes = await fetch(
    `${base}/${apiPath}?${new URLSearchParams({
      username: cfg.username,
      password: cfg.password,
      action: "get_live_categories",
    }).toString()}`,
    { redirect: "follow" }
  );
  const categories = categoriesRes.ok
    ? (await categoriesRes.json() as { category_id: string; category_name: string }[])
    : [];
  const categoryMap = new Map(categories.map((c) => [String(c.category_id), c.category_name]));

  return data.map((stream: any, index: number) => {
    const streamId = String(stream.stream_id);
    const groupName =
      stream.category_name ||
      categoryMap.get(String(stream.category_id)) ||
      undefined;
    const streamUrl = `${base}/live/${cfg.username}/${cfg.password}/${streamId}.${output}`;
    return {
      channelNumber: stream.num
        ? parseInt(stream.num, 10) || index + 1
        : index + 1,
      name: stream.name || `Channel ${index + 1}`,
      logoUrl: stream.stream_icon || undefined,
      groupName,
      streamUrl,
      epgId: stream.epg_channel_id ? String(stream.epg_channel_id) : undefined,
    };
  });
}
