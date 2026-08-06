import { useEffect, useState } from "react";
import { api } from "../api";
import {
  ScanLine,
  Server,
  Cpu,
  HardDrive,
  Activity,
  Plus,
  ListChecks,
  Volume2,
  Trash2,
  Pencil,
  Check,
  X,
  Radio,
} from "lucide-react";

interface AudioPolicy {
  audioPolicyId: string;
  name: string;
  englishOnly: boolean;
  normalizeAudio: boolean;
}

interface LiveTvSource {
  liveTvSourceId: string;
  name: string;
  kind: string;
  config: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  _count: { channels: number };
}

interface AdminData {
  health: { status: string };
  libraries: any[];
  jobs: any[];
  nodes: any[];
  users: any[];
  sessions: any[];
  predictions: any[];
  liveTvSources: LiveTvSource[];
}

export default function Admin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [scanRoot, setScanRoot] = useState("");
  const [hnName, setHnName] = useState("");
  const [hnClass, setHnClass] = useState("");
  const [hnPath, setHnPath] = useState("");
  const [scanJobs, setScanJobs] = useState<any[]>([]);
  const [audioPolicies, setAudioPolicies] = useState<AudioPolicy[]>([]);
  const [showAddPolicy, setShowAddPolicy] = useState(false);
  const [newPolicyName, setNewPolicyName] = useState("");
  const [newPolicyEnglish, setNewPolicyEnglish] = useState(false);
  const [newPolicyNormalize, setNewPolicyNormalize] = useState(true);
  const [editingPolicy, setEditingPolicy] = useState<string | null>(null);
  const [editPolicyName, setEditPolicyName] = useState("");
  const [editPolicyEnglish, setEditPolicyEnglish] = useState(false);
  const [editPolicyNormalize, setEditPolicyNormalize] = useState(true);

  const [liveTvSources, setLiveTvSources] = useState<LiveTvSource[]>([]);
  const [showAddLiveTv, setShowAddLiveTv] = useState(false);
  const [liveTvName, setLiveTvName] = useState("");
  const [liveTvKind, setLiveTvKind] = useState<"m3u_url" | "m3u_file" | "xtream">("m3u_url");
  const [liveTvM3uUrl, setLiveTvM3uUrl] = useState("");
  const [liveTvM3uFile, setLiveTvM3uFile] = useState("");
  const [liveTvBaseUrl, setLiveTvBaseUrl] = useState("");
  const [liveTvUsername, setLiveTvUsername] = useState("");
  const [liveTvPassword, setLiveTvPassword] = useState("");
  const [liveTvOutput, setLiveTvOutput] = useState("m3u8");
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const [health, libraries, jobs, nodes, users, sessions, predictions, scans, policies, liveTv] =
        await Promise.all([
          api("/health").catch(() => ({ status: "down" })),
          api("/libraries").catch(() => []),
          api("/preparation/jobs").catch(() => []),
          api("/home-nodes").catch(() => []),
          api("/users").catch(() => []),
          api("/sessions").catch(() => []),
          api("/predictions").catch(() => []),
          api("/scan-jobs").catch(() => []),
          api<AudioPolicy[]>("/audio-policies").catch(() => []),
          api<LiveTvSource[]>("/live-tv/sources").catch(() => []),
        ]);
      setData({
        health,
        libraries,
        jobs,
        nodes,
        users,
        sessions,
        predictions,
        liveTvSources: liveTv,
      });
      setScanJobs(scans);
      setAudioPolicies(policies);
      setLiveTvSources(liveTv);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function scan() {
    setMsg("");
    try {
      await api("/library/scan", {
        method: "POST",
        body: JSON.stringify({ rootPath: scanRoot || undefined }),
      });
      setMsg("Scan triggered");
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function createNode() {
    setMsg("");
    try {
      await api("/home-nodes", {
        method: "POST",
        body: JSON.stringify({
          name: hnName,
          hardwareClass: hnClass,
          cachePath: hnPath,
        }),
      });
      setMsg("Home node created");
      setHnName("");
      setHnClass("");
      setHnPath("");
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function createLiveTvSource() {
    if (!liveTvName.trim()) return;
    let config: Record<string, unknown> = {};
    if (liveTvKind === "m3u_url") {
      config = { url: liveTvM3uUrl };
    } else if (liveTvKind === "m3u_file") {
      config = { content: liveTvM3uFile };
    } else {
      config = {
        baseUrl: liveTvBaseUrl,
        username: liveTvUsername,
        password: liveTvPassword,
        output: liveTvOutput,
      };
    }
    try {
      const created = await api<LiveTvSource>("/live-tv/sources", {
        method: "POST",
        body: JSON.stringify({ name: liveTvName, kind: liveTvKind, config }),
      });
      await api(`/live-tv/sources/${created.liveTvSourceId}/sync`, { method: "POST" });
      setMsg("Live TV source added and synced");
      setLiveTvName("");
      setLiveTvM3uUrl("");
      setLiveTvM3uFile("");
      setLiveTvBaseUrl("");
      setLiveTvUsername("");
      setLiveTvPassword("");
      setLiveTvOutput("m3u8");
      setShowAddLiveTv(false);
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function syncLiveTvSource(id: string) {
    setMsg("");
    try {
      await api(`/live-tv/sources/${id}/sync`, { method: "POST" });
      setMsg("Live TV source synced");
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function syncVodSource(id: string) {
    setMsg("");
    try {
      await api(`/live-tv/sources/${id}/sync-vod`, { method: "POST" });
      setMsg("VOD sync completed");
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function deleteLiveTvSource(id: string) {
    if (!confirm("Delete this live TV source and all its channels?")) return;
    try {
      await api(`/live-tv/sources/${id}`, { method: "DELETE" });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  if (!data) return <div className="text-gray-400 p-8">Loading admin...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {msg && (
        <div className="bg-blue-900 text-blue-200 text-sm p-3 rounded">
          {msg}
        </div>
      )}

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-800 rounded-lg p-5">
          <h2 className="text-white font-bold mb-3 flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-blue-400" /> Library Scan
          </h2>
          <input
            type="text"
            placeholder="Root path (optional, uses MEDIA_MOUNT_PATH)"
            value={scanRoot}
            onChange={(e) => setScanRoot(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 mb-3 text-sm"
          />
          <button
            onClick={scan}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-sm transition"
          >
            Trigger Scan
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg p-5">
          <h2 className="text-white font-bold mb-3 flex items-center gap-2">
            <Plus className="w-5 h-5 text-green-400" /> Create Home Node
          </h2>
          <input
            type="text"
            placeholder="Name"
            value={hnName}
            onChange={(e) => setHnName(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 mb-2 text-sm"
          />
          <input
            type="text"
            placeholder="Hardware class (e.g. arm64)"
            value={hnClass}
            onChange={(e) => setHnClass(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 mb-2 text-sm"
          />
          <input
            type="text"
            placeholder="Cache path (e.g. /cache)"
            value={hnPath}
            onChange={(e) => setHnPath(e.target.value)}
            className="w-full bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 mb-3 text-sm"
          />
          <button
            onClick={createNode}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm transition"
          >
            Create
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          label="Health"
          value={data.health.status}
        />
        <StatCard
          icon={<Server className="w-5 h-5" />}
          label="Libraries"
          value={String(data.libraries.length)}
        />
        <StatCard
          icon={<ListChecks className="w-5 h-5" />}
          label="Prep Jobs"
          value={String(data.jobs.length)}
        />
        <StatCard
          icon={<HardDrive className="w-5 h-5" />}
          label="Home Nodes"
          value={String(data.nodes.length)}
        />
        <StatCard
          icon={<Cpu className="w-5 h-5" />}
          label="Users"
          value={String(data.users.length)}
        />
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          label="Sessions"
          value={String(data.sessions.length)}
        />
        <StatCard
          icon={<ListChecks className="w-5 h-5" />}
          label="Predictions"
          value={String(data.predictions.length)}
        />
      </div>

      {/* Scan job history */}
      {scanJobs.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-5">
          <h2 className="text-white font-bold mb-3 flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-blue-400" /> Scan History
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-300">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-700">
                  <th className="pb-2">Library</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Started</th>
                </tr>
              </thead>
              <tbody>
                {scanJobs.slice(0, 10).map((job: any) => (
                  <tr key={job.scanJobId} className="border-b border-gray-700/50">
                    <td className="py-2">{job.library?.name || "Unknown"}</td>
                    <td className="py-2 text-gray-500 text-xs">{job.scanType}</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          job.status === "done"
                            ? "bg-green-900 text-green-300"
                            : job.status === "failed"
                            ? "bg-red-900 text-red-300"
                            : job.status === "running"
                            ? "bg-yellow-900 text-yellow-300"
                            : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500 text-xs">
                      {new Date(job.startedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audio Policies */}
      <div className="bg-gray-800 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-blue-400" /> Audio Policies
          </h2>
          <button
            onClick={() => setShowAddPolicy(!showAddPolicy)}
            className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm transition"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {showAddPolicy && (
          <div className="bg-gray-700 rounded-lg p-4 mb-4 space-y-3">
            <input
              type="text"
              placeholder="Policy name (e.g. English Only)"
              value={newPolicyName}
              onChange={(e) => setNewPolicyName(e.target.value)}
              className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={newPolicyEnglish}
                  onChange={(e) => setNewPolicyEnglish(e.target.checked)}
                  className="accent-blue-500"
                />
                English only
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={newPolicyNormalize}
                  onChange={(e) => setNewPolicyNormalize(e.target.checked)}
                  className="accent-blue-500"
                />
                Normalize audio
              </label>
            </div>
            <button
              onClick={async () => {
                if (!newPolicyName.trim()) return;
                try {
                  await api("/audio-policies", {
                    method: "POST",
                    body: JSON.stringify({
                      name: newPolicyName,
                      englishOnly: newPolicyEnglish,
                      normalizeAudio: newPolicyNormalize,
                    }),
                  });
                  setNewPolicyName("");
                  setNewPolicyEnglish(false);
                  setNewPolicyNormalize(true);
                  setShowAddPolicy(false);
                  load();
                } catch (err: any) {
                  setMsg(err.message);
                }
              }}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm transition"
            >
              Create
            </button>
          </div>
        )}

        {audioPolicies.length === 0 ? (
          <p className="text-gray-500 text-sm">No audio policies yet. Create one so users can select it in Settings.</p>
        ) : (
          <div className="space-y-2">
            {audioPolicies.map((p) => (
              <div key={p.audioPolicyId} className="flex items-center gap-3 bg-gray-700 rounded-lg p-3">
                {editingPolicy === p.audioPolicyId ? (
                  <>
                    <input
                      type="text"
                      value={editPolicyName}
                      onChange={(e) => setEditPolicyName(e.target.value)}
                      className="flex-1 bg-gray-600 text-white border border-gray-500 rounded px-3 py-1.5 text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={editPolicyEnglish}
                        onChange={(e) => setEditPolicyEnglish(e.target.checked)}
                        className="accent-blue-500"
                      />
                      EN
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={editPolicyNormalize}
                        onChange={(e) => setEditPolicyNormalize(e.target.checked)}
                        className="accent-blue-500"
                      />
                      Norm
                    </label>
                    <button
                      onClick={async () => {
                        try {
                          await api(`/audio-policies/${p.audioPolicyId}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              name: editPolicyName,
                              englishOnly: editPolicyEnglish,
                              normalizeAudio: editPolicyNormalize,
                            }),
                          });
                          setEditingPolicy(null);
                          load();
                        } catch (err: any) {
                          setMsg(err.message);
                        }
                      }}
                      className="text-green-400 hover:text-green-300"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingPolicy(null)}
                      className="text-gray-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{p.name}</p>
                      <p className="text-gray-500 text-xs">
                        {p.englishOnly ? "English only" : "All languages"}
                        {` · ${p.normalizeAudio ? "Normalized" : "Raw"}`}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingPolicy(p.audioPolicyId);
                        setEditPolicyName(p.name);
                        setEditPolicyEnglish(p.englishOnly);
                        setEditPolicyNormalize(p.normalizeAudio);
                      }}
                      className="text-gray-400 hover:text-blue-400"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete audio policy "${p.name}"?`)) return;
                        try {
                          await api(`/audio-policies/${p.audioPolicyId}`, { method: "DELETE" });
                          load();
                        } catch (err: any) {
                          setMsg(err.message);
                        }
                      }}
                      className="text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prep jobs table */}
      {data.jobs.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-5">
          <h2 className="text-white font-bold mb-3">Recent Prep Jobs</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-300">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-700">
                  <th className="pb-2">Job ID</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Queued</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.slice(0, 10).map((job: any) => (
                  <tr key={job.prepJobId} className="border-b border-gray-700/50">
                    <td className="py-2 font-mono text-xs">
                      {job.prepJobId.slice(0, 8)}
                    </td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          job.status === "done"
                            ? "bg-green-900 text-green-300"
                            : job.status === "failed"
                            ? "bg-red-900 text-red-300"
                            : job.status === "running"
                            ? "bg-yellow-900 text-yellow-300"
                            : "bg-gray-700 text-gray-300"
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500 text-xs">
                      {new Date(job.queuedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Live TV Sources */}
      <div className="bg-gray-800 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold flex items-center gap-2">
            <Radio className="w-5 h-5 text-amber-400" /> Live TV Sources
          </h2>
          <button
            onClick={() => setShowAddLiveTv(!showAddLiveTv)}
            className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm transition"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {showAddLiveTv && (
          <div className="bg-gray-700 rounded-lg p-4 mb-4 space-y-3">
            <input
              type="text"
              placeholder="Source name"
              value={liveTvName}
              onChange={(e) => setLiveTvName(e.target.value)}
              className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
            />
            <select
              value={liveTvKind}
              onChange={(e) => setLiveTvKind(e.target.value as any)}
              className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
            >
              <option value="m3u_url">M3U URL</option>
              <option value="m3u_file">M3U File contents</option>
              <option value="xtream">Xtreme Codes</option>
            </select>

            {liveTvKind === "m3u_url" && (
              <input
                type="text"
                placeholder="http://example.com/playlist.m3u"
                value={liveTvM3uUrl}
                onChange={(e) => setLiveTvM3uUrl(e.target.value)}
                className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
              />
            )}

            {liveTvKind === "m3u_file" && (
              <textarea
                rows={4}
                placeholder="#EXTM3U..."
                value={liveTvM3uFile}
                onChange={(e) => setLiveTvM3uFile(e.target.value)}
                className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
              />
            )}

            {liveTvKind === "xtream" && (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Base URL (e.g. http://example.com:8080)"
                  value={liveTvBaseUrl}
                  onChange={(e) => setLiveTvBaseUrl(e.target.value)}
                  className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder="Username"
                  value={liveTvUsername}
                  onChange={(e) => setLiveTvUsername(e.target.value)}
                  className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={liveTvPassword}
                  onChange={(e) => setLiveTvPassword(e.target.value)}
                  className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
                />
                <select
                  value={liveTvOutput}
                  onChange={(e) => setLiveTvOutput(e.target.value)}
                  className="w-full bg-gray-600 text-white border border-gray-500 rounded px-3 py-2 text-sm"
                >
                  <option value="m3u8">HLS (.m3u8)</option>
                  <option value="ts">MPEG-TS (.ts)</option>
                </select>
              </div>
            )}

            <button
              onClick={createLiveTvSource}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm transition"
            >
              Save &amp; Sync
            </button>
          </div>
        )}

        {liveTvSources.length === 0 ? (
          <p className="text-gray-500 text-sm">No live TV sources yet. Add an M3U or Xtreme Codes source to get started.</p>
        ) : (
          <div className="space-y-2">
            {liveTvSources.map((s) => (
              <div key={s.liveTvSourceId} className="flex items-center gap-3 bg-gray-700 rounded-lg p-3">
                <Radio className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">{s.name}</p>
                  <p className="text-gray-500 text-xs">
                    {s.kind} · {s._count.channels} channels ·{" "}
                    {s.enabled ? "Enabled" : "Disabled"}
                    {s.lastSyncedAt && ` · Synced ${new Date(s.lastSyncedAt).toLocaleString()}`}
                  </p>
                </div>
                <button
                  onClick={() => syncLiveTvSource(s.liveTvSourceId)}
                  className="text-blue-400 hover:text-blue-300 text-sm"
                >
                  Sync
                </button>
                <button
                  onClick={() => syncVodSource(s.liveTvSourceId)}
                  className="text-amber-400 hover:text-amber-300 text-sm"
                >
                  Sync VOD
                </button>
                <button
                  onClick={() => deleteLiveTvSource(s.liveTvSourceId)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="text-gray-500 mb-1">{icon}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
