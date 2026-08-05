import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, detectClientId, getCurrentUser, getToken } from "../api";
import {
  Play,
  ArrowLeft,
  Clock,
  AlertCircle,
  FolderPlus,
  Tv,
  Check,
  Film,
  User,
  Heart,
  Star,
  MoreVertical,
  Bookmark,
  Download,
  Captions,
  ChevronDown,
  Loader2,
} from "lucide-react";
import VideoPlayer from "../components/VideoPlayer";

interface TrackInfo {
  index: number;
  codecType: "audio" | "subtitle";
  codec: string;
  language?: string;
  title?: string;
  isDefault: boolean;
}

interface MediaDetail {
  mediaItemId: string;
  title: string;
  itemType: string;
  overview?: string | null;
  releaseYear?: number;
  runtimeMs?: number;
  episodeNumber?: number | null;
  fileAssets: { fileAssetId: string; sourcePath: string }[];
  artworkAssets: { artworkAssetId: string; kind: string }[];
  mediaGenres: { genre: { name: string } }[];
  mediaCredits: { creditRole: string; person: { personId: string; name: string; photoPath: string | null } }[];
  season?: { seasonNumber: number; series: { seriesId: string; title: string } } | null;
  watchState: { positionMs: number; completed: boolean; rating?: number | null } | null;
}

interface PlayResponse {
  session: { sessionId: string };
  streamUrl: string;
  audioTracks: TrackInfo[];
  subtitleTracks: TrackInfo[];
}

interface CollectionSummary {
  collectionId: string;
  name: string;
  collectionType: string;
}

interface SimilarItem {
  mediaItemId: string;
  title: string;
  itemType: string;
  releaseYear?: number;
  runtimeMs?: number;
  artworkAssets?: { artworkAssetId: string; kind: string }[];
}

interface ProbeInfo {
  available: boolean;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: "1080p" | "4k";
  isHDR?: boolean;
  bitrateMbps?: number;
  audioTracks?: TrackInfo[];
  subtitleTracks?: TrackInfo[];
}

interface VariantSummary {
  variantId: string;
  prepState: string;
  directPlayReady: boolean;
  storageUri: string | null;
}

export default function MediaDetail() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<MediaDetail | null>(null);
  const clientId = detectClientId();
  const [audioTrack, setAudioTrack] = useState<number | undefined>(undefined);
  const [subtitleTrack, setSubtitleTrack] = useState<number | "off" | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [tracks, setTracks] = useState<{
    audio: TrackInfo[];
    subtitle: TrackInfo[];
  }>({ audio: [], subtitle: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [showAddCollection, setShowAddCollection] = useState(false);
  const [addedToCollection, setAddedToCollection] = useState("");
  const [similar, setSimilar] = useState<SimilarItem[]>([]);
  const [probe, setProbe] = useState<ProbeInfo | null>(null);
  const [variants, setVariants] = useState<VariantSummary[]>([]);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteCollectionId, setFavoriteCollectionId] = useState<string | null>(null);
  const [favoriteItemId, setFavoriteItemId] = useState<string | null>(null);
  const [watchState, setWatchState] = useState<{ completed: boolean; rating: number | null } | null>(null);
  const [ratingHover, setRatingHover] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const currentUser = getCurrentUser();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<MediaDetail>(`/media/${id}?userId=${encodeURIComponent(currentUser?.authSubject || "")}`),
      api<CollectionSummary[]>("/collections").catch(() => []),
    ])
      .then(async ([mediaItem, cols]) => {
        setItem(mediaItem);
        setCollections(cols);
        setWatchState(
          mediaItem.watchState
            ? { completed: mediaItem.watchState.completed, rating: mediaItem.watchState.rating ?? null }
            : { completed: false, rating: null }
        );

        const favCollection = cols.find((c) => c.name === "Favorites");
        if (favCollection) {
          try {
            const detail = await api<{ items: { collectionItemId: string; mediaItem: { mediaItemId: string } }[] }>(
              `/collections/${favCollection.collectionId}`
            );
            const match = detail.items.find((it) => it.mediaItem.mediaItemId === mediaItem.mediaItemId);
            if (match) {
              setIsFavorite(true);
              setFavoriteCollectionId(favCollection.collectionId);
              setFavoriteItemId(match.collectionItemId);
            }
          } catch {
            // non-critical
          }
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    api<SimilarItem[]>(`/media/${id}/similar`).then(setSimilar).catch(() => {});
    api<ProbeInfo>(`/media/${id}/probe`).then(setProbe).catch(() => setProbe({ available: false }));
    api<VariantSummary[]>(`/media/${id}/variants`).then(setVariants).catch(() => {});
  }, [id]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handlePlay() {
    if (!item?.fileAssets?.length) return;
    setError("");
    try {
      const res = await api<PlayResponse>("/play", {
        method: "POST",
        body: JSON.stringify({
          deviceId: "browser",
          mediaPath: item.fileAssets[0].sourcePath,
          clientId,
          audioTrackIndex: audioTrack,
          subtitleTrackIndex: subtitleTrack,
        }),
      });
      setStreamUrl(res.streamUrl);
      setSessionId(res.session.sessionId);
      setTracks({
        audio: res.audioTracks || [],
        subtitle: res.subtitleTracks || [],
      });
      setPlaying(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function stopSession() {
    if (!sessionId) {
      setPlaying(false);
      return;
    }
    try {
      await api(`/sessions/${sessionId}`, { method: "DELETE" });
    } catch {
      // ignore
    }
    setPlaying(false);
    setSessionId("");
    setStreamUrl("");
  }

  async function ensureCollection(name: string, collectionType: string): Promise<string> {
    const existing = collections.find((c) => c.name === name);
    if (existing) return existing.collectionId;
    const created = await api<CollectionSummary>("/collections", {
      method: "POST",
      body: JSON.stringify({ name, collectionType }),
    });
    setCollections((prev) => [...prev, created]);
    return created.collectionId;
  }

  async function addToCollection(collectionId: string) {
    if (!item) return;
    try {
      await api(`/collections/${collectionId}/items`, {
        method: "POST",
        body: JSON.stringify({ mediaItemId: item.mediaItemId }),
      });
      const col = collections.find((c) => c.collectionId === collectionId);
      setAddedToCollection(col?.name || "Added");
      setShowAddCollection(false);
      setMenuOpen(false);
      setTimeout(() => setAddedToCollection(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function quickAddToWatchlist() {
    if (!item) return;
    try {
      const collectionId = await ensureCollection("Watchlist", "playlist");
      await addToCollection(collectionId);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function toggleFavorite() {
    if (!item) return;
    setError("");
    try {
      if (isFavorite && favoriteCollectionId && favoriteItemId) {
        await api(`/collections/${favoriteCollectionId}/items/${favoriteItemId}`, { method: "DELETE" });
        setIsFavorite(false);
        setFavoriteItemId(null);
      } else {
        const collectionId = await ensureCollection("Favorites", "playlist");
        const created = await api<{ collectionItemId: string }>(`/collections/${collectionId}/items`, {
          method: "POST",
          body: JSON.stringify({ mediaItemId: item.mediaItemId }),
        });
        setFavoriteCollectionId(collectionId);
        setFavoriteItemId(created.collectionItemId);
        setIsFavorite(true);
      }
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function toggleMarkWatched() {
    if (!item) return;
    setError("");
    const nextCompleted = !watchState?.completed;
    try {
      const updated = await api<{ completed: boolean; rating: number | null }>(`/media/${item.mediaItemId}/watch-state`, {
        method: "POST",
        body: JSON.stringify({ completed: nextCompleted }),
      });
      setWatchState({ completed: updated.completed, rating: updated.rating ?? null });
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function setRating(rating: number) {
    if (!item) return;
    setError("");
    try {
      const updated = await api<{ completed: boolean; rating: number | null }>(`/media/${item.mediaItemId}/watch-state`, {
        method: "POST",
        body: JSON.stringify({ rating }),
      });
      setWatchState({ completed: updated.completed, rating: updated.rating ?? null });
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDownload() {
    const readyVariant = variants.find((v) => v.prepState === "ready" && v.storageUri);
    if (!readyVariant || !item) return;
    setDownloading(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/download/variant/${readyVariant.variantId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.title}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    }
    setDownloading(false);
  }

  function searchSubtitles() {
    if (!item) return;
    window.open(`https://www.opensubtitles.org/en/search2/moviename-${encodeURIComponent(item.title)}`, "_blank");
    setMenuOpen(false);
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );

  if (!item)
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600">
        <Film className="w-16 h-16 mb-4" />
        <p>Media item not found.</p>
        <Link to="/" className="text-amber-500 hover:text-amber-400 text-sm mt-3">
          ← Back to library
        </Link>
      </div>
    );

  const resumePosition = item.watchState?.positionMs
    ? item.watchState.positionMs / 1000
    : undefined;

  const backdrop = item.artworkAssets?.find((a) => a.kind === "backdrop");
  const poster = item.artworkAssets?.find((a) => a.kind === "poster");
  const genres = item.mediaGenres?.map((g) => g.genre.name) || [];
  const allCredits = item.mediaCredits || [];
  const cast = allCredits.filter((c) => c.creditRole === "actor");
  const directors = allCredits.filter((c) => c.creditRole === "director");
  const otherCrew = allCredits.filter((c) => c.creditRole !== "actor" && c.creditRole !== "director");
  const runtimeMin = item.runtimeMs ? Math.round(item.runtimeMs / 60000) : null;
  const runtimeLabel = runtimeMin ? `${Math.floor(runtimeMin / 60)}h ${runtimeMin % 60}m` : null;
  const readyVariant = variants.find((v) => v.prepState === "ready" && v.storageUri);

  // Group any non-actor/director crew by role for the Crew table — only
  // renders rows for roles the scanner has actually populated.
  const crewByRole = otherCrew.reduce<Record<string, string[]>>((acc, c) => {
    const key = c.creditRole.charAt(0).toUpperCase() + c.creditRole.slice(1) + "s";
    acc[key] = acc[key] || [];
    acc[key].push(c.person.name);
    return acc;
  }, {});

  return (
    <div className="fade-in">
      {!playing ? (
        <>
          {/* Cinematic backdrop hero */}
          <div className="relative h-[42vh] min-h-[300px] w-full overflow-hidden bg-[#0a0a0a]">
            {backdrop && (
              <img
                src={`/artwork/${backdrop.artworkAssetId}`}
                alt={item.title}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="absolute inset-0 hero-gradient" />
            <div className="absolute inset-0 hero-gradient-left" />
            <Link
              to="/"
              className="absolute top-5 left-6 md:left-8 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/40 text-white hover:bg-black/60 transition backdrop-blur"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </div>

          <div className="px-6 md:px-8 -mt-40 relative z-10">
            <div className="flex flex-col md:flex-row gap-6 mb-6">
              {/* Poster */}
              {poster && (
                <img
                  src={`/artwork/${poster.artworkAssetId}`}
                  alt={item.title}
                  className="w-40 md:w-48 rounded-xl object-cover flex-shrink-0 shadow-2xl mx-auto md:mx-0"
                  style={{ aspectRatio: "2/3" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}

              {/* Info */}
              <div className="flex-1 flex flex-col justify-end pt-4">
                {item.season?.series ? (
                  <Link
                    to={`/series/${item.season.series.seriesId}`}
                    className="inline-flex items-center gap-1.5 text-amber-500 hover:text-amber-400 text-sm mb-1.5 w-fit"
                  >
                    <Tv className="w-4 h-4" /> {item.season.series.title}
                  </Link>
                ) : (
                  <p className="text-gray-400 text-sm capitalize mb-1.5">{item.itemType}</p>
                )}

                <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight drop-shadow-lg uppercase">
                  {item.title}
                </h1>

                {/* Spec badges */}
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  {item.releaseYear && <Badge>{item.releaseYear}</Badge>}
                  {runtimeLabel && <Badge>{runtimeLabel}</Badge>}
                  {probe?.available && probe.resolution && (
                    <Badge>{probe.resolution === "4k" ? "2160P" : "1080P"}</Badge>
                  )}
                  {probe?.available && probe.isHDR && <Badge>HDR10</Badge>}
                  {probe?.available && probe.videoCodec && <Badge>{probe.videoCodec.toUpperCase()}</Badge>}
                  {probe?.available && probe.audioCodec && <Badge>{probe.audioCodec.toUpperCase()}</Badge>}
                </div>

                {/* Genres */}
                {genres.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {genres.map((g) => (
                      <span key={g} className="bg-white/10 text-gray-300 text-xs px-3 py-1 rounded-full">
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                {/* Overview */}
                {item.overview && (
                  <p className="text-gray-300 text-sm leading-relaxed mb-4 max-w-2xl">{item.overview}</p>
                )}

                {/* Directors */}
                {directors.length > 0 && (
                  <p className="text-gray-500 text-sm mb-5">
                    Directed by <span className="text-gray-300">{directors.map((d) => d.person.name).join(", ")}</span>
                  </p>
                )}

                {addedToCollection && (
                  <span className="inline-flex items-center gap-1 text-green-400 text-sm bg-green-900/30 px-3 py-1.5 rounded-lg mb-3 w-fit">
                    <Check className="w-4 h-4" /> Added to {addedToCollection}
                  </span>
                )}

                {/* Primary actions */}
                <div className="flex items-center gap-3 flex-wrap mb-4">
                  {item.fileAssets?.length > 0 && (
                    <button
                      onClick={handlePlay}
                      className="inline-flex items-center gap-2 bg-white hover:bg-white/90 text-black font-semibold px-6 py-2.5 rounded-full transition text-sm"
                    >
                      <Play className="w-4 h-4" fill="currentColor" />
                      {resumePosition ? `Resume` : "Play"}
                    </button>
                  )}
                  <button
                    onClick={toggleMarkWatched}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-medium transition ${
                      watchState?.completed
                        ? "bg-white/15 text-white"
                        : "bg-white/5 text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    <Check className="w-4 h-4" /> {watchState?.completed ? "Watched" : "Mark Watched"}
                  </button>
                  <button
                    onClick={toggleFavorite}
                    title={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                    className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition"
                  >
                    <Heart className={`w-4 h-4 ${isFavorite ? "fill-amber-500 text-amber-500" : "text-gray-300"}`} />
                  </button>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setRating(n)}
                        onMouseEnter={() => setRatingHover(n)}
                        onMouseLeave={() => setRatingHover(0)}
                        className="p-0.5"
                      >
                        <Star
                          className={`w-4 h-4 transition ${
                            n <= (ratingHover || watchState?.rating || 0)
                              ? "fill-amber-500 text-amber-500"
                              : "text-gray-600"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  <div className="relative" ref={menuRef}>
                    <button
                      onClick={() => setMenuOpen((v) => !v)}
                      className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition"
                    >
                      {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4 text-gray-300" />}
                    </button>
                    {menuOpen && (
                      <div className="absolute left-0 top-12 w-52 bg-[#1a1a1e] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-20 py-1">
                        <MenuItem icon={<Bookmark className="w-4 h-4" />} label="Add to Watchlist" onClick={quickAddToWatchlist} />
                        <MenuItem
                          icon={<FolderPlus className="w-4 h-4" />}
                          label="Add to Collection"
                          onClick={() => {
                            setShowAddCollection(true);
                            setMenuOpen(false);
                          }}
                        />
                        {readyVariant && (
                          <MenuItem icon={<Download className="w-4 h-4" />} label="Download" onClick={handleDownload} />
                        )}
                        <MenuItem icon={<Captions className="w-4 h-4" />} label="Search Subtitles" onClick={searchSubtitles} />
                      </div>
                    )}
                  </div>
                </div>

                {showAddCollection && (
                  <div className="flex items-center gap-2 mb-4">
                    <select
                      onChange={(e) => e.target.value && addToCollection(e.target.value)}
                      defaultValue=""
                      className="bg-[#1a1a1e] text-white border border-white/10 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="" disabled>Select a collection...</option>
                      {collections.map((c) => (
                        <option key={c.collectionId} value={c.collectionId}>{c.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setShowAddCollection(false)}
                      className="text-gray-500 hover:text-white text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Version / Audio / Subs selector rows */}
                {probe?.available && (
                  <div className="space-y-1.5">
                    <SelectorRow
                      label="Version"
                      value={[
                        probe.resolution === "4k" ? "2160p" : "1080p",
                        probe.videoCodec?.toUpperCase(),
                        probe.isHDR ? "HDR10" : null,
                        probe.audioCodec?.toUpperCase(),
                      ].filter(Boolean).join(" · ")}
                    />
                    {(probe.audioTracks?.length ?? 0) > 0 && (
                      <SelectorRow
                        label="Audio"
                        value={`Auto · ${probe.audioTracks![0].language || "und"} · ${probe.audioTracks![0].codec.toUpperCase()}`}
                        onChange={(e) => setAudioTrack(e.target.value ? Number(e.target.value) : undefined)}
                        options={probe.audioTracks!.map((t) => ({
                          value: String(t.index),
                          label: `${t.language || "und"} · ${t.codec.toUpperCase()}${t.title ? ` (${t.title})` : ""}`,
                        }))}
                      />
                    )}
                    {(probe.subtitleTracks?.length ?? 0) > 0 && (
                      <SelectorRow
                        label="Subs"
                        value={`Auto · ${probe.subtitleTracks![0].language || "und"} · ${probe.subtitleTracks![0].codec.toUpperCase()}`}
                        onChange={(e) =>
                          setSubtitleTrack(
                            e.target.value === "off" ? "off" : e.target.value ? Number(e.target.value) : undefined
                          )
                        }
                        options={[
                          { value: "off", label: "Off" },
                          ...probe.subtitleTracks!.map((t) => ({
                            value: String(t.index),
                            label: `${t.language || "und"} · ${t.codec.toUpperCase()}${t.title ? ` (${t.title})` : ""}`,
                          })),
                        ]}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Watch state */}
            {item.watchState && !item.watchState.completed && resumePosition ? (
              <div className="bg-white/5 rounded-lg p-3 mb-6 text-sm text-gray-300 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-500" />
                Resume from {formatResumeTime(item.watchState.positionMs)}
              </div>
            ) : null}

            {/* Error */}
            {error && (
              <div className="bg-red-900/30 text-red-300 text-sm p-4 rounded-lg mb-6 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {item.fileAssets?.length === 0 && (
              <p className="text-red-400 text-sm mb-6">No file asset found for this item.</p>
            )}

            {/* Cast */}
            {cast.length > 0 && (
              <div className="mb-10">
                <h3 className="text-xl font-bold text-white mb-4">Cast</h3>
                <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-6 md:-mx-8 px-6 md:px-8">
                  {cast.map((c) => (
                    <div key={c.person.personId} className="flex-shrink-0 w-24 text-center">
                      <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-2 mx-auto overflow-hidden">
                        {c.person.photoPath ? (
                          <img
                            src={`/person-photo/${c.person.personId}`}
                            alt={c.person.name}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <User className="w-9 h-9 text-gray-500" />
                        )}
                      </div>
                      <p className="text-white text-xs font-medium truncate">{c.person.name}</p>
                      <p className="text-gray-500 text-xs truncate">Actor</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Crew */}
            {(directors.length > 0 || Object.keys(crewByRole).length > 0) && (
              <div className="mb-10">
                <h3 className="text-xl font-bold text-white mb-4">Crew</h3>
                <div className="bg-[#151517] rounded-xl divide-y divide-white/5">
                  {directors.length > 0 && (
                    <CrewRow label="Directors" value={directors.map((d) => d.person.name).join(", ")} />
                  )}
                  {Object.entries(crewByRole).map(([role, names]) => (
                    <CrewRow key={role} label={role} value={names.join(", ")} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="px-6 md:px-8 pt-6 space-y-4">
          <VideoPlayer
            src={streamUrl}
            sessionId={sessionId}
            onEnded={stopSession}
            startPosition={resumePosition}
          />
          {(tracks.audio.length > 0 || tracks.subtitle.length > 0) && (
            <div className="bg-[#151517] rounded-xl p-4 flex flex-wrap gap-4">
              {tracks.audio.length > 0 && (
                <div className="flex-1 min-w-40">
                  <label className="text-sm text-gray-500 block mb-1.5">Audio track</label>
                  <select
                    value={audioTrack ?? ""}
                    onChange={(e) => setAudioTrack(e.target.value ? Number(e.target.value) : undefined)}
                    className="bg-[#1a1a1e] text-white border border-white/10 rounded-lg px-3 py-2 w-full text-sm"
                  >
                    <option value="">Default</option>
                    {tracks.audio.map((t) => (
                      <option key={t.index} value={t.index}>
                        {t.language || "und"} · {t.codec}
                        {t.title ? ` (${t.title})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {tracks.subtitle.length > 0 && (
                <div className="flex-1 min-w-40">
                  <label className="text-sm text-gray-500 block mb-1.5">Subtitles</label>
                  <select
                    value={subtitleTrack ?? ""}
                    onChange={(e) =>
                      setSubtitleTrack(
                        e.target.value === "off"
                          ? "off"
                          : e.target.value
                          ? Number(e.target.value)
                          : undefined
                      )
                    }
                    className="bg-[#1a1a1e] text-white border border-white/10 rounded-lg px-3 py-2 w-full text-sm"
                  >
                    <option value="">Default</option>
                    <option value="off">Off</option>
                    {tracks.subtitle.map((t) => (
                      <option key={t.index} value={t.index}>
                        {t.language || "und"} · {t.codec}
                        {t.title ? ` (${t.title})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
          <button
            onClick={stopSession}
            className="bg-red-600/80 hover:bg-red-600 text-white px-5 py-2.5 rounded-lg text-sm transition"
          >
            Stop
          </button>
        </div>
      )}

      {/* More Like This */}
      {similar.length > 0 && !playing && (
        <div className="px-6 md:px-8 mb-8">
          <h3 className="text-xl font-bold text-white mb-4">More Like This</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {similar.map((s) => {
              const sPoster = s.artworkAssets?.find((a) => a.kind === "poster");
              const sBackdrop = s.artworkAssets?.find((a) => a.kind === "backdrop");
              return (
                <Link
                  key={s.mediaItemId}
                  to={`/media/${s.mediaItemId}`}
                  className="card-hover bg-[#151517] rounded-xl overflow-hidden group"
                >
                  <div className="w-full aspect-[2/3] bg-[#1a1a1e] flex items-center justify-center text-gray-600 group-hover:text-amber-500 transition relative">
                    {sPoster || sBackdrop ? (
                      <img
                        src={`/artwork/${(sPoster || sBackdrop)!.artworkAssetId}`}
                        alt={s.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <Film className="w-10 h-10" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/50">
                      <Play className="w-10 h-10 text-white" fill="currentColor" />
                    </div>
                  </div>
                  <div className="p-2.5">
                    <h3 className="text-white text-sm font-medium truncate">{s.title}</h3>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {s.releaseYear ? s.releaseYear : s.itemType}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="h-12" />
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-white/10 text-gray-200 text-xs font-medium px-2.5 py-1 rounded-md">
      {children}
    </span>
  );
}

function SelectorRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options?: { value: string; label: string }[];
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-white/5 hover:bg-white/[0.07] rounded-lg px-3.5 py-2.5 text-sm transition relative">
      <span className="text-gray-500 w-16 flex-shrink-0">{label}</span>
      <span className="text-gray-300 flex-1 truncate">{value}</span>
      {options && options.length > 0 && (
        <div className="relative flex items-center">
          <ChevronDown className="w-4 h-4 text-gray-500 pointer-events-none" />
          <select
            onChange={onChange}
            defaultValue=""
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          >
            <option value="" disabled></option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition text-left"
    >
      {icon} {label}
    </button>
  );
}

function CrewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3 text-sm">
      <span className="text-gray-500 w-24 flex-shrink-0">{label}</span>
      <span className="text-gray-300">{value}</span>
    </div>
  );
}

function formatResumeTime(msOrSec: number): string {
  const seconds = msOrSec > 1000 ? msOrSec / 1000 : msOrSec;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
