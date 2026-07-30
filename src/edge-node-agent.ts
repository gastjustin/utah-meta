/**
 * UtahMeta Edge Node Agent
 *
 * Pulls a manifest of predicted/prepared variants from the UtahMeta server
 * and downloads them to a local cache directory for offline playback.
 *
 * Usage:
 *   UTAHMETA_URL=http://media-server:4100 \
 *   UTAHMETA_AUTH_SUBJECT=edge-user \
 *   UTAHMETA_HOME_NODE_ID=<node-id> \
 *   UTAHMETA_CACHE_DIR=/cache \
 *   npx tsx src/edge-node-agent.ts
 *
 * Or set UTAHMETA_POLL_INTERVAL_MS to run as a periodic sync daemon.
 */

import { createWriteStream } from "fs";
import { mkdir, stat, readdir, unlink } from "fs/promises";
import { join, basename } from "path";

const UTAHMETA_URL = process.env.UTAHMETA_URL || "http://localhost:4100";
const UTAHMETA_AUTH_SUBJECT = process.env.UTAHMETA_AUTH_SUBJECT || "edge-agent";
const UTAHMETA_HOME_NODE_ID = process.env.UTAHMETA_HOME_NODE_ID || "";
const UTAHMETA_CACHE_DIR = process.env.UTAHMETA_CACHE_DIR || "./cache";
const UTAHMETA_POLL_INTERVAL_MS = Number(process.env.UTAHMETA_POLL_INTERVAL_MS || 0);
const UTAHMETA_MAX_CACHE_SIZE_MB = Number(process.env.UTAHMETA_MAX_CACHE_SIZE_MB || 0);

interface ManifestVariant {
  variantId: string;
  mediaItemId: string;
  storageUri: string;
  prepState: string;
  directPlayReady: boolean;
  compatibilityProfile: { clientProfile: string } | null;
  mediaItem: { title: string };
  outputStorageVolume: { rootPath: string } | null;
}

let token: string | null = null;

async function authenticate(): Promise<void> {
  const res = await fetch(`${UTAHMETA_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authSubject: UTAHMETA_AUTH_SUBJECT,
      displayName: "Edge Node Agent",
    }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { token: string };
  token = data.token;
  console.log(`[edge-agent] authenticated as ${UTAHMETA_AUTH_SUBJECT}`);
}

async function apiGet<T>(path: string): Promise<T> {
  if (!token) await authenticate();
  const res = await fetch(`${UTAHMETA_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    token = null;
    await authenticate();
    return apiGet<T>(path);
  }
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as T;
}

async function downloadVariant(variant: ManifestVariant): Promise<void> {
  const filename = `${variant.variantId}.mp4`;
  const localPath = join(UTAHMETA_CACHE_DIR, filename);

  // Skip if already downloaded
  try {
    const st = await stat(localPath);
    if (st.size > 0) {
      console.log(`[edge-agent] already cached: ${filename} (${variant.mediaItem.title})`);
      return;
    }
  } catch {
    // File doesn't exist, proceed with download
  }

  console.log(`[edge-agent] downloading ${filename} (${variant.mediaItem.title})...`);
  const res = await fetch(`${UTAHMETA_URL}/download/variant/${variant.variantId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    token = null;
    await authenticate();
    return downloadVariant(variant);
  }
  if (!res.ok || !res.body) {
    console.error(`[edge-agent] download failed for ${variant.variantId}: ${res.status}`);
    return;
  }

  const ws = createWriteStream(localPath);
  const reader = (res.body as any).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      ws.write(value);
    }
    ws.end();
    console.log(`[edge-agent] cached: ${filename}`);
  } catch (err) {
    console.error(`[edge-agent] download error for ${variant.variantId}:`, err);
    try { await unlink(localPath); } catch {}
  }
}

async function evictIfNeeded(): Promise<void> {
  if (UTAHMETA_MAX_CACHE_SIZE_MB <= 0) return;

  const files = await readdir(UTAHMETA_CACHE_DIR);
  let totalBytes = 0;
  const fileInfos: { name: string; size: number; mtime: Date }[] = [];

  for (const name of files) {
    const st = await stat(join(UTAHMETA_CACHE_DIR, name));
    totalBytes += st.size;
    fileInfos.push({ name, size: st.size, mtime: st.mtime });
  }

  const maxBytes = UTAHMETA_MAX_CACHE_SIZE_MB * 1024 * 1024;
  if (totalBytes <= maxBytes) return;

  // Sort oldest first and evict until under limit
  fileInfos.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
  for (const f of fileInfos) {
    if (totalBytes <= maxBytes) break;
    await unlink(join(UTAHMETA_CACHE_DIR, f.name));
    totalBytes -= f.size;
    console.log(`[edge-agent] evicted: ${f.name} (freed ${Math.round(f.size / 1024 / 1024)}MB)`);
  }
}

async function syncOnce(): Promise<void> {
  if (!UTAHMETA_HOME_NODE_ID) {
    console.error("[edge-agent] UTAHMETA_HOME_NODE_ID is required");
    process.exit(1);
  }

  const manifest = await apiGet<ManifestVariant[]>(
    `/home-nodes/${UTAHMETA_HOME_NODE_ID}/manifest`
  );

  if (manifest.length === 0) {
    console.log("[edge-agent] manifest is empty — nothing to sync");
    return;
  }

  console.log(`[edge-agent] manifest has ${manifest.length} variants`);

  for (const variant of manifest) {
    await downloadVariant(variant);
  }

  await evictIfNeeded();
  console.log("[edge-agent] sync complete");
}

async function main(): Promise<void> {
  await mkdir(UTAHMETA_CACHE_DIR, { recursive: true });

  if (UTAHMETA_POLL_INTERVAL_MS > 0) {
    console.log(`[edge-agent] running in daemon mode (poll every ${UTAHMETA_POLL_INTERVAL_MS}ms)`);
    while (true) {
      try {
        await syncOnce();
      } catch (err) {
        console.error("[edge-agent] sync error:", err);
      }
      await new Promise((r) => setTimeout(r, UTAHMETA_POLL_INTERVAL_MS));
    }
  } else {
    await syncOnce();
  }
}

main().catch((err) => {
  console.error("[edge-agent] fatal:", err);
  process.exit(1);
});
