import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, CLIENT_IDS } from "../api";
import { Play, ArrowLeft, Clock } from "lucide-react";

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
  fileAssets: { fileAssetId: string; sourcePath: string }[];
  watchState: { positionMs: number; completed: boolean } | null;
}

interface PlayResponse {
  session: { sessionId: string };
  streamUrl: string;
  audioTracks: TrackInfo[];
  subtitleTracks: TrackInfo[];
}

export default function MediaDetail() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<MediaDetail | null>(null);
  const [clientId, setClientId] = useState("web_chrome");
  const [audioTrack, setAudioTrack] = useState<number | undefined>(undefined);
  const [subtitleTrack, setSubtitleTrack] = useState<number | "off" | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [streamUrl, setStreamUrl] = useState("");
  const [tracks, setTracks] = useState<{
    audio: TrackInfo[];
    subtitle: TrackInfo[];
  }>({ audio: [], subtitle: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    api<MediaDetail>(`/media/${id}`).then(setItem);
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
    if (!playing) return;
    try {
      const sessionId = streamUrl.split("/").pop();
      await api(`/sessions/${sessionId}`, { method: "DELETE" });
    } catch {
      // ignore
    }
    setPlaying(false);
  }

  if (!item)
    return <div className="text-gray-400 p-8">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to library
      </Link>

      <h1 className="text-3xl font-bold text-white mb-2">{item.title}</h1>
      <p className="text-gray-400 text-sm mb-4">
        {item.itemType}
        {item.releaseYear ? ` · ${item.releaseYear}` : ""}
        {item.runtimeMs ? ` · ${Math.round(item.runtimeMs / 60000)}min` : ""}
      </p>

      {item.watchState && (
        <div className="bg-gray-800 rounded-lg p-3 mb-4 text-sm text-gray-300 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-400" />
          Resume from {Math.round(item.watchState.positionMs / 1000)}s
          {item.watchState.completed && " · Completed"}
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm mb-4">{error}</p>
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

          {tracks.audio.length > 0 && (
            <div>
              <label className="text-sm text-gray-400 block mb-1">
                Audio track
              </label>
              <select
                value={audioTrack ?? ""}
                onChange={(e) =>
                  setAudioTrack(e.target.value ? Number(e.target.value) : undefined)
                }
                className="bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 w-full"
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
            <div>
              <label className="text-sm text-gray-400 block mb-1">
                Subtitles
              </label>
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
                className="bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 w-full"
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

          {item.fileAssets?.length > 0 ? (
            <button
              onClick={handlePlay}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-lg transition"
            >
              <Play className="w-5 h-5" /> Play
            </button>
          ) : (
            <p className="text-red-400 text-sm">
              No file asset found for this item.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-black rounded-lg overflow-hidden">
            <video
              className="w-full"
              controls
              autoPlay
              src={streamUrl}
              onEnded={stopSession}
            />
          </div>
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
