import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Activity, Play, Pause, Loader2, Radio } from "lucide-react";

interface Session {
  sessionId: string;
  userId: string;
  deviceId: string;
  mediaItemId?: string;
  mediaPath?: string;
  state: string;
  startedAt: string;
  positionSeconds?: number;
}

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let mounted = true;

    // Initial REST load for immediate data, then WebSocket takes over
    api<Session[]>("/sessions")
      .then((data) => {
        if (mounted) {
          setSessions(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          setError(e.message);
          setLoading(false);
        }
      });

    // WebSocket for real-time updates
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (!mounted) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === "SNAPSHOT" && msg.sessions) {
          setSessions(msg.sessions);
          setLoading(false);
        } else if (msg.session) {
          setSessions((prev) => {
            if (msg.event === "SESSION_STOPPED") {
              return prev.filter((s) => s.sessionId !== msg.session.sessionId);
            }
            const idx = prev.findIndex((s) => s.sessionId === msg.session.sessionId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg.session;
              return next;
            }
            return [...prev, msg.session];
          });
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = () => {
      if (mounted) setError("WebSocket connection lost");
    };

    return () => {
      mounted = false;
      ws.close();
    };
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2 mb-6">
        <Radio className="w-6 h-6 text-blue-400" /> Active Sessions
      </h1>

      {loading && <p className="text-gray-400">Loading...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {!loading && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Activity className="w-12 h-12 mb-3" />
          <p>No active playback sessions.</p>
        </div>
      )}

      <div className="space-y-3">
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            className="bg-gray-800 rounded-lg p-4 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
              {s.state === "playing" ? (
                <Play className="w-5 h-5 text-green-400" fill="currentColor" />
              ) : s.state === "paused" ? (
                <Pause className="w-5 h-5 text-yellow-400" />
              ) : (
                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">
                {s.mediaPath || s.mediaItemId || "Unknown media"}
              </p>
              <p className="text-gray-500 text-xs">
                User: {s.userId} · Device: {s.deviceId}
                {s.positionSeconds ? ` · ${Math.floor(s.positionSeconds / 60)}m ${Math.floor(s.positionSeconds % 60)}s` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  s.state === "playing"
                    ? "bg-green-900 text-green-300"
                    : s.state === "paused"
                    ? "bg-yellow-900 text-yellow-300"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                {s.state}
              </span>
              {s.mediaItemId && (
                <Link
                  to={`/media/${s.mediaItemId}`}
                  className="text-blue-400 hover:text-blue-300 text-xs"
                >
                  View
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
