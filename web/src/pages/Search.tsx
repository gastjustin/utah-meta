import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Search as SearchIcon, Film, Tv, X } from "lucide-react";

interface SearchItem {
  mediaItemId: string;
  title: string;
  itemType: string;
  releaseYear?: number;
  runtimeMs?: number;
  seasonId?: string | null;
  episodeNumber?: number | null;
}

interface SearchSeries {
  seriesId: string;
  title: string;
  status: string;
  _count: { seasons: number };
}

interface SearchResults {
  items: SearchItem[];
  series: SearchSeries[];
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      api<SearchResults>(`/search?q=${encodeURIComponent(query)}`)
        .then(setResults)
        .catch(() => setResults(null))
        .finally(() => {
          setLoading(false);
          setSearched(true);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="fade-in px-6 md:px-8 py-6 max-w-6xl mx-auto">
      <div className="relative mb-8">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-600" />
        <input
          type="text"
          placeholder="Search movies, shows, episodes..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          className="w-full bg-white/5 text-white border border-white/10 rounded-xl pl-12 pr-12 py-3.5 text-lg focus:outline-none focus:border-amber-500/50 transition"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {loading && (
        <div className="text-gray-500 text-sm">Searching...</div>
      )}

      {!loading && searched && results && results.series.length === 0 && results.items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-gray-600">
          <SearchIcon className="w-12 h-12 mb-3" />
          <p>No results for "{query}"</p>
        </div>
      )}

      {results?.series && results.series.length > 0 && (
        <div className="mb-8">
          <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">Shows</h2>
          <div className="space-y-2">
            {results.series.map((s) => (
              <Link
                key={s.seriesId}
                to={`/series/${s.seriesId}`}
                className="flex items-center gap-3 bg-[#151517] hover:bg-[#1a1a1e] rounded-xl p-4 transition card-hover"
              >
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                  <Tv className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-medium">{s.title}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{s._count.seasons} season{s._count.seasons !== 1 ? "s" : ""} · {s.status}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {results?.items && results.items.length > 0 && (
        <div>
          <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
            {results.series.length > 0 ? "Episodes & Movies" : "Results"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.items.map((item) => (
              <Link
                key={item.mediaItemId}
                to={`/media/${item.mediaItemId}`}
                className="flex items-center gap-3 bg-[#151517] hover:bg-[#1a1a1e] rounded-xl p-4 transition card-hover"
              >
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                  <Film className="w-5 h-5 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{item.title}</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {item.itemType}
                    {item.releaseYear ? ` · ${item.releaseYear}` : ""}
                    {item.runtimeMs ? ` · ${Math.round(item.runtimeMs / 60000)}min` : ""}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
