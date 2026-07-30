-- CreateTable
CREATE TABLE "library" (
    "library_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "root_path" TEXT NOT NULL,
    "scan_policy" TEXT,

    CONSTRAINT "library_pkey" PRIMARY KEY ("library_id")
);

-- CreateTable
CREATE TABLE "series" (
    "series_id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_title" TEXT,
    "status" TEXT,
    "tmdb_id" TEXT,
    "first_air_year" INTEGER,
    "poster_uri" TEXT,
    "backdrop_uri" TEXT,

    CONSTRAINT "series_pkey" PRIMARY KEY ("series_id")
);

-- CreateTable
CREATE TABLE "season" (
    "season_id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "season_number" INTEGER NOT NULL,
    "title" TEXT,

    CONSTRAINT "season_pkey" PRIMARY KEY ("season_id")
);

-- CreateTable
CREATE TABLE "media_item" (
    "media_item_id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "season_id" TEXT,
    "item_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "episode_number" INTEGER,
    "runtime_ms" INTEGER,
    "release_year" INTEGER,
    "canonical_metadata_id" TEXT,

    CONSTRAINT "media_item_pkey" PRIMARY KEY ("media_item_id")
);

-- CreateTable
CREATE TABLE "artwork_asset" (
    "artwork_asset_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storage_uri" TEXT NOT NULL,
    "checksum" TEXT,

    CONSTRAINT "artwork_asset_pkey" PRIMARY KEY ("artwork_asset_id")
);

-- CreateTable
CREATE TABLE "external_id_map" (
    "external_id_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_key" TEXT NOT NULL,

    CONSTRAINT "external_id_map_pkey" PRIMARY KEY ("external_id_id")
);

-- CreateTable
CREATE TABLE "file_asset" (
    "file_asset_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "storage_volume_id" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "video_codec" TEXT NOT NULL,
    "audio_codec" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "modified_at" TIMESTAMP(3),

    CONSTRAINT "file_asset_pkey" PRIMARY KEY ("file_asset_id")
);

-- CreateTable
CREATE TABLE "version_variant" (
    "variant_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "source_file_asset_id" TEXT NOT NULL,
    "compatibility_profile_id" TEXT,
    "storage_uri" TEXT,
    "storage_volume_id" TEXT,
    "direct_play_ready" BOOLEAN NOT NULL DEFAULT false,
    "prep_state" TEXT NOT NULL,

    CONSTRAINT "version_variant_pkey" PRIMARY KEY ("variant_id")
);

-- CreateTable
CREATE TABLE "storage_volume" (
    "storage_volume_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "root_path" TEXT NOT NULL,
    "capacity_bytes" BIGINT NOT NULL,
    "rebuildable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "storage_volume_pkey" PRIMARY KEY ("storage_volume_id")
);

-- CreateTable
CREATE TABLE "person" (
    "person_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "person_type" TEXT NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "media_credit" (
    "media_credit_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "credit_role" TEXT NOT NULL,
    "billing_order" INTEGER,

    CONSTRAINT "media_credit_pkey" PRIMARY KEY ("media_credit_id")
);

-- CreateTable
CREATE TABLE "genre" (
    "genre_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "genre_pkey" PRIMARY KEY ("genre_id")
);

-- CreateTable
CREATE TABLE "media_genre" (
    "media_genre_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "genre_id" TEXT NOT NULL,

    CONSTRAINT "media_genre_pkey" PRIMARY KEY ("media_genre_id")
);

-- CreateTable
CREATE TABLE "collection" (
    "collection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "collection_type" TEXT NOT NULL,

    CONSTRAINT "collection_pkey" PRIMARY KEY ("collection_id")
);

-- CreateTable
CREATE TABLE "collection_item" (
    "collection_item_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "collection_item_pkey" PRIMARY KEY ("collection_item_id")
);

-- CreateTable
CREATE TABLE "user_profile" (
    "user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "default_audio_policy_id" TEXT,
    "home_node_id" TEXT,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "device_profile" (
    "device_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_name" TEXT NOT NULL,
    "client_type" TEXT NOT NULL,
    "capability_hash" TEXT,
    "max_bitrate" INTEGER,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "device_profile_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "watch_state" (
    "watch_state_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "position_ms" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "last_watched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_state_pkey" PRIMARY KEY ("watch_state_id")
);

-- CreateTable
CREATE TABLE "compatibility_profile" (
    "compatibility_profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "video_codec" TEXT NOT NULL,
    "audio_codec" TEXT NOT NULL,
    "max_resolution" TEXT NOT NULL,

    CONSTRAINT "compatibility_profile_pkey" PRIMARY KEY ("compatibility_profile_id")
);

-- CreateTable
CREATE TABLE "audio_policy" (
    "audio_policy_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "english_only" BOOLEAN NOT NULL DEFAULT false,
    "normalize_audio" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "audio_policy_pkey" PRIMARY KEY ("audio_policy_id")
);

-- CreateTable
CREATE TABLE "preparation_job" (
    "prep_job_id" TEXT NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "source_file_asset_id" TEXT NOT NULL,
    "compatibility_profile_id" TEXT NOT NULL,
    "output_variant_id" TEXT,
    "status" TEXT NOT NULL,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preparation_job_pkey" PRIMARY KEY ("prep_job_id")
);

-- CreateTable
CREATE TABLE "scan_job" (
    "scan_job_id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "scan_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_job_pkey" PRIMARY KEY ("scan_job_id")
);

-- CreateTable
CREATE TABLE "home_node" (
    "home_node_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hardware_class" TEXT NOT NULL,
    "cache_path" TEXT NOT NULL,
    "last_heartbeat_at" TIMESTAMP(3),

    CONSTRAINT "home_node_pkey" PRIMARY KEY ("home_node_id")
);

-- CreateTable
CREATE TABLE "prediction_event" (
    "prediction_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "current_media_item_id" TEXT NOT NULL,
    "predicted_media_item_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_event_pkey" PRIMARY KEY ("prediction_id")
);

-- CreateTable
CREATE TABLE "health_snapshot" (
    "snapshot_id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "node_ref" TEXT,
    "status" TEXT NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_snapshot_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "series_library_id_title_key" ON "series"("library_id", "title");

-- CreateIndex
CREATE UNIQUE INDEX "season_series_id_season_number_key" ON "season"("series_id", "season_number");

-- CreateIndex
CREATE INDEX "media_item_library_id_idx" ON "media_item"("library_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_id_map_provider_external_key_key" ON "external_id_map"("provider", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "file_asset_source_path_key" ON "file_asset"("source_path");

-- CreateIndex
CREATE UNIQUE INDEX "genre_name_key" ON "genre"("name");

-- CreateIndex
CREATE UNIQUE INDEX "media_genre_media_item_id_genre_id_key" ON "media_genre"("media_item_id", "genre_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_auth_subject_key" ON "user_profile"("auth_subject");

-- CreateIndex
CREATE UNIQUE INDEX "watch_state_user_id_media_item_id_key" ON "watch_state"("user_id", "media_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "compatibility_profile_name_key" ON "compatibility_profile"("name");

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("library_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season" ADD CONSTRAINT "season_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "series"("series_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_item" ADD CONSTRAINT "media_item_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("library_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_item" ADD CONSTRAINT "media_item_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "season"("season_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_asset" ADD CONSTRAINT "artwork_asset_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("media_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("media_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_storage_volume_id_fkey" FOREIGN KEY ("storage_volume_id") REFERENCES "storage_volume"("storage_volume_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_variant" ADD CONSTRAINT "version_variant_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("media_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_variant" ADD CONSTRAINT "version_variant_source_file_asset_id_fkey" FOREIGN KEY ("source_file_asset_id") REFERENCES "file_asset"("file_asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_variant" ADD CONSTRAINT "version_variant_compatibility_profile_id_fkey" FOREIGN KEY ("compatibility_profile_id") REFERENCES "compatibility_profile"("compatibility_profile_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "version_variant" ADD CONSTRAINT "version_variant_storage_volume_id_fkey" FOREIGN KEY ("storage_volume_id") REFERENCES "storage_volume"("storage_volume_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_credit" ADD CONSTRAINT "media_credit_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("media_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_credit" ADD CONSTRAINT "media_credit_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("person_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_genre" ADD CONSTRAINT "media_genre_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("media_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_genre" ADD CONSTRAINT "media_genre_genre_id_fkey" FOREIGN KEY ("genre_id") REFERENCES "genre"("genre_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_item" ADD CONSTRAINT "collection_item_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collection"("collection_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_item" ADD CONSTRAINT "collection_item_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("media_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profile" ADD CONSTRAINT "device_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_state" ADD CONSTRAINT "watch_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profile"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_state" ADD CONSTRAINT "watch_state_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("media_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_job" ADD CONSTRAINT "preparation_job_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("media_item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_job" ADD CONSTRAINT "preparation_job_compatibility_profile_id_fkey" FOREIGN KEY ("compatibility_profile_id") REFERENCES "compatibility_profile"("compatibility_profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_job" ADD CONSTRAINT "preparation_job_output_variant_id_fkey" FOREIGN KEY ("output_variant_id") REFERENCES "version_variant"("variant_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_job" ADD CONSTRAINT "scan_job_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("library_id") ON DELETE RESTRICT ON UPDATE CASCADE;
