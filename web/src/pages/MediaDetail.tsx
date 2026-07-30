import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, CLIENT_IDS, getCurrentUser } from "../api";
import { Play, ArrowLeft, Clock, AlertCircle, FolderPlus, Tv, Check } from "lucide-react";
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

export default function MediaDetail() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<MediaDetail | null>(null);
  const [clientId, setClientId] = useState("web_chrome");
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
  const currentUser = getCurrentUser();

  useEffect(() => {
    api<MediaDetail>(`/media/${id}?userId=${encodeURIComponent(currentUser?.authSubject || "")}`)
      .then(setItem)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    api<CollectionSummary[]>("/collections").then(setCollections).catch(() => {});
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
    return <div className="text-gray-400 p-8">Loading...</div>;

  if (!item)
    return (
      <div className="p-8 text-gray-400">
        <p>Media item not found.</p>
        <Link to="/" className="text-blue-400 hover:text-blue-300 text-sm mt-2 inline-block">
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
  const cast = item.mediaCredits?.filter((c) => c.creditRole === "actor").slice(0, 5) || [];
  const directors = item.mediaCredits?.filter((c) => c.creditRole === "director") || [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-sm"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </Link>
        {item.season?.series && (
          <>
            <span className="text-gray-600">/</span>
            <Link
              to={`/series/${item.season.series.seriesId}`}
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm"
            >
              <Tv className="w-4 h-4" /> {item.season.series.title}
            </Link>
          </>
        )}
      </div>

      {/* Backdrop image */}
      {backdrop && (
        <div className="relative -mx-6 -mt-6 mb-6 h-64 overflow-hidden rounded-b-lg">
          <img
            src={`/artwork/${backdrop.artworkAssetId}`}
            alt={item.title}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent" />
        </div>
      )}

      <div className="flex gap-4 mb-4">
        {poster && (
          <img
            src={`/artwork/${poster.artworkAssetId}`}
            alt={item.title}
            className="w-32 h-48 rounded object-cover flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-white mb-2">{item.title}</h1>
          <p className="text-gray-400 text-sm mb-2">
            {item.itemType}
            {item.releaseYear ? ` · ${item.releaseYear}` : ""}
            {item.runtimeMs ? ` · ${Math.round(item.runtimeMs / 60000)}min` : ""}
          </p>
          {genres.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {genres.map((g) => (
                <span key={g} className="bg-gray-800 text-gray-400 text-xs px-2 py-0.5 rounded">{g}</span>
              ))}
            </div>
          )}
          {directors.length > 0 && (
            <p className="text-gray-500 text-xs">Directed by {directors.map((d) => d.person.name).join(", ")}</p>
          )}
        </div>
      </div>

      {cast.length > 0 && (
        <div className="mb-4">
          <p className="text-gray-500 text-xs mb-1">Cast</p>
          <p className="text-gray-300 text-sm">{cast.map((c) => c.person.name).join(", ")}</p>
        </div>
      )}

      {/* Add to collection */}
      <div className="mb-4">
        {addedToCollection && (
          <span className="inline-flex items-center gap-1 text-green-400 text-sm bg-green-900/30 px-3 py-1 rounded">
            <Check className="w-4 h-4" /> Added to {addedToCollection}
          </span>
        )}
        {!showAddCollection && !addedToCollection && collections.length > 0 && (
          <button
            onClick={() => setShowAddCollection(true)}
            className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-sm bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded transition"
          >
            <FolderPlus className="w-4 h-4" /> Add to collection
          </button>
        )}
        {showAddCollection && (
          <div className="flex items-center gap-2">
            <select
              onChange={(e) => e.target.value && addToCollection(e.target.value)}
              defaultValue=""
              className="bg-gray-700 text-white border border-gray-600 rounded px-3 py-1.5 text-sm"
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

      {item.watchState && (
        <div className="bg-gray-800 rounded-lg p-3 mb-4 text-sm text-gray-300 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          {item.watchState.completed
            ? "Completed"
            : `Resume from ${formatResumeTime(item.watchState.positionMs)}`}
        </div>
      )}

      {error && (
        <div className="bg-red-900/50 text-red-300 text-sm p-3 rounded mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!playing ? (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 w-full"
            >
              {CLIENT_IDS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {item.fileAssets?.length > 0 ? (
            <button
              onClick={handlePlay}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg transition"
            >
              <Play className="w-5 h-5" />
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
          {/* Track selectors — only visible during playback when tracks are populated */}
          {(tracks.audio.length > 0 || tracks.subtitle.length > 0) && (
            <div className="bg-gray-800 rounded-lg p-4 flex flex-wrap gap-4">
              {tracks.audio.length > 0 && (
                <div className="flex-1 min-w-40">
                  <label className="text-sm text-gray-400 block mb-1">Audio track</label>
                  <select
                    value={audioTrack ?? ""}
                    onChange={(e) => setAudioTrack(e.target.value ? Number(e.target.value) : undefined)}
                    className="bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 w-full text-sm"
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
                  <label className="text-sm text-gray-400 block mb-1">Subtitles</label>
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
                    className="bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 w-full text-sm"
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
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm transition"
          >
            Stop
          </button>
        </div>
      )}
    </div>
  );
}

function formatResumeTime(msOrSec: number): string {
  const seconds = msOrSec > 1000 ? msOrSec / 1000 : msOrSec;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}
