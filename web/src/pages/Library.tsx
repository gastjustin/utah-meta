import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Film, Tv, Play, Clock, Radio } from "lucide-react";

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

interface LiveTvChannel {
  liveTvChannelId: string;
  name: string;
  logoUrl?: string;
  groupName?: string;
}

export default function LibraryPage() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [selectedLib, setSelectedLib] = useState<string | null>(null);
  const [continueWatching, setContinueWatching] = useState<ContinueWatchingItem[]>([]);
  const [liveTvChannels, setLiveTvChannels] = useState<LiveTvChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<Library[]>("/libraries"),
      api<ContinueWatchingItem[]>("/continue-watching").catch(() => []),
      api<MediaItem[]>("/items?moviesOnly=true").catch(() => []),
      api<SeriesSummary[]>("/series").catch(() => []),
      api<LiveTvChannel[]>("/live-tv/channels").catch(() => []),
    ]).then(([libs, cw, allItems, allSeries, liveTv]) => {
      setLibraries(libs);
      setContinueWatching(cw);
      setItems(allItems);
      setSeriesList(allSeries);
      setLiveTvChannels(liveTv);
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

  function selectAll() {
    setSelectedLib(null);
    Promise.all([
      api<MediaItem[]>("/items?moviesOnly=true").catch(() => []),
      api<SeriesSummary[]>("/series").catch(() => []),
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
    <div className="fade-in pb-12">
      {/* Hero banner */}
      {showHero && heroItem.artworkAssets?.find((a) => a.kind === "backdrop") && (
        <div className="relative h-[56vh] min-h-[380px] w-full overflow-hidden">
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

      <div className="space-y-8">
        {/* Top bar with library selector */}
        <div className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur border-b border-white/5 px-6 md:px-8 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">
              {selectedLib ? libraries.find((l) => l.libraryId === selectedLib)?.name || "Library" : "Home"}
            </h2>
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
              <button
                onClick={() => selectAll()}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition ${
                  !selectedLib ? "bg-white/15 text-white" : "text-gray-500 hover:text-white hover:bg-white/5"
                }`}
              >
                All
              </button>
              {libraries.map((lib) => (
                <button
                  key={lib.libraryId}
                  onClick={() => selectLibrary(lib.libraryId)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition ${
                    selectedLib === lib.libraryId
                      ? "bg-white/15 text-white"
                      : "text-gray-500 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {lib.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 md:px-8 space-y-10">
          {/* Continue Watching */}
          {continueWatching.length > 0 && !selectedLib && (
            <HorizontalSection title="Continue Watching">
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-6 md:-mx-8 px-6 md:px-8">
                {continueWatching.map((item) => (
                  <Link
                    key={item.mediaItemId}
                    to={`/media/${item.mediaItemId}`}
                    className="flex-shrink-0 w-72 card-hover bg-[#151517] rounded-xl overflow-hidden group"
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
            </HorizontalSection>
          )}

          {/* Movies */}
          {items.length > 0 && (
            <HorizontalSection title={selectedLib ? "Movies" : "My Movies"}>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-3 -mx-6 md:-mx-8 px-6 md:px-8">
                {items.map((item) => (
                  <PosterCard key={item.mediaItemId} item={item} />
                ))}
              </div>
            </HorizontalSection>
          )}

          {/* Live TV */}
          {liveTvChannels.length > 0 && (
            <HorizontalSection title={selectedLib ? "Live TV" : "Live TV"}>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-3 -mx-6 md:-mx-8 px-6 md:px-8">
                {liveTvChannels.map((c) => (
                  <Link
                    key={c.liveTvChannelId}
                    to="/live-tv"
                    className="flex-shrink-0 w-36 card-hover bg-[#151517] rounded-xl overflow-hidden group"
                  >
                    <div className="w-full aspect-[2/3] bg-[#1a1a1e] flex items-center justify-center text-gray-600 group-hover:text-amber-500 transition relative">
                      {c.logoUrl ? (
                        <img
                          src={c.logoUrl}
                          alt={c.name}
                          className="w-full h-full object-contain p-2"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <Radio className="w-10 h-10" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/50">
                        <Play className="w-10 h-10 text-white" fill="currentColor" />
                      </div>
                    </div>
                    <div className="p-2.5">
                      <h3 className="text-white text-sm font-medium truncate">{c.name}</h3>
                      <p className="text-gray-500 text-xs mt-0.5 truncate">{c.groupName || "Live"}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </HorizontalSection>
          )}

          {/* TV Shows */}
          {seriesList.length > 0 && (
            <HorizontalSection title={selectedLib ? "TV Shows" : "My TV Shows"}>
              <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-3 -mx-6 md:-mx-8 px-6 md:px-8">
                {seriesList.map((s) => (
                  <Link
                    key={s.seriesId}
                    to={`/series/${s.seriesId}`}
                    className="flex-shrink-0 w-36 card-hover bg-[#151517] rounded-xl overflow-hidden group"
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
            </HorizontalSection>
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
    </div>
  );
}

function HorizontalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white">{title}</h2>
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
      className="flex-shrink-0 w-36 card-hover bg-[#151517] rounded-xl overflow-hidden group"
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
