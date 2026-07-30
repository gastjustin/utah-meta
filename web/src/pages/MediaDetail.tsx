import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, detectClientId, getCurrentUser } from "../api";
import { Play, ArrowLeft, Clock, AlertCircle, FolderPlus, Tv, Check, Star, Calendar, Film, User } from "lucide-react";
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
  releaseYear?: number;
  runtimeMs?: number;
  episodeNumber?: number | null;
  fileAssets: { fileAssetId: string; sourcePath: string }[];
  artworkAssets: { artworkAssetId: string; kind: string }[];
  mediaGenres: { genre: { name: string } }[];
  mediaCredits: { creditRole: string; person: { name: string } }[];
  season?: { seasonNumber: number; series: { seriesId: string; title: string } } | null;
  watchState: { positionMs: number; completed: boolean } | null;
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
  const currentUser = getCurrentUser();

  useEffect(() => {
    api<MediaDetail>(`/media/${id}?userId=${encodeURIComponent(currentUser?.authSubject || "")}`)
      .then(setItem)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    api<CollectionSummary[]>("/collections").then(setCollections).catch(() => {});
    api<SimilarItem[]>(`/media/${id}/similar`).then(setSimilar).catch(() => {});
  }, [id]);

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
      setTimeout(() => setAddedToCollection(""), 3000);
    } catch (err: any) {
      setError(err.message);
    }
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

  return (
    <div className="fade-in">
      {/* Cinematic backdrop hero */}
      {backdrop && !playing && (
        <div className="relative h-[40vh] min-h-[280px] w-full overflow-hidden">
          <img
            src={`/artwork/${backdrop.artworkAssetId}`}
            alt={item.title}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
          />
          <div className="absolute inset-0 hero-gradient" />
        </div>
      )}

      <div className="px-6 md:px-8 -mt-32 relative z-10">
        {/* Back nav */}
        <div className="flex items-center gap-2 mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-sm transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          {item.season?.series && (
            <>
              <span className="text-gray-600">/</span>
              <Link
                to={`/series/${item.season.series.seriesId}`}
                className="inline-flex items-center gap-1 text-amber-500 hover:text-amber-400 text-sm transition"
              >
                <Tv className="w-4 h-4" /> {item.season.series.title}
              </Link>
            </>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-6 mb-8">
          {/* Poster */}
          {poster && (
            <img
              src={`/artwork/${poster.artworkAssetId}`}
              alt={item.title}
              className="w-36 h-54 md:w-44 md:h-66 rounded-xl object-cover flex-shrink-0 shadow-2xl mx-auto md:mx-0"
              style={{ aspectRatio: "2/3" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}

          {/* Info */}
          <div className="flex-1 flex flex-col justify-end">
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3 drop-shadow-lg">
              {item.title}
            </h1>

            {/* Meta row */}
            <div className="flex items-center gap-3 text-sm text-gray-400 mb-3 flex-wrap">
              {item.releaseYear && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> {item.releaseYear}
                </span>
              )}
              {runtimeMin && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {runtimeMin} min
                </span>
              )}
              <span className="capitalize">{item.itemType}</span>
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

            {/* Directors */}
            {directors.length > 0 && (
              <p className="text-gray-500 text-sm mb-4">
                Directed by <span className="text-gray-300">{directors.map((d) => d.person.name).join(", ")}</span>
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              {addedToCollection && (
                <span className="inline-flex items-center gap-1 text-green-400 text-sm bg-green-900/30 px-3 py-1.5 rounded-lg">
                  <Check className="w-4 h-4" /> Added to {addedToCollection}
                </span>
              )}
              {!showAddCollection && !addedToCollection && collections.length > 0 && (
                <button
                  onClick={() => setShowAddCollection(true)}
                  className="inline-flex items-center gap-1.5 text-gray-400 hover:text-white text-sm bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg transition"
                >
                  <FolderPlus className="w-4 h-4" /> Add to collection
                </button>
              )}
              {showAddCollection && (
                <div className="flex items-center gap-2">
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
            </div>
          </div>
        </div>

        {/* Cast & Crew */}
        {allCredits.length > 0 && (
          <div className="mb-8">
            <h3 className="text-xl font-bold text-white mb-4">Cast & Crew</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {directors.map((c) => (
                <div key={`dir-${c.person.name}`} className="bg-[#151517] rounded-xl p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{c.person.name}</p>
                    <p className="text-gray-500 text-xs">Director</p>
                  </div>
                </div>
              ))}
              {cast.map((c) => (
                <div key={`act-${c.person.name}`} className="bg-[#151517] rounded-xl p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{c.person.name}</p>
                    <p className="text-gray-500 text-xs">Actor</p>
                  </div>
                </div>
              ))}
              {otherCrew.map((c) => (
                <div key={`crew-${c.person.name}`} className="bg-[#151517] rounded-xl p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{c.person.name}</p>
                    <p className="text-gray-500 text-xs capitalize">{c.creditRole}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Watch state */}
        {item.watchState && (
          <div className="bg-white/5 rounded-lg p-3 mb-6 text-sm text-gray-300 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            {item.watchState.completed
              ? "Completed"
              : `Resume from ${formatResumeTime(item.watchState.positionMs)}`}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 text-red-300 text-sm p-4 rounded-lg mb-6 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Play section */}
        {!playing ? (
          <div className="bg-[#151517] rounded-2xl p-6 space-y-4">
            {item.fileAssets?.length > 0 ? (
              <button
                onClick={handlePlay}
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold px-8 py-3 rounded-xl transition text-base"
              >
                <Play className="w-5 h-5" fill="currentColor" />
                {resumePosition ? `Resume from ${formatResumeTime(resumePosition)}` : "Play"}
              </button>
            ) : (
              <p className="text-red-400 text-sm">No file asset found for this item.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
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
        {similar.length > 0 && (
          <div className="mb-8">
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
    </div>
  );
}

function formatResumeTime(msOrSec: number): string {
  const seconds = msOrSec > 1000 ? msOrSec / 1000 : msOrSec;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
