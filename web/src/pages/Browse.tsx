import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Film, Tv, Play } from "lucide-react";

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

interface SeriesSummary {
  seriesId: string;
  title: string;
  status: string;
  _count: { seasons: number };
}

export default function Browse({ kind }: { kind: "movies" | "series" }) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [selectedLib, setSelectedLib] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isMovies = kind === "movies";
  const title = isMovies ? "Movies" : "TV Series";

  useEffect(() => {
    setLoading(true);
    setSelectedLib(null);
    const promises: Promise<any>[] = [api<Library[]>("/libraries")];
    if (isMovies) {
      promises.push(api<MediaItem[]>("/items?moviesOnly=true").catch(() => []));
    } else {
      promises.push(api<SeriesSummary[]>("/series").catch(() => []));
    }
    Promise.all(promises).then(([libs, data]) => {
      setLibraries(libs);
      if (isMovies) setItems(data as MediaItem[]);
      else setSeriesList(data as SeriesSummary[]);
      setLoading(false);
    });
  }, [kind]);

  function selectLibrary(id: string | null) {
    setSelectedLib(id);
    if (!id) {
      if (isMovies) {
        api<MediaItem[]>("/items?moviesOnly=true")
          .catch(() => [])
          .then(setItems);
      } else {
        api<SeriesSummary[]>("/series")
          .catch(() => [])
          .then(setSeriesList);
      }
      return;
    }
    if (isMovies) {
      api<MediaItem[]>(`/libraries/${id}/items?moviesOnly=true`)
        .catch(() => [])
        .then(setItems);
    } else {
      api<SeriesSummary[]>(`/libraries/${id}/series`)
        .catch(() => [])
        .then(setSeriesList);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 text-sm">Loading {title.toLowerCase()}...</div>
      </div>
    );
  }

  const data = isMovies ? items : seriesList;

  return (
    <div className="fade-in pb-12">
      <div className="sticky top-0 z-20 bg-[#050505]/90 backdrop-blur border-b border-white/5 px-6 md:px-8 py-4">
        <h1 className="text-2xl font-bold text-white mb-3">{title}</h1>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => selectLibrary(null)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition ${
              !selectedLib
                ? "bg-white/15 text-white"
                : "text-gray-500 hover:text-white hover:bg-white/5"
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

      <div className="px-6 md:px-8 py-8">
        {data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-600">
            {isMovies ? <Film className="w-16 h-16 mb-4" /> : <Tv className="w-16 h-16 mb-4" />}
            <p>No {title.toLowerCase()} found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {isMovies
              ? items.map((item) => <PosterCard key={item.mediaItemId} item={item} />)
              : seriesList.map((s) => <SeriesCard key={s.seriesId} series={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PosterCard({ item }: { item: MediaItem }) {
  const poster = item.artworkAssets?.find((a) => a.kind === "poster");
  const backdrop = item.artworkAssets?.find((a) => a.kind === "backdrop");

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
          <Film className="w-10 h-10" />
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

function SeriesCard({ series }: { series: SeriesSummary }) {
  return (
    <Link
      to={`/series/${series.seriesId}`}
      className="card-hover bg-[#151517] rounded-xl overflow-hidden group"
    >
      <div className="w-full aspect-[2/3] bg-[#1a1a1e] flex items-center justify-center text-gray-600 group-hover:text-amber-500 transition relative">
        <Tv className="w-10 h-10" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/50">
          <Play className="w-10 h-10 text-white" fill="currentColor" />
        </div>
      </div>
      <div className="p-2.5">
        <h3 className="text-white text-sm font-medium truncate">{series.title}</h3>
        <p className="text-gray-500 text-xs mt-0.5">
          {series._count.seasons} season{series._count.seasons !== 1 ? "s" : ""}
        </p>
      </div>
    </Link>
  );
}
