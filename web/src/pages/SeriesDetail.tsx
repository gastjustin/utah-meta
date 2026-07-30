import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, getCurrentUser } from "../api";
import { ArrowLeft, Play, Tv, Search as SearchIcon, Clock, Check } from "lucide-react";

interface Episode {
  mediaItemId: string;
  title: string;
  episodeNumber: number | null;
  runtimeMs: number | null;
  artworkAssets: { artworkAssetId: string; kind: string }[];
  watchState?: { positionMs: number; completed: boolean } | null;
}

interface Season {
  seasonId: string;
  seasonNumber: number;
  title?: string;
  mediaItems: Episode[];
}

interface SeriesDetail {
  seriesId: string;
  title: string;
  status: string;
  firstAirYear?: number | null;
  posterUri?: string | null;
  backdropUri?: string | null;
  seasons: Season[];
}

export default function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSeason, setSelectedSeason] = useState<string>("");
  const currentUser = getCurrentUser();

  useEffect(() => {
    api<SeriesDetail>(`/series/${id}?userId=${encodeURIComponent(currentUser?.authSubject || "")}`)
      .then((data) => {
        setSeries(data);
        if (data.seasons.length > 0) setSelectedSeason(data.seasons[0].seasonId);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-gray-400 p-8">Loading...</div>;
  if (error) return <div className="text-red-400 p-8">{error}</div>;
  if (!series) return <div className="text-gray-400 p-8">Series not found</div>;

  const season = series.seasons.find((s) => s.seasonId === selectedSeason);
  const posterUrl = series.posterUri;
  const backdropUrl = series.backdropUri;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/" className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to library
        </Link>
        <span className="text-gray-600">/</span>
        <Link to="/search" className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-sm">
          <SearchIcon className="w-4 h-4" /> Search
        </Link>
      </div>

      {/* Backdrop */}
      {backdropUrl && (
        <div className="relative -mx-6 -mt-6 mb-6 h-48 overflow-hidden rounded-b-lg">
          <img
            src={backdropUrl}
            alt={series.title}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent" />
        </div>
      )}

      <div className="flex gap-4 mb-6">
        {posterUrl && (
          <img
            src={posterUrl}
            alt={series.title}
            className="w-32 h-48 rounded object-cover flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <Tv className="w-8 h-8 text-blue-500 flex-shrink-0" />
            <div>
              <h1 className="text-3xl font-bold text-white">{series.title}</h1>
              <p className="text-gray-400 text-sm">
                {series.seasons.length} season{series.seasons.length !== 1 ? "s" : ""}
                {series.firstAirYear ? ` · ${series.firstAirYear}` : ""}
                {` · ${series.status}`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {series.seasons.length > 0 && (
        <div className="mb-6">
          <div className="flex gap-2 flex-wrap">
            {series.seasons.map((s) => (
              <button
                key={s.seasonId}
                onClick={() => setSelectedSeason(s.seasonId)}
                className={`px-4 py-2 rounded text-sm transition ${
                  selectedSeason === s.seasonId
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                Season {s.seasonNumber}
              </button>
            ))}
          </div>
        </div>
      )}

      {season && (
        <div className="space-y-2">
          {season.mediaItems.map((ep) => {
            const still = ep.artworkAssets?.find((a) => a.kind === "still");
            const ws = ep.watchState;
            return (
              <Link
                key={ep.mediaItemId}
                to={`/media/${ep.mediaItemId}`}
                className="flex items-center gap-4 bg-gray-800 hover:bg-gray-700 rounded-lg p-3 transition group"
              >
                <div className="w-20 h-12 rounded bg-gray-700 flex items-center justify-center text-gray-400 text-xs font-mono flex-shrink-0 overflow-hidden relative">
                  {still ? (
                    <img
                      src={`/artwork/${still.artworkAssetId}`}
                      alt={ep.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <span>{ep.episodeNumber ?? "?"}</span>
                  )}
                  {ws && !ws.completed && ws.positionMs > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-600">
                      <div className="h-full bg-blue-500" style={{ width: "50%" }} />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs font-mono">E{ep.episodeNumber ?? "?"}</span>
                    <p className="text-white text-sm font-medium truncate">{ep.title}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {ep.runtimeMs && (
                      <p className="text-gray-500 text-xs">{Math.round(ep.runtimeMs / 60000)}min</p>
                    )}
                    {ws?.completed && (
                      <span className="inline-flex items-center gap-0.5 text-green-400 text-xs">
                        <Check className="w-3 h-3" /> Watched
                      </span>
                    )}
                    {ws && !ws.completed && ws.positionMs > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-blue-400 text-xs">
                        <Clock className="w-3 h-3" /> Resume
                      </span>
                    )}
                  </div>
                </div>
                <Play className="w-5 h-5 text-gray-600 group-hover:text-blue-400 transition flex-shrink-0" />
              </Link>
            );
          })}
          {season.mediaItems.length === 0 && (
            <p className="text-gray-500 text-sm">No episodes in this season.</p>
          )}
        </div>
      )}
    </div>
  );
}
