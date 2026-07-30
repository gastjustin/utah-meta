import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Folder, Plus, Trash2, Film, ListVideo, ArrowLeft, X } from "lucide-react";

interface CollectionSummary {
  collectionId: string;
  name: string;
  collectionType: string;
  _count: { items: number };
}

interface CollectionItem {
  collectionItemId: string;
  mediaItem: {
    mediaItemId: string;
    title: string;
    itemType: string;
    releaseYear?: number;
    runtimeMs?: number;
    artworkAssets?: { artworkAssetId: string; kind: string }[];
  };
}

interface CollectionDetail extends CollectionSummary {
  items: CollectionItem[];
}

export default function Collections() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [selected, setSelected] = useState<CollectionDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("playlist");
  const [error, setError] = useState("");

  useEffect(() => {
    loadCollections();
  }, []);

  function loadCollections() {
    api<CollectionSummary[]>("/collections").then(setCollections).catch((e) => setError(e.message));
  }

  function openCollection(id: string) {
    api<CollectionDetail>(`/collections/${id}`).then(setSelected).catch((e) => setError(e.message));
  }

  async function createCollection() {
    if (!newName.trim()) return;
    try {
      await api("/collections", {
        method: "POST",
        body: JSON.stringify({ name: newName, collectionType: newType }),
      });
      setNewName("");
      setShowCreate(false);
      loadCollections();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteCollection(id: string) {
    if (!confirm("Delete this collection?")) return;
    try {
      await api(`/collections/${id}`, { method: "DELETE" });
      setSelected(null);
      loadCollections();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeItem(itemId: string) {
    if (!selected) return;
    try {
      await api(`/collections/${selected.collectionId}/items/${itemId}`, { method: "DELETE" });
      openCollection(selected.collectionId);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {selected ? (
        // Detail view
        <div>
          <button
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4"
          >
            <ArrowLeft className="w-4 h-4" /> Back to collections
          </button>

          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white">{selected.name}</h1>
              <p className="text-gray-400 text-sm capitalize">{selected.collectionType} · {selected.items.length} items</p>
            </div>
            <button
              onClick={() => deleteCollection(selected.collectionId)}
              className="text-red-400 hover:text-red-300 text-sm inline-flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {selected.items.map((item) => {
              const poster = item.mediaItem.artworkAssets?.find((a) => a.kind === "poster");
              return (
                <div key={item.collectionItemId} className="bg-gray-800 rounded-lg overflow-hidden group relative">
                  <Link to={`/media/${item.mediaItem.mediaItemId}`}>
                    <div className="w-full aspect-video bg-gray-700 flex items-center justify-center">
                      {poster ? (
                        <img
                          src={`/artwork/${poster.artworkAssetId}`}
                          alt={item.mediaItem.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <Film className="w-8 h-8 text-gray-500" />
                      )}
                    </div>
                    <div className="p-2">
                      <h3 className="text-white text-sm font-medium truncate">{item.mediaItem.title}</h3>
                      <p className="text-gray-500 text-xs">
                        {item.mediaItem.itemType}
                        {item.mediaItem.releaseYear ? ` · ${item.mediaItem.releaseYear}` : ""}
                      </p>
                    </div>
                  </Link>
                  <button
                    onClick={() => removeItem(item.collectionItemId)}
                    className="absolute top-2 right-2 bg-black/60 text-red-400 p-1 rounded opacity-0 group-hover:opacity-100 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            {selected.items.length === 0 && (
              <p className="text-gray-500 text-sm col-span-full">This collection is empty.</p>
            )}
          </div>
        </div>
      ) : (
        // List view
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Folder className="w-6 h-6 text-blue-400" /> Collections
            </h1>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm transition"
            >
              <Plus className="w-4 h-4" /> New
            </button>
          </div>

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          {showCreate && (
            <div className="bg-gray-800 rounded-lg p-4 mb-6 flex gap-3">
              <input
                type="text"
                placeholder="Collection name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1 bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm"
              >
                <option value="playlist">Playlist</option>
                <option value="franchise">Franchise</option>
              </select>
              <button
                onClick={createCollection}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm transition"
              >
                Create
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {collections.map((c) => (
              <button
                key={c.collectionId}
                onClick={() => openCollection(c.collectionId)}
                className="bg-gray-800 hover:bg-gray-700 rounded-lg p-4 text-left transition flex items-center gap-3"
              >
                <div className="w-12 h-12 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                  {c.collectionType === "franchise" ? (
                    <Film className="w-6 h-6 text-blue-400" />
                  ) : (
                    <ListVideo className="w-6 h-6 text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-medium truncate">{c.name}</h3>
                  <p className="text-gray-500 text-xs capitalize">{c.collectionType} · {c._count.items} items</p>
                </div>
              </button>
            ))}
            {collections.length === 0 && (
              <p className="text-gray-500 text-sm">No collections yet. Create one to get started.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
