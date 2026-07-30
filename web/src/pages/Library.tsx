import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Film, Search as SearchIcon, Library as LibraryIcon, Tv, Play, Clock, ChevronRight } from "lucide-react";

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
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 text-sm">Loading your library...</div>
      </div>
    );

  const heroItem = items[0] || null;
  const showHero = !selectedLib && heroItem;

  return (
    <div className="fade-in">
      {/* Hero banner */}
      {showHero && heroItem.artworkAssets?.find((a) => a.kind === "backdrop") && (
        <div className="relative h-[50vh] min-h-[340px] w-full overflow-hidden">
          <img
            src={`/artwork/${heroItem.artworkAssets!.find((a) => a.kind === "backdrop")!.artworkAssetId}`}
            alt={heroItem.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 hero-gradient" />
          <div className="absolute inset-0 hero-gradient-left" />
          <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12">
            <h1 className="text-3xl md:text-5xl font-bold text-white mb-3 drop-shadow-lg">
              {heroItem.title}
            </h1>
            <p className="text-gray-300 text-sm md:text-base mb-4">
              {heroItem.releaseYear} · {Math.round((heroItem.runtimeMs || 0) / 60000)} min
            </p>
            <Link
              to={`/media/${heroItem.mediaItemId}`}
              className="inline-flex items-center gap-2 bg-white text-black font-medium px-6 py-2.5 rounded-lg hover:bg-white/90 transition"
            >
              <Play className="w-5 h-5" fill="currentColor" /> Play
            </Link>
          </div>
        </div>
      )}

      <div className="px-6 md:px-8 py-6 space-y-8">
        {/* Library selector pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setSelectedLib(null); setItems([]); setSeriesList([]); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              !selectedLib ? "bg-white/15 text-white" : "text-gray-500 hover:text-white hover:bg-white/5"
            }`}
          >
            All
          </button>
          {libraries.map((lib) => (
            <button
              key={lib.libraryId}
              onClick={() => selectLibrary(lib.libraryId)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                selectedLib === lib.libraryId
                  ? "bg-white/15 text-white"
                  : "text-gray-500 hover:text-white hover:bg-white/5"
              }`}
            >
              {lib.name}
            </button>
          ))}
        </div>

        {/* Continue Watching */}
        {continueWatching.length > 0 && !selectedLib && (
          <Section title="Continue Watching" icon={<Clock className="w-5 h-5 text-amber-500" />}>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
              {continueWatching.map((item) => (
                <Link
                  key={item.mediaItemId}
                  to={`/media/${item.mediaItemId}`}
                  className="flex-shrink-0 w-64 card-hover bg-[#151517] rounded-xl overflow-hidden group"
                >
                  <div className="w-full aspect-video bg-[#1a1a1e] relative">
                    <img
                      src={`/artwork/${item.mediaItemId}-backdrop.jpg`}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/40">
                      <Play className="w-10 h-10 text-white" fill="currentColor" />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                      <div
                        className="h-full bg-amber-500"
                        style={{
                          width: `${item.runtimeMs ? Math.min(100, (item.positionMs / item.runtimeMs) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="p-3">
                    <h3 className="text-white text-sm font-medium truncate">
                      {item.seriesTitle || item.title}
                    </h3>
                    <p className="text-gray-500 text-xs truncate mt-0.5">
                      {item.seasonNumber && item.episodeNumber
                        ? `S${item.seasonNumber} E${item.episodeNumber} · ${item.title}`
                        : item.title}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* Series grid */}
        {seriesList.length > 0 && (
          <Section title="TV Shows" icon={<Tv className="w-5 h-5 text-amber-500" />}>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
              {seriesList.map((s) => (
                <Link
                  key={s.seriesId}
                  to={`/series/${s.seriesId}`}
                  className="card-hover bg-[#151517] rounded-xl overflow-hidden group"
                >
                  <div className="w-full aspect-[2/3] bg-[#1a1a1e] flex items-center justify-center text-gray-600 group-hover:text-amber-500 transition">
                    <Tv className="w-10 h-10" />
                  </div>
                  <div className="p-2.5">
                    <h3 className="text-white text-sm font-medium truncate">{s.title}</h3>
                    <p className="text-gray-500 text-xs mt-0.5">{s._count.seasons} season{s._count.seasons !== 1 ? "s" : ""}</p>
                  </div>
                </Link>
              ))}
            </div>
          </Section>
        )}

        {/* Movies grid */}
        {items.length > 0 && (
          <Section title={selectedLib ? "Movies" : "Recently Added"}>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
              {items.map((item) => (
                <PosterCard key={item.mediaItemId} item={item} />
              ))}
            </div>
          </Section>
        )}

        {/* Empty states */}
        {selectedLib && items.length === 0 && seriesList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-600">
            <Film className="w-16 h-16 mb-4" />
            <p>This library is empty.</p>
          </div>
        )}

        {!selectedLib && !showHero && libraries.length === 0 && continueWatching.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-gray-600">
            <Film className="w-16 h-16 mb-4" />
            <p>No libraries yet. Run a scan from the Admin page.</p>
            <Link to="/admin" className="mt-4 text-amber-500 hover:text-amber-400 text-sm">
              Go to Admin →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-xl font-bold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function PosterCard({ item }: { item: MediaItem }) {
  const poster = item.artworkAssets?.find((a) => a.kind === "poster");
  const backdrop = item.artworkAssets?.find((a) => a.kind === "backdrop");
  const icon = item.itemType === "episode" ? <Tv className="w-10 h-10" /> : <Film className="w-10 h-10" />;

  return (
    <Link
      to={`/media/${item.mediaItemId}`}
      className="card-hover bg-[#151517] rounded-xl overflow-hidden group"
    >
      <div className="w-full aspect-[2/3] bg-[#1a1a1e] flex items-center justify-center text-gray-600 group-hover:text-amber-500 transition relative">
        {poster || backdrop ? (
          <img
            src={`/artwork/${(poster || backdrop)!.artworkAssetId}`}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = "none";
            }}
          />
        ) : (
          icon
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/50">
          <Play className="w-10 h-10 text-white" fill="currentColor" />
        </div>
      </div>
      <div className="p-2.5">
        <h3 className="text-white text-sm font-medium truncate">{item.title}</h3>
        <p className="text-gray-500 text-xs mt-0.5">
          {item.releaseYear ? item.releaseYear : item.itemType}
        </p>
      </div>
    </Link>
  );
}
