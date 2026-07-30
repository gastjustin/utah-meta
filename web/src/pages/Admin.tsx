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
} from "lucide-react";

interface AdminData {
  health: { status: string };
  libraries: any[];
  jobs: any[];
  nodes: any[];
  users: any[];
  sessions: any[];
  predictions: any[];
}

export default function Admin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [scanRoot, setScanRoot] = useState("");
  const [hnName, setHnName] = useState("");
  const [hnClass, setHnClass] = useState("");
  const [hnPath, setHnPath] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try {
      const [health, libraries, jobs, nodes, users, sessions, predictions] =
        await Promise.all([
          api("/health").catch(() => ({ status: "down" })),
          api("/libraries").catch(() => []),
          api("/preparation/jobs").catch(() => []),
          api("/home-nodes").catch(() => []),
          api("/users").catch(() => []),
          api("/sessions").catch(() => []),
          api("/predictions").catch(() => []),
        ]);
      setData({
        health,
        libraries,
        jobs,
        nodes,
        users,
        sessions,
        predictions,
      });
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
