import { useEffect, useState } from "react";
import { api } from "../api";
import { Server, Cpu, HardDrive, Activity, RefreshCw, KeyRound, Clock } from "lucide-react";

interface HomeNode {
  homeNodeId: string;
  name: string;
  hardwareClass: string;
  cachePath: string;
  encryptionKeyHex: string | null;
  lastHeartbeatAt: string | null;
}

interface HealthSnapshot {
  snapshotId: string;
  serviceName: string;
  nodeRef: string | null;
  status: string;
  measuredAt: string;
}

export default function EdgeNodes() {
  const [nodes, setNodes] = useState<HomeNode[]>([]);
  const [health, setHealth] = useState<HealthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rotating, setRotating] = useState<string | null>(null);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  function load() {
    Promise.all([
      api<HomeNode[]>("/home-nodes"),
      api<HealthSnapshot[]>("/health-snapshots").catch(() => []),
    ])
      .then(([n, h]) => {
        setNodes(n);
        setHealth(h);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }

  async function rotateKey(nodeId: string) {
    if (!confirm("Rotate encryption key? This will invalidate all cached content on this node.")) return;
    setRotating(nodeId);
    try {
      await api(`/home-nodes/${nodeId}/rotate-key`, { method: "POST" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
    setRotating(null);
  }

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  if (loading) return <div className="text-gray-400 p-8">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Server className="w-6 h-6 text-blue-400" /> Edge Nodes
        </h1>
        <button
          onClick={load}
          className="text-gray-400 hover:text-white inline-flex items-center gap-1 text-sm"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {/* Nodes */}
      <div className="space-y-4 mb-8">
        {nodes.map((node) => (
          <div key={node.homeNodeId} className="bg-gray-800 rounded-lg p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-white font-medium text-lg">{node.name}</h2>
                <p className="text-gray-500 text-xs font-mono">{node.homeNodeId}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  node.lastHeartbeatAt &&
                  Date.now() - new Date(node.lastHeartbeatAt).getTime() < 60000
                    ? "bg-green-900 text-green-300"
                    : "bg-gray-700 text-gray-400"
                }`}>
                  {node.lastHeartbeatAt &&
                  Date.now() - new Date(node.lastHeartbeatAt).getTime() < 60000
                    ? "Online"
                    : "Offline"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-gray-400">
                <Cpu className="w-4 h-4 text-gray-500" />
                <span>{node.hardwareClass}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400">
                <HardDrive className="w-4 h-4 text-gray-500" />
                <span className="truncate">{node.cachePath}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400">
                <Clock className="w-4 h-4 text-gray-500" />
                <span>Last heartbeat: {timeAgo(node.lastHeartbeatAt)}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-400">
                <KeyRound className="w-4 h-4 text-gray-500" />
                <span>{node.encryptionKeyHex ? "Encrypted" : "No key"}</span>
              </div>
            </div>

            {node.encryptionKeyHex && (
              <button
                onClick={() => rotateKey(node.homeNodeId)}
                disabled={rotating === node.homeNodeId}
                className="mt-4 inline-flex items-center gap-1 text-yellow-400 hover:text-yellow-300 text-sm disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" />
                {rotating === node.homeNodeId ? "Rotating..." : "Rotate encryption key"}
              </button>
            )}
          </div>
        ))}
        {nodes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Server className="w-12 h-12 mb-3" />
            <p>No edge nodes registered. Create one from the Admin page.</p>
          </div>
        )}
      </div>

      {/* Health snapshots */}
      {health.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" /> Health History
          </h2>
          <div className="space-y-1">
            {health.slice(0, 20).map((h) => (
              <div key={h.snapshotId} className="flex items-center gap-3 bg-gray-800 rounded px-3 py-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${
                  h.status === "ok" || h.status === "healthy"
                    ? "bg-green-500"
                    : h.status === "degraded"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`} />
                <span className="text-gray-300">{h.serviceName}</span>
                {h.nodeRef && <span className="text-gray-500 text-xs">{h.nodeRef}</span>}
                <span className="text-gray-500 text-xs ml-auto">{new Date(h.measuredAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
