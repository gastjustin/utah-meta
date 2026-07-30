/**
 * UtahMeta Edge Node Agent
 *
 * Pulls a manifest of predicted/prepared variants from the UtahMeta server,
 * downloads them, and encrypts them at rest with AES-256-GCM using a
 * household-specific key. A local HTTP proxy decrypts on-the-fly for
 * playback via localhost.
 *
 * Usage:
 *   UTAHMETA_URL=http://media-server:4100 \
 *   UTAHMETA_AUTH_SUBJECT=edge-user \
 *   UTAHMETA_HOME_NODE_ID=<node-id> \
 *   UTAHMETA_CACHE_DIR=/cache \
 *   UTAHMETA_PROXY_PORT=4101 \
 *   UTAHMETA_POLL_INTERVAL_MS=300000 \
 *   npx tsx src/edge-node-agent.ts
 */

import { createWriteStream } from "fs";
import { mkdir, stat, readdir, unlink, readFile } from "fs/promises";
import { join } from "path";
import { createServer } from "http";
import {
  hexToKey,
  generateIV,
  encryptChunk,
  decryptChunk,
  IV_LENGTH,
  CHUNK_SIZE,
} from "./encryption";

const UTAHMETA_URL = process.env.UTAHMETA_URL || "http://localhost:4100";
const UTAHMETA_AUTH_SUBJECT = process.env.UTAHMETA_AUTH_SUBJECT || "edge-agent";
const UTAHMETA_HOME_NODE_ID = process.env.UTAHMETA_HOME_NODE_ID || "";
const UTAHMETA_CACHE_DIR = process.env.UTAHMETA_CACHE_DIR || "./cache";
const UTAHMETA_POLL_INTERVAL_MS = Number(process.env.UTAHMETA_POLL_INTERVAL_MS || 0);
const UTAHMETA_MAX_CACHE_SIZE_MB = Number(process.env.UTAHMETA_MAX_CACHE_SIZE_MB || 0);
const UTAHMETA_PROXY_PORT = Number(process.env.UTAHMETA_PROXY_PORT || 4101);

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
let encryptionKey: Buffer | null = null;

// ---------- Auth ----------

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

// ---------- Encryption key ----------

async function loadEncryptionKey(): Promise<void> {
  const data = await apiGet<{ encryptionKeyHex: string }>(
    `/home-nodes/${UTAHMETA_HOME_NODE_ID}/key`
  );
  encryptionKey = hexToKey(data.encryptionKeyHex);
  console.log("[edge-agent] encryption key loaded");
}

// ---------- Encrypted file format ----------
// Each .enc file is a sequence of encrypted chunks:
// [4-byte chunk length][12-byte IV][ciphertext + 16-byte auth tag]
// The 4-byte length is the size of (IV + ciphertext + tag) for that chunk.

function writeEncryptedChunk(ws: NodeJS.WritableStream, plaintext: Buffer): void {
  const iv = generateIV();
  const encrypted = encryptChunk(encryptionKey!, plaintext, iv);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(IV_LENGTH + encrypted.length, 0);
  ws.write(Buffer.concat([lenBuf, iv, encrypted]));
}

async function downloadAndEncrypt(variant: ManifestVariant): Promise<void> {
  const filename = `${variant.variantId}.enc`;
  const localPath = join(UTAHMETA_CACHE_DIR, filename);

  try {
    const st = await stat(localPath);
    if (st.size > 0) {
      console.log(`[edge-agent] already cached: ${filename} (${variant.mediaItem.title})`);
      return;
    }
  } catch {
    // File doesn't exist, proceed
  }

  if (!encryptionKey) await loadEncryptionKey();

  console.log(`[edge-agent] downloading ${variant.variantId} (${variant.mediaItem.title})...`);
  const res = await fetch(`${UTAHMETA_URL}/download/variant/${variant.variantId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    token = null;
    await authenticate();
    return downloadAndEncrypt(variant);
  }
  if (!res.ok || !res.body) {
    console.error(`[edge-agent] download failed for ${variant.variantId}: ${res.status}`);
    return;
  }

  const ws = createWriteStream(localPath);
  const reader = (res.body as any).getReader();
  let buffer = Buffer.alloc(0);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = Buffer.concat([buffer, Buffer.from(value)]);

      while (buffer.length >= CHUNK_SIZE) {
        const chunk = buffer.subarray(0, CHUNK_SIZE);
        buffer = buffer.subarray(CHUNK_SIZE);
        writeEncryptedChunk(ws, chunk);
      }
    }
    if (buffer.length > 0) {
      writeEncryptedChunk(ws, buffer);
    }
    ws.end();
    console.log(`[edge-agent] cached (encrypted): ${filename}`);
  } catch (err) {
    console.error(`[edge-agent] download error for ${variant.variantId}:`, err);
    try { await unlink(localPath); } catch {}
  }
}

// ---------- Decryption for local playback proxy ----------

async function readEncryptedFile(
  path: string,
  start: number,
  end: number
): Promise<{ data: Buffer; totalSize: number }> {
  const raw = await readFile(path);
  const plaintextChunks: Buffer[] = [];
  let offset = 0;
  let plaintextTotal = 0;

  while (offset < raw.length) {
    if (offset + 4 > raw.length) break;
    const chunkLen = raw.readUInt32BE(offset);
    offset += 4;
    if (offset + chunkLen > raw.length) break;

    const iv = raw.subarray(offset, offset + IV_LENGTH);
    const ciphertext = raw.subarray(offset + IV_LENGTH, offset + chunkLen);
    offset += chunkLen;

    const plaintext = decryptChunk(encryptionKey!, ciphertext, iv);
    plaintextChunks.push(plaintext);
    plaintextTotal += plaintext.length;
  }

  const allPlaintext = Buffer.concat(plaintextChunks, plaintextTotal);
  const sliceEnd = Math.min(end + 1, allPlaintext.length);
  return { data: allPlaintext.subarray(start, sliceEnd), totalSize: allPlaintext.length };
}

// ---------- Local decryption proxy ----------

function startProxy(): void {
  const server = createServer(async (req, res) => {
    const match = req.url?.match(/^\/play\/([\w-]+)$/);
    if (!match) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const variantId = match[1];
    const encPath = join(UTAHMETA_CACHE_DIR, `${variantId}.enc`);

    try {
      await stat(encPath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Variant not cached");
      return;
    }

    if (!encryptionKey) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("No encryption key loaded");
      return;
    }

    const rangeHeader = req.headers.range;
    let start = 0;
    let end = Infinity;

    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        start = parseInt(m[1], 10);
        if (m[2]) end = parseInt(m[2], 10);
      }
    }

    try {
      const { data, totalSize } = await readEncryptedFile(encPath, start, end);
      const isPartial = rangeHeader !== undefined;
      const endByte = isPartial ? Math.min(end, totalSize - 1) : totalSize - 1;

      res.writeHead(isPartial ? 206 : 200, {
        "Content-Type": "video/mp4",
        "Content-Length": data.length,
        ...(isPartial
          ? {
              "Content-Range": `bytes ${start}-${endByte}/${totalSize}`,
              "Accept-Ranges": "bytes",
            }
          : { "Accept-Ranges": "bytes" }),
      });
      res.end(data);
    } catch (err) {
      console.error(`[edge-agent] decryption error for ${variantId}:`, err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Decryption failed");
    }
  });

  server.listen(UTAHMETA_PROXY_PORT, "127.0.0.1", () => {
    console.log(`[edge-agent] decryption proxy on http://127.0.0.1:${UTAHMETA_PROXY_PORT}`);
    console.log(`[edge-agent] play at http://127.0.0.1:${UTAHMETA_PROXY_PORT}/play/<variantId>`);
  });
}

// ---------- Cache eviction ----------

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

  fileInfos.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
  for (const f of fileInfos) {
    if (totalBytes <= maxBytes) break;
    await unlink(join(UTAHMETA_CACHE_DIR, f.name));
    totalBytes -= f.size;
    console.log(`[edge-agent] evicted: ${f.name} (freed ${Math.round(f.size / 1024 / 1024)}MB)`);
  }
}

// ---------- Sync loop ----------

async function syncOnce(): Promise<void> {
  if (!UTAHMETA_HOME_NODE_ID) {
    console.error("[edge-agent] UTAHMETA_HOME_NODE_ID is required");
    process.exit(1);
  }

  if (!encryptionKey) await loadEncryptionKey();

  const manifest = await apiGet<ManifestVariant[]>(
    `/home-nodes/${UTAHMETA_HOME_NODE_ID}/manifest`
  );

  if (manifest.length === 0) {
    console.log("[edge-agent] manifest is empty — nothing to sync");
    return;
  }

  console.log(`[edge-agent] manifest has ${manifest.length} variants`);

  for (const variant of manifest) {
    await downloadAndEncrypt(variant);
  }

  await evictIfNeeded();
  console.log("[edge-agent] sync complete");
}

async function main(): Promise<void> {
  await mkdir(UTAHMETA_CACHE_DIR, { recursive: true });
  startProxy();

  if (UTAHMETA_POLL_INTERVAL_MS > 0) {
    console.log(`[edge-agent] daemon mode (poll every ${UTAHMETA_POLL_INTERVAL_MS}ms)`);
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
    console.log("[edge-agent] sync done, proxy running");
    setInterval(() => {}, 1000);
  }
}

main().catch((err) => {
  console.error("[edge-agent] fatal:", err);
  process.exit(1);
});
