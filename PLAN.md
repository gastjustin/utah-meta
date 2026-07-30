# UtahMeta — Project Plan

> The original kickoff prompt that started this project, preserved as the
> reference plan for Phase 3 and the surrounding roadmap.

## Overview

I'm building a Jellyfin-replacement media server called **UtahMeta**, following
an **8-phase roadmap**. We're currently on **Phase 3: "Build the Replacement
Core."**

## Existing state

- Windows Server, media on NTFS
- Existing Jellyfin/Arr stack still running in parallel
- `C:\code` for new dev

## Goal for this phase

Build a standalone streaming engine (**"Media Sandbox"**) with these components:

1. **Direct Play detection** — given a media file's container/codec/audio track
   info and a client's declared capabilities, determine if the file can be sent
   unmodified. Build a client capability matrix (start with: web browser,
   Android TV app, iOS).
2. **Transcode/remux fallback** — when direct play isn't possible, use ffmpeg to
   remux (fast, no re-encode) if only the container is wrong, or transcode
   (slower) if codec is incompatible. Support hardware acceleration if available
   (NVENC/QSV).
3. **Server-side playback session tracking** — track current position,
   play/pause state, and active device per user/session, exposed via a simple
   API (REST or WebSocket) so multiple clients can query "what's playing."
4. **Metadata/poster foundation** — a minimal schema (SQLite is fine) to store
   file path, title, poster image path, and duration — just enough for Phase 4
   to build a full library index on top of later.

## Constraints

- Keep this **decoupled from Jellyfin** — this should run standalone so we can
  test it against real files before touching the production Arr stack.
- **Prioritize Direct Play over transcoding** wherever possible (per the
  roadmap's "Reliable direct-play experience" end goal).
- Language/framework preference: Windows-first design principle.

## Approach

Start by proposing the architecture and API surface, then implement the
direct-play detection logic first since it's the highest-leverage piece.

## Jellyfin pain points → UtahMeta solutions

Lessons learned from running Jellyfin that UtahMeta must solve:

| Jellyfin problem | Root cause | UtahMeta solution |
|---|---|---|
| Live TV / IPTV freezes | Guide refresh blocks the UI thread; EPG data is massive and synchronous | No live TV in v1; guide data is a separate async service if added later |
| Guide refresh causes server freezes | Monolithic refresh blocks all requests | UtahMeta uses background workers (prep worker, scan jobs) that never block the request path |
| Metadata and image errors | Fragile scraping pipeline with no fallback | Best-effort TMDB enrichment that falls back to ffprobe/filename data; never blocks playback |
| External access complexity | Reverse proxy + SSL + port forwarding required | Edge node agent pulls content via authenticated API; no inbound ports needed on the server |
| Transcode decisions are wrong | Client capability detection is unreliable | Explicit client capability matrix (`CLIENT_CAPABILITIES`) with per-codec/container/resolution flags |
| No predictive caching | Everything is transcoded on-demand | Preparation engine pre-transcodes in background; prediction engine pre-caches next episodes to edge nodes |
| No encryption at rest | Media files are plaintext on disk | Edge node cache uses AES-256-GCM encryption with household-specific keys |

## Encryption at rest (edge node cache)

Edge nodes (home or rented) store cached variants encrypted with
AES-256-GCM. Each household gets a unique encryption key provisioned by the
server. The key is never stored on the node in plaintext — it's held in
memory or in a sealed enclave (TPM) if available.

- **Key provisioning**: Server generates a 256-bit key per HomeNode, stored
  encrypted in the database (encrypted with a server master key). The key
  is delivered to the edge node agent over the authenticated API channel.
- **Encryption**: The edge node agent encrypts each downloaded variant
  chunk-by-chunk as it writes to disk. The file on disk is
  indistinguishable from random bytes.
- **Decryption**: A local playback proxy on the edge node decrypts
  on-the-fly and serves plaintext to the local player over localhost.
- **Compromise scenario**: If a node is physically stolen or compromised,
  the cached files are meaningless without the household key. The server
  can revoke the key, making all cached content permanently unreadable.

## Roadmap context

This is **Phase 3 of 8** in the UtahMeta replacement roadmap. Next up:
**Phase 4 (Core Platform Services** — library index, user profiles, search),
which is where the durable data models actually start getting populated and
queried.

---

## The 8-Phase Replacement Map

Transcribed from the original "UtahMeta Jellyfin Replacement Map" diagram.

**START — Pain points and limitations** of Jellyfin today.

1. **Current State: Jellyfin Today**
   - Windows-based media server
   - Jellyfin + Arr stack
   - Live TV / IPTV issues
   - Guide refresh causes freezes
   - Metadata and image errors
   - External access complexity

2. **Stabilize the Existing Stack**
   - Guardian watchdog + diagnostics
   - Auto-restart and health checks
   - Move DB/cache to SSD
   - RAM transcode improvements
   - Classify and reduce errors

3. **Build the Replacement Core** ← *current phase*
   - Media Sandbox streaming engine
   - Server-side playback control
   - Universal compatibility pipeline
   - Direct Play preparation
   - Metadata and poster foundation

4. **Core Platform Services**
   - Central library index
   - User profiles and watch state
   - Search and metadata services
   - Config and orchestration layer
   - Scalable Windows-first architecture

5. **Smart Preparation Layer**
   - Server analyzes device compatibility
   - Pre-transcode or remux when needed
   - English-audio-only library standard
   - Audio normalization
   - Reliable replacement workflow

6. **Predictive Edge Cache**
   - Detect active viewing
   - Pre-cache next episodes
   - Prepare device-ready copies
   - Disposable fast SSD cache tier
   - Lower buffering and faster starts

7. **Home Node Deployment**
   - Mini-PC home node appliance
   - HDMI 2.1 playback
   - 2.5GbE networking
   - Local edge cache + player
   - Thin clients do minimal work

8. **Final End State**
   - Jellyfin fully replaced
   - Centralized server intelligence
   - Reliable direct-play experience
   - Scalable toward petabyte archive
   - Future-ready UtahMeta media platform

**END — UtahMeta Media Platform.**

### Design principles

- **Windows-first**
- **Thin clients**
- **Predictive caching**
- **Scalable storage**
- **Resilient and observable**

---

## Database schema (ERD)

Transcribed from the "UtahMeta Jellyfin Replacement Database Schema" diagram —
the conceptual schema for the whole platform. The live implementation in
`prisma/schema.prisma` covers the durable tables; high-churn entities
(`PlaybackSession`, `PlaybackEvent`, `CacheEntry`, `CacheTask`) live in Redis
at runtime, with Postgres holding only their durable audit/structural records.

### 1) Content Library

- **Library** — `library_id` (PK), name, kind, root_path, scan_policy
- **Series** — `series_id` (PK), library_id (FK), title, sort_title, status
- **Season** — `season_id` (PK), series_id (FK), season_number, title
- **MediaItem** — `media_item_id` (PK), library_id (FK), season_id (FK, nullable),
  item_type, title, runtime_ms, release_year, canonical_metadata_id (FK)
- **ArtworkAsset** — `artwork_asset_id` (PK), media_item_id (FK), kind,
  storage_uri, checksum
- **ExternalIdMap** — `external_id_id` (PK), media_item_id (FK), provider,
  external_key
- **FileAsset** — `file_asset_id` (PK), media_item_id (FK), storage_volume_id (FK),
  container, video_codec, audio_codec, size_bytes
- **VersionVariant** — `variant_id` (PK), media_item_id (FK), source_file_asset_id (FK),
  compatibility_profile_id (FK), direct_play_ready, prep_state
- **StorageVolume** — `storage_volume_id` (PK), name, tier, root_path,
  capacity_bytes, rebuildable

### 2) Metadata & Discovery

- **Person** — `person_id` (PK), name, person_type
- **MediaCredit** — `media_credit_id` (PK), media_item_id (FK), person_id (FK),
  credit_role, billing_order
- **Genre** — `genre_id` (PK), name
- **MediaGenre** — `media_genre_id` (PK), media_item_id (FK), genre_id (FK) — N:M
- **Collection** — `collection_id` (PK), name, collection_type
- **CollectionItem** — `collection_item_id` (PK), collection_id (FK),
  media_item_id (FK), sort_order

### 3) Users & Playback

- **UserProfile** — `user_id` (PK), display_name, auth_subject,
  default_audio_policy (FK), home_node_id (FK, nullable)
- **DeviceProfile** — `device_id` (PK), user_id (FK), device_name, client_type,
  capability_hash, max_bitrate, last_seen_at
- **WatchState** — `watch_state_id` (PK), user_id (FK), media_item_id (FK),
  position_ms, completed, last_watched_at
- **PlaybackSession** *(Redis at runtime)* — `session_id` (PK), user_id (FK),
  device_id (FK), media_item_id (FK), state, started_at
- **PlaybackEvent** *(Redis at runtime)* — `playback_event_id` (PK),
  session_id (FK), event_type, position_ms, created_at

### 4) Preparation & Compatibility

- **CompatibilityProfile** — `compatibility_profile_id` (PK), name, container,
  video_codec, audio_codec, max_resolution
- **AudioPolicy** — `audio_policy_id` (PK), name, english_only, normalize_audio
- **PreparationJob** — `prep_job_id` (PK), media_item_id (FK),
  source_file_asset_id (FK), compatibility_profile_id (FK),
  output_variant_id (FK, nullable), status, queued_at
- **ScanJob** — `scan_job_id` (PK), library_id (FK), scan_type, status, started_at

### 5) Edge Cache & Home Node

- **HomeNode** — `home_node_id` (PK), name, hardware_class, cache_path,
  last_heartbeat_at
- **PredictionEvent** — `prediction_id` (PK), user_id (FK),
  current_media_item_id (FK), predicted_media_item_id (FK), confidence, created_at
- **CacheEntry** *(Redis at runtime)* — `cache_entry_id` (PK), home_node_id (FK),
  variant_id (FK), priority, cached_at, expires_at, cache_state
- **CacheTask** *(Redis at runtime)* — `cache_task_id` (PK), home_node_id (FK),
  cache_entry_id (FK, nullable), task_type, status

### 6) Platform & Operations

- **HealthSnapshot** — `snapshot_id` (PK), service_name, node_ref, status,
  measured_at

### Legend

- **PK** = Primary Key
- **FK** = Foreign Key
- Solid arrow = Direct Relationship
- Dashed arrow = Optional / Workflow Link
