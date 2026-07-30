import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Film, Search as SearchIcon, Library as LibraryIcon, Tv, Play, Clock } from "lucide-react";

interface Library {
  libraryId: string;
  name: string;
  kind: string;
  rootPath: string;
  _count: { mediaItems: number };
}

interface MediaItem {
  mediaItemId: string;
  title: string;
  itemType: string;
  releaseYear?: number;
  runtimeMs?: number;
  artworkAssets?: { artworkAssetId: string; kind: string }[];
}

interface ContinueWatchingItem {
  mediaItemId: string;
  title: string;
  itemType: string;
  releaseYear?: number;
  runtimeMs?: number;
  episodeNumber?: number | null;
  seasonNumber?: number | null;
  seriesTitle?: string | null;
  positionMs: number;
  completed: boolean;
  lastWatchedAt: string;
}

interface SeriesSummary {
  seriesId: string;
  title: string;
  status: string;
  _count: { seasons: number };
}

export default function LibraryPage() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [selectedLib, setSelectedLib] = useState<string | null>(null);
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<Library[]>("/libraries"),
      api<ContinueWatchingItem[]>("/continue-watching").catch(() => []),
    ]).then(([libs, cw]) => {
      setLibraries(libs);
      setContinueWatching(cw);
      setLoading(false);
    });
  }, []);

  function selectLibrary(id: string) {
    setSelectedLib(id);
    Promise.all([
      api<MediaItem[]>(`/libraries/${id}/items?moviesOnly=true`).catch(() => []),
      api<SeriesSummary[]>(`/libraries/${id}/series`).catch(() => []),
    ]).then(([it, sr]) => {
      setItems(it);
      setSeriesList(sr);
    });
  }

  if (loading)
    return <div className="text-gray-400 p-8">Loading libraries...</div>;

  return (
    <div className="flex h-full flex-col sm:flex-row">
      {/* Sidebar: libraries + search link */}
      <aside className="w-full sm:w-56 bg-gray-800 border-b sm:border-b-0 sm:border-r border-gray-700 p-4 space-y-6 overflow-y-auto flex-shrink-0 max-h-48 sm:max-h-none">
        <div>
          <h2 className="text-xs uppercase text-gray-500 mb-2 flex items-center gap-1">
            <LibraryIcon className="w-3 h-3" /> Libraries
          </h2>
          <ul className="space-y-1">
            {libraries.map((lib) => (
              <li key={lib.libraryId}>
                <button
                  onClick={() => selectLibrary(lib.libraryId)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                    selectedLib === lib.libraryId
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  {lib.name}
                  <span className="text-gray-500 ml-2">({lib._count.mediaItems})</span>
                </button>
              </li>
            ))}
            {libraries.length === 0 && (
              <li className="text-gray-500 text-xs px-3 py-2">No libraries yet. Run a scan from Admin.</li>
            )}
          </ul>
        </div>

        <Link
          to="/search"
          className="flex items-center gap-2 text-gray-300 hover:text-white text-sm px-3 py-2 rounded hover:bg-gray-700 transition"
        >
          <SearchIcon className="w-4 h-4" /> Search
        </Link>
      </aside>

      {/* Main: continue watching + items grid */}
      <main className="flex-1 p-6 overflow-y-auto">
        {/* Continue Watching */}
        {continueWatching.length > 0 && !selectedLib && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-400" /> Continue Watching
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {continueWatching.map((item) => (
                <Link
                  key={item.mediaItemId}
                  to={`/media/${item.mediaItemId}`}
                  className="flex-shrink-0 w-48 bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-700 transition group"
                >
                  <div className="w-full aspect-video bg-gray-700 flex items-center justify-center relative">
                    <Play className="w-8 h-8 text-white/60 group-hover:text-blue-400 transition" fill="currentColor" />
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-600">
                      <div
                        className="h-full bg-blue-500"
                        style={{
                          width: `${item.runtimeMs ? Math.min(100, (item.positionMs / item.runtimeMs) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="p-2">
                    <h3 className="text-white text-sm font-medium truncate">
                      {item.seriesTitle || item.title}
                    </h3>
                    <p className="text-gray-500 text-xs truncate">
                      {item.seasonNumber && item.episodeNumber
                        ? `S${item.seasonNumber} E${item.episodeNumber} · ${item.title}`
                        : item.title}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Series grid */}
        {seriesList.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Tv className="w-5 h-5 text-blue-400" /> TV Shows
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {seriesList.map((s) => (
                <Link
                  key={s.seriesId}
                  to={`/series/${s.seriesId}`}
                  className="bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-700 transition group"
                >
                  <div className="w-full aspect-video bg-gray-700 flex items-center justify-center text-gray-500 group-hover:text-blue-400">
                    <Tv className="w-8 h-8" />
                  </div>
                  <div className="p-2">
                    <h3 className="text-white text-sm font-medium truncate">{s.title}</h3>
                    <p className="text-gray-500 text-xs">{s._count.seasons} season{s._count.seasons !== 1 ? "s" : ""}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Items grid */}
        {items.length > 0 ? (
          <>
            <h2 className="text-lg font-bold text-white mb-4">
              {seriesList.length > 0 ? "Movies" : libraries.find((l) => l.libraryId === selectedLib)?.name}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {items.map((item) => (
                <ItemCard key={item.mediaItemId} item={item} />
              ))}
            </div>
          </>
        ) : selectedLib ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Film className="w-16 h-16 mb-4" />
            <p>This library is empty.</p>
          </div>
        ) : !continueWatching.length && libraries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Film className="w-16 h-16 mb-4" />
            <p>No libraries yet. Run a scan from the Admin page.</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function ItemCard({ item }: { item: MediaItem }) {
  const icon = item.itemType === "episode" ? <Tv className="w-8 h-8" /> : <Film className="w-8 h-8" />;
  const poster = item.artworkAssets?.find((a) => a.kind === "poster");
  const backdrop = item.artworkAssets?.find((a) => a.kind === "backdrop");

  return (
    <Link
      to={`/media/${item.mediaItemId}`}
      className="bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-700 transition group"
    >
      <div className="w-full aspect-video bg-gray-700 flex items-center justify-center text-gray-500 group-hover:text-blue-400 relative">
        {poster || backdrop ? (
          <img
            src={`/artwork/${(poster || backdrop)!.artworkAssetId}`}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          icon
        )}
      </div>
      <div className="p-2">
        <h3 className="text-white text-sm font-medium truncate">{item.title}</h3>
        <p className="text-gray-500 text-xs">
          {item.itemType}
          {item.releaseYear ? ` · ${item.releaseYear}` : ""}
        </p>
      </div>
    </Link>
  );
}
