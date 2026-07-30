# UtahMeta — Media Sandbox (Phase 3 + Hybrid Storage Layer)

Standalone streaming engine for the UtahMeta Jellyfin replacement project.
Implements: direct-play decision logic, ffprobe media analysis, ffmpeg
remux/transcode execution, and a hybrid storage layer.

This runs **independently** of your existing Jellyfin/Arr stack — nothing
here touches production until you're ready to cut over.

## Storage architecture

Two stores, each doing what it's good at:

- **Postgres** (via Prisma, `prisma/schema.prisma`) — durable, relational
  data: Content Library, Metadata & Discovery, Users, and WatchState
  (resume points). This is the source of truth — joins, foreign keys,
  and referential integrity matter here.
- **Redis** (`src/session-store.ts`) — live, high-churn, expiring data:
  active `PlaybackSession`s, broadcast via Redis pub/sub to every
  connected WebSocket client. This also means the app can scale to more
  than one instance later without sessions getting stuck on one node.

Prep/scan job *history* lives in Postgres as an audit trail; the
in-progress queue state for those jobs is a good candidate to move into
Redis too once you build that out in Phase 4.

## Project structure

```
prisma/
  schema.prisma           Durable relational schema (Postgres)
src/
  config.ts               Centralized env config, validated at boot
  direct-play-engine.ts   Client capability matrix + playback decision logic
  ffprobe-integration.ts  Extracts codec/container/HDR info from real files
  ffmpeg-stream-engine.ts Builds ffmpeg args, streams output, tracks processes
  library-scanner.ts      Minimal file-walk indexer (populates MediaItem/FileAsset)
  library-routes.ts       Search + browse endpoints (libraries, items, search)
  redis.ts                Redis client (command + pub/sub connections)
  session-store.ts        Redis-backed session state + WebSocket relay
  watch-state-sync.ts     Syncs ended/paused sessions into durable WatchState
  db.ts                   Prisma client singleton
  routes.ts               Playback routes (play, stream, session CRUD, scan)
  index.ts                Entry point
```

## Quick start (Docker — recommended)

1. Copy `.env.example` to `.env` and set `MEDIA_LIBRARY_PATH` to your
   real media folder. Change `POSTGRES_PASSWORD` from the default too.
2. Create the initial migration once, locally (needs Node + the deps
   installed — see "Local dev" below):
   ```
   npm install
   npx prisma migrate dev --name init
   ```
   This generates `prisma/migrations/`, which ships in the Docker image
   and gets applied automatically on container start.
3. Build and run everything (app + Postgres + Redis):
   ```
   docker compose up --build
   ```
4. Check it's alive:
   ```
   curl http://localhost:4100/health
   ```

## Quick start (local, no Docker)

Requires Node 20+, `ffmpeg`/`ffprobe` on your PATH, and Postgres + Redis
running somewhere reachable (update `.env` accordingly).

```
npm install
npx prisma migrate dev --name init   # first time only
npm run dev
```

## Testing the full loop (scan → play → sync)

1. Put a real video file somewhere under your `MEDIA_LIBRARY_PATH`.
2. Trigger a scan (indexes files into Postgres as `MediaItem`/`FileAsset` rows):
   ```
   curl -X POST http://localhost:4100/library/scan
   ```
   Returns `{ scanJobId, filesFound, added, updated, skipped, removed,
   failed }`. Uses `MEDIA_MOUNT_PATH` (set to `/media` in
   `docker-compose.yml`) unless you pass `{"rootPath": "..."}` in the body.
   Scans are now **incremental**: unchanged files (same size + mtime) are
   skipped, files whose bytes changed are re-probed (`updated`), and files
   that disappeared from disk are pruned from the index (`removed`).
3. Start playback against one of the scanned files (see below) and let
   it run a few seconds, then `PATCH .../sessions/:id` with `{"state":
   "paused"}` or `DELETE` the session.
4. Check `watch_state` in Postgres (`npm run prisma:studio`) — you
   should now see a real row with a resolved `mediaItemId`, instead of
   the sync silently skipping.

When `TMDB_API_KEY` is set, items are enriched after indexing:
- **Movies**: filename-guessed title replaced with TMDB's canonical title,
  plus release year, runtime, `ExternalIdMap`, and downloaded poster +
  backdrop `ArtworkAsset`s.
- **TV episodes**: the parent `Series` is resolved once to TMDB, and the
  episode gets the canonical episode title, air year, runtime,
  `ExternalIdMap`, and a downloaded still image as `ArtworkAsset` ("still"
  kind). The series also stores `tmdbId`, `firstAirYear`, `posterUri`, and
  `backdropUri`.

Enrichment is best-effort — a failed lookup leaves the ffprobe/filename-
indexed row intact.

Note: this scanner detects TV structure by folder convention: any file
under `<root>/<Show Name>/Season 01/...` (or `S01`,
`s1`, etc.) is indexed as an episode linked to that Series/Season. Files
that don't match get indexed as flat movies. This is naming-convention
detection, not a real metadata lookup — messy or nonstandard folder
layouts won't group correctly.

## API usage

**Start playback** — probes the file, decides direct-play vs. remux vs.
transcode based on the client, and creates a Redis-tracked session. Phase 5
adds background preparation: if the file isn’t direct-playable for the
client, the server first checks for a ready `VersionVariant` prepared copy;
if found, it streams that copy instead. Otherwise it starts a live
remux/transcode and queues a background prep job so the next playback of
the same item on that client is direct-play ready.

```
curl -X POST http://localhost:4100/play \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "deviceId": "living-room-tv",
    "mediaPath": "/media/Movies/Dune.mkv",
    "clientId": "android_tv",
    "audioTrackIndex": 1,
    "subtitleTrackIndex": 2
  }'
```

`audioTrackIndex` and `subtitleTrackIndex` are optional. Set
`subtitleTrackIndex` to `"off"` to disable subtitles entirely. The response
also includes `audioTracks` and `subtitleTracks` arrays describing available
tracks (index, codec, language, title, isDefault) so clients can present a
selection UI.

Authentication: all API routes except `/auth/*` and `/health` require a
bearer token. Obtain one via `POST /auth/login` with `authSubject` (user id)
and optional `displayName`.

**Control playback:**
```
curl -X PATCH http://localhost:4100/sessions/<id> \
  -H "Content-Type: application/json" \
  -d '{"state": "paused"}'
```

**Stop:**
```
curl -X DELETE http://localhost:4100/sessions/<id>
```

**List active sessions** (reads from Redis):
```
curl http://localhost:4100/sessions
```

**Live updates** — connect a WebSocket client to `ws://localhost:4100`
to receive `SESSION_STARTED`, `SESSION_UPDATED`, and `SESSION_STOPPED`
events in real time, relayed via Redis pub/sub.

**Browse and search the library** (Postgres-backed):
```
curl http://localhost:4100/libraries
curl http://localhost:4100/libraries/<libraryId>/items
curl http://localhost:4100/libraries/<libraryId>/series
curl http://localhost:4100/series/<seriesId>
curl http://localhost:4100/media/<mediaItemId>?userId=justin
curl "http://localhost:4100/search?q=dune"
```
`/series/:id` returns seasons and episodes fully nested and ordered
(season number, then episode number) — the natural shape for a "browse
this show" UI.
The `?userId=` param on `/media/:id` is optional — if provided (and that
user has watched something), the response includes their `watchState`
(resume position, completed flag).

**Manage users and devices** (Postgres-backed, Phase 4):
```
# Create a user (authSubject is the external identity used by watch-state sync)
curl -X POST http://localhost:4100/users \
  -H "Content-Type: application/json" \
  -d '{"displayName": "Justin", "authSubject": "justin"}'

curl http://localhost:4100/users
curl http://localhost:4100/users/<userId>
curl -X PATCH http://localhost:4100/users/<userId> \
  -H "Content-Type: application/json" -d '{"displayName": "Justin G"}'
curl -X DELETE http://localhost:4100/users/<userId>

# Register a device for a user (clientType must be a known client)
curl -X POST http://localhost:4100/users/<userId>/devices \
  -H "Content-Type: application/json" \
  -d '{"deviceName": "Living Room TV", "clientType": "android_tv"}'

curl http://localhost:4100/users/<userId>/devices
curl -X PATCH http://localhost:4100/devices/<deviceId> \
  -H "Content-Type: application/json" -d '{"maxBitrate": 40}'
curl -X DELETE http://localhost:4100/devices/<deviceId>
```
`clientType` is validated against `CLIENT_CAPABILITIES` so a device can't
be registered with a client the playback engine can't reason about.

**Prepare a media copy for a client** (Phase 5 — background preparation):
```
# Queue a job for a specific media item + client profile
curl -X POST http://localhost:4100/preparation/queue \
  -H "Content-Type: application/json" \
  -d '{
    "mediaItemId": "<mediaItemId>",
    "sourceFileAssetId": "<fileAssetId>",
    "clientId": "web_chrome"
  }'

# Run the next queued job in the background (returns 202 immediately)
curl -X POST http://localhost:4100/preparation/dequeue

# List jobs and their status
curl http://localhost:4100/preparation/jobs
```
Prepared copies are written to `PREPARED_MEDIA_PATH` (defaults to
`./prepared`). Each successful job creates a `VersionVariant` row with
`prepState: "ready"` and `directPlayReady: true`.

**Predictive edge cache** (Phase 6 — when a session ends):
When a playback session ends, the server looks at the current episode,
finds the next episode in the same series (same season or next season),
and pre-queues a `PreparationJob` so the next episode is already
client-compatible before the user presses play. These predictions are
audited in `PredictionEvent` rows.

```
curl http://localhost:4100/predictions

curl -X POST http://localhost:4100/home-nodes \
  -H "Content-Type: application/json" \
  -d '{"name": "living-room-nas", "hardwareClass": "arm64", "cachePath": "/cache"}'

curl http://localhost:4100/home-nodes
curl -X PATCH http://localhost:4100/home-nodes/<homeNodeId>/heartbeat
```

**Home node deployment** (Phase 7):
A home node pulls a manifest of prepared variants predicted for the users
assigned to it, then downloads them for local playback/thin clients.
`UserProfile.homeNodeId` links a user to their node.

```
# Assign a user to a home node
curl -X PATCH http://localhost:4100/users/<userId> \
  -H "Content-Type: application/json" \
  -d '{"homeNodeId": "<homeNodeId>"}'

# Desired cache manifest for a home node
curl http://localhost:4100/home-nodes/<homeNodeId>/manifest

# Download a prepared variant to the node
curl -O http://localhost:4100/download/variant/<variantId>

# Cloud watch-state sync for a user
curl http://localhost:4100/users/<userId>/watch-state
```

**Browse the durable schema** (Postgres, via Prisma Studio):
```
npm run prisma:studio
```

## Known clients

Defined in `src/direct-play-engine.ts` → `CLIENT_CAPABILITIES`:
`web_chrome`, `web_firefox`, `web_safari`, `android_tv`, `android_mobile`,
`ios`, `apple_tv`, `roku`, `lg_webos`. Each entry includes codec support,
container support, max resolution, and `supportsSubtitles`. Add more by
extending that object.

## Hardware transcode (optional)

The Docker image ships with software-only ffmpeg. For NVENC hardware
encoding: install the NVIDIA Container Toolkit on the host, uncomment the
`deploy.resources` block in `docker-compose.yml`, and swap the runtime
base image in the Dockerfile for one with NVENC-enabled ffmpeg.

## Schema migration note

Phase 4 added:
- `modified_at` column to `file_asset` (for incremental rescans)
- `tmdb_id`, `first_air_year`, `poster_uri`, `backdrop_uri` columns to
  `series` (for TV metadata enrichment)

Phase 5 added:
- `storage_uri` and `storage_volume_id` columns to `version_variant`
  (for prepared output files)
- `@unique` on `compatibility_profile.name`

Phase 6 added:
- `PredictionEvent` and `HomeNode` audit tables
- `mediaItemId` and `clientType` stored on the Redis `PlaybackSession`

Regenerate the client and create the migration before starting the server:
```bash
npm install
npx prisma generate
npx prisma migrate dev --name <migration_name>
npm run dev
```

Then open the built-in web UI at `http://localhost:4100/` for admin,
library browsing, and playback.
(In Docker this is applied automatically via `prisma migrate deploy` on
container start once the migration is committed to `prisma/migrations/`.)

### Production UI build (Vite + React)

A full Vite + React + TailwindCSS UI lives in `web/`. To build:

```bash
cd web && npm install && npm run build
```

This outputs to `public/dist/`. The server automatically serves
`public/dist/` with SPA fallback when present, falling back to the
prototype `public/index.html` otherwise. In dev mode, run `npm run dev`
in `web/` for hot-reloading via Vite's proxy to the backend on port 4100.

### Edge node agent

`src/edge-node-agent.ts` pulls the home node manifest and downloads
prepared variants to a local cache directory:

```bash
UTAHMETA_URL=http://media-server:4100 \
UTAHMETA_AUTH_SUBJECT=edge-user \
UTAHMETA_HOME_NODE_ID=<node-id> \
UTAHMETA_CACHE_DIR=/cache \
UTAHMETA_POLL_INTERVAL_MS=300000 \
UTAHMETA_MAX_CACHE_SIZE_MB=50000 \
npx tsx src/edge-node-agent.ts
```

Set `UTAHMETA_POLL_INTERVAL_MS` > 0 to run as a periodic sync daemon.
`UTAHMETA_MAX_CACHE_SIZE_MB` enables LRU eviction when the cache exceeds
the limit.

## Known gaps / not yet hardened

- `mediaPath` is validated against configured library roots and
  `MEDIA_MOUNT_PATH` in `POST /play` and `GET /stream/:sessionId`.
- Movie metadata uses the filename-extracted year to pick the matching
  result from TMDB's first page of search results. No title-levenshtein
  or manual disambiguation yet.
- Redis session TTL is a 6-hour safety net (`SESSION_TTL_SECONDS` in
  `session-store.ts`), not a design ceiling — refreshed on every update.
- The built-in UI has both a prototype single-file (`public/index.html`)
  and a production Vite + React app (`web/`). Build with `cd web && npm
  install && npm run build`.

## Roadmap context

This is Phase 7 of 8 in the UtahMeta replacement roadmap. Phase 6
(Predictive Edge Cache) is complete; Phase 7 (Home Node Deployment) adds
manifest + download endpoints, an edge node agent script, cloud watch-state
sync, subtitle/audio track selection, token-based auth, a background prep
worker, and a production Vite + React UI. Next up: Phase 8 (Final End
State) — the remaining hardware/player integration to fully replace
Jellyfin.
