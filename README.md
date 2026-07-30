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
   Returns `{ scanJobId, filesFound, added, skipped, failed }`. Uses
   `MEDIA_MOUNT_PATH` (set to `/media` in `docker-compose.yml`) unless
   you pass `{"rootPath": "..."}` in the body.
3. Start playback against one of the scanned files (see below) and let
   it run a few seconds, then `PATCH .../sessions/:id` with `{"state":
   "paused"}` or `DELETE` the session.
4. Check `watch_state` in Postgres (`npm run prisma:studio`) — you
   should now see a real row with a resolved `mediaItemId`, instead of
   the sync silently skipping.

Note: this scanner is intentionally minimal (no metadata provider lookups,
no incremental rescans) — but it does now detect TV structure by folder
convention: any file under `<root>/<Show Name>/Season 01/...` (or `S01`,
`s1`, etc.) is indexed as an episode linked to that Series/Season. Files
that don't match get indexed as flat movies. This is naming-convention
detection, not a real metadata lookup — messy or nonstandard folder
layouts won't group correctly.

## API usage

**Start playback** — probes the file, decides direct-play vs. remux vs.
transcode based on the client, and creates a Redis-tracked session:

```
curl -X POST http://localhost:4100/play \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "justin",
    "deviceId": "living-room-tv",
    "mediaPath": "/media/Movies/Dune.mkv",
    "clientId": "android_tv"
  }'
```

Response includes `streamUrl` — open that in a `<video>` tag or player to
actually receive the stream (supports HTTP range requests for seeking on
direct-play files).

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

**Browse the durable schema** (Postgres, via Prisma Studio):
```
npm run prisma:studio
```

## Known clients

Defined in `src/direct-play-engine.ts` → `CLIENT_CAPABILITIES`:
`web_chrome`, `android_tv`, `ios`. Add more by extending that object.

## Hardware transcode (optional)

The Docker image ships with software-only ffmpeg. For NVENC hardware
encoding: install the NVIDIA Container Toolkit on the host, uncomment the
`deploy.resources` block in `docker-compose.yml`, and swap the runtime
base image in the Dockerfile for one with NVENC-enabled ffmpeg.

## Known gaps / not yet hardened

- `mediaPath` in `POST /play` isn't validated against the mounted media
  root — worth constraining before exposing this beyond localhost.
- Redis session TTL is a 6-hour safety net (`SESSION_TTL_SECONDS` in
  `session-store.ts`), not a design ceiling — refreshed on every update.
- `prisma/schema.prisma` covers sections 1–4 and 6 of the ERD as durable
  tables; `PredictionEvent`/`HomeNode` (section 5) exist as an audit
  trail only — the actual hot cache logic is Phase 6 work, not built yet.

## Roadmap context

This is Phase 3 of 8 in the UtahMeta replacement roadmap. Next up:
Phase 4 (Core Platform Services — library index, user profiles, search),
which is where the Prisma models above actually start getting populated
and queried.
