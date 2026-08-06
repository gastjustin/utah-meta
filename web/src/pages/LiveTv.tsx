import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Radio, Play } from "lucide-react";
import Hls from "hls.js";

interface LiveTvChannel {
  liveTvChannelId: string;
  name: string;
  logoUrl?: string;
  groupName?: string;
  streamUrl: string;
}

interface EpgListing {
  title: string;
  description: string;
  start: string | number | null;
  end: string | number | null;
}

export default function LiveTv() {
  const [channels, setChannels] = useState<LiveTvChannel[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [epg, setEpg] = useState<EpgListing[]>([]);
  const [epgLoading, setEpgLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const groups = useMemo(() => {
    const set = new Set<string>();
    channels.forEach((c) => c.groupName && set.add(c.groupName));
    return Array.from(set).sort();
  }, [channels]);

  const filtered = useMemo(() => {
    return group
      ? channels.filter((c) => c.groupName === group)
      : channels;
  }, [channels, group]);

  const selectedChannel = useMemo(
    () => channels.find((c) => c.liveTvChannelId === selected) || filtered[0],
    [channels, selected, filtered]
  );

  useEffect(() => {
    api<LiveTvChannel[]>("/live-tv/channels")
      .then((data) => {
        setChannels(data);
        if (data.length > 0) setSelected(data[0].liveTvChannelId);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedChannel || !videoRef.current) return;
    const v = videoRef.current;
    const src = `/live-tv/stream/${selectedChannel.liveTvChannelId}`;

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    } else {
      v.src = src;
      v.play().catch(() => {});
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [selectedChannel]);

  useEffect(() => {
    if (!selectedChannel) {
      setEpg([]);
      return;
    }
    setEpgLoading(true);
    api<EpgListing[]>(`/live-tv/channels/${selectedChannel.liveTvChannelId}/epg`)
      .then((data) => setEpg(data || []))
      .catch(() => setEpg([]))
      .finally(() => setEpgLoading(false));
  }, [selectedChannel]);

  if (loading) return <div className="text-gray-400 p-8">Loading live TV...</div>;

  return (
    <div className="p-6 md:p-8 space-y-6">
      {error && (
        <div className="bg-red-900/40 text-red-200 text-sm p-3 rounded">
          {error}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Player */}
        <div className="flex-1 space-y-4">
          <div className="bg-black rounded-xl overflow-hidden aspect-video">
            {selectedChannel ? (
              <video
                ref={videoRef}
                controls
                autoPlay
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-600">
                <Radio className="w-16 h-16" />
              </div>
            )}
          </div>
          {selectedChannel && (
            <div>
              <h1 className="text-xl font-bold text-white">{selectedChannel.name}</h1>
              <p className="text-gray-500 text-sm">{selectedChannel.groupName || "Live TV"}</p>
            </div>
          )}

          {/* EPG guide */}
          {selectedChannel && (
            <div className="bg-[#0a0a0a] rounded-xl p-4 space-y-3">
              <h3 className="text-white font-bold text-sm">Channel Guide</h3>
              {epgLoading ? (
                <p className="text-gray-500 text-sm">Loading guide...</p>
              ) : epg.length === 0 ? (
                <p className="text-gray-500 text-sm">No guide data available.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {epg.map((p, i) => (
                    <div
                      key={i}
                      className="flex gap-3 text-sm border-b border-white/5 last:border-0 pb-2 last:pb-0"
                    >
                      <div className="text-amber-500 font-medium whitespace-nowrap w-24 shrink-0">
                        {formatEpgTime(p.start)} - {formatEpgTime(p.end)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white font-medium truncate">{p.title}</p>
                        {p.description && (
                          <p className="text-gray-500 text-xs truncate">{p.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Channel list */}
        <div className="w-full lg:w-80 bg-gray-800 rounded-xl p-4 space-y-4">
          <h2 className="text-white font-bold flex items-center gap-2">
            <Radio className="w-5 h-5 text-amber-500" /> Channels
          </h2>

          {groups.length > 1 && (
            <select
              value={group || ""}
              onChange={(e) => setGroup(e.target.value || null)}
              className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm"
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}

          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.liveTvChannelId}
                onClick={() => setSelected(c.liveTvChannelId)}
                className={`w-full flex items-center gap-3 p-2 rounded text-left transition ${
                  selected === c.liveTvChannelId
                    ? "bg-amber-900/40 text-amber-100"
                    : "hover:bg-gray-700 text-gray-300"
                }`}
              >
                {c.logoUrl ? (
                  <img
                    src={c.logoUrl}
                    alt=""
                    className="w-8 h-8 object-contain rounded bg-white/5"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center text-gray-500">
                    <Play className="w-4 h-4" />
                  </div>
                )}
                <span className="text-sm truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatEpgTime(value: string | number | null): string {
  if (!value) return "--";
  if (typeof value === "number") {
    const d = new Date(value * 1000);
    return isNaN(d.getTime()) ? "--" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const numeric = parseInt(value, 10);
  if (!isNaN(numeric) && value.length === 10) {
    const d = new Date(numeric * 1000);
    if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const xmltv = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (xmltv) {
    const [, y, mo, d, h, m] = xmltv;
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +m));
    return isNaN(date.getTime()) ? "--" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
