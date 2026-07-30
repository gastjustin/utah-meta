import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Film, Search, Library as LibraryIcon, Tv } from "lucide-react";

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
}

export default function LibraryPage() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selectedLib, setSelectedLib] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Library[]>("/libraries").then((libs) => {
      setLibraries(libs);
      setLoading(false);
    });
  }, []);

  function selectLibrary(id: string) {
    setSelectedLib(id);
    setSearchQuery("");
    setSearchResults([]);
    api<MediaItem[]>(`/libraries/${id}/items`).then(setItems);
  }

  function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    api<MediaItem[]>(`/search?q=${encodeURIComponent(searchQuery)}`).then(
      setSearchResults
    );
  }

  if (loading)
    return <div className="text-gray-400 p-8">Loading libraries...</div>;

  return (
    <div className="flex h-full">
      {/* Sidebar: libraries + search */}
      <aside className="w-64 bg-gray-800 border-r border-gray-700 p-4 space-y-6 overflow-y-auto">
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
                  <span className="text-gray-500 ml-2">
                    ({lib._count.mediaItems})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-xs uppercase text-gray-500 mb-2 flex items-center gap-1">
            <Search className="w-3 h-3" /> Search
          </h2>
          <form onSubmit={doSearch} className="space-y-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search titles..."
              className="w-full bg-gray-700 text-white text-sm border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="w-full bg-gray-600 hover:bg-gray-500 text-white text-sm py-2 rounded transition"
            >
              Search
            </button>
          </form>
        </div>
      </aside>

      {/* Main: items grid */}
      <main className="flex-1 p-6 overflow-y-auto">
        {searchResults.length > 0 ? (
          <>
            <h2 className="text-xl font-bold text-white mb-4">
              Search Results
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {searchResults.map((item) => (
                <ItemCard key={item.mediaItemId} item={item} />
              ))}
            </div>
          </>
        ) : items.length > 0 ? (
          <>
            <h2 className="text-xl font-bold text-white mb-4">
              {libraries.find((l) => l.libraryId === selectedLib)?.name}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {items.map((item) => (
                <ItemCard key={item.mediaItemId} item={item} />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Film className="w-16 h-16 mb-4" />
            <p>Select a library or search to browse media.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function ItemCard({ item }: { item: MediaItem }) {
  const icon = item.itemType === "episode" ? <Tv /> : <Film />;
  return (
    <Link
      to={`/media/${item.mediaItemId}`}
      className="bg-gray-800 rounded-lg p-4 hover:bg-gray-700 transition group"
    >
      <div className="w-full aspect-video bg-gray-700 rounded mb-3 flex items-center justify-center text-gray-500 group-hover:text-blue-400">
        {icon}
      </div>
      <h3 className="text-white text-sm font-medium truncate">{item.title}</h3>
      <p className="text-gray-500 text-xs">
        {item.itemType}
        {item.releaseYear ? ` · ${item.releaseYear}` : ""}
      </p>
    </Link>
  );
}
